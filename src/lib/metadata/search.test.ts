import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * searchGames has to tell "no catalogue has this game" apart from "no
 * catalogue answered". The sources are stubbed; what's under test is how
 * their answers and failures are combined.
 */

const ol = vi.fn();
const gb = vi.fn();
const nb = vi.fn();
const olWork = vi.fn();
const olEdition = vi.fn();
const gbDetails = vi.fn();
let gbEnabled = false;
vi.mock("@/lib/metadata/openlibrary", () => ({
  searchOpenLibrary: (q: string) => ol(q),
  getOpenLibraryDetails: (id: string) => olWork(id),
  getOpenLibraryEdition: (isbn: string) => olEdition(isbn),
}));
vi.mock("@/lib/metadata/googlebooks", () => ({
  searchGoogleBooks: (q: string) => gb(q),
  getGoogleBooksDetails: (params: unknown) => gbDetails(params),
  googleBooksEnabled: () => gbEnabled,
}));
vi.mock("@/lib/metadata/nb", () => ({
  searchNb: (q: string) => nb(q),
  getNbCoverByIsbn: vi.fn(),
}));

const { CataloguesUnreachableError, getGameDetails, searchGames } = await import("@/lib/metadata");

const down = () => Promise.reject(new Error("down"));
const game = (title: string, isbn: string | null = null) => ({
  title,
  authors: [],
  isbn,
  coverUrl: null,
  description: null,
  pageCount: null,
  tags: [],
  source: "openlibrary",
});

beforeEach(() => {
  gbEnabled = false;
  ol.mockReset();
  nb.mockReset();
  // Disabled Google Games answers with nothing rather than failing.
  gb.mockReset().mockResolvedValue([]);
});

describe("searchGames", () => {
  it("reports an outage when no catalogue answers", async () => {
    ol.mockImplementation(down);
    nb.mockImplementation(down);
    await expect(searchGames("hobbit")).rejects.toBeInstanceOf(CataloguesUnreachableError);
  });

  it("counts Google Games only when it is configured", async () => {
    gbEnabled = true;
    ol.mockImplementation(down);
    nb.mockImplementation(down);
    gb.mockResolvedValue([game("The Hobbit")]);
    expect((await searchGames("hobbit")).map((r) => r.title)).toEqual(["The Hobbit"]);

    gb.mockImplementation(down);
    await expect(searchGames("hobbit")).rejects.toBeInstanceOf(CataloguesUnreachableError);
  });

  it("returns an empty list when the catalogues answered with nothing", async () => {
    ol.mockResolvedValue([]);
    nb.mockImplementation(down);
    expect(await searchGames("zzzz")).toEqual([]);
  });

  it("keeps one source's rows when another is down, and dedupes editions", async () => {
    ol.mockResolvedValue([game("The Hobbit", "9780261103344")]);
    nb.mockResolvedValue([game("Hobbiten", "9788205530102"), game("The Hobbit (dup)", "0261103342")]);
    expect((await searchGames("hobbit")).map((r) => r.title)).toEqual(["The Hobbit", "Hobbiten"]);
  });

  it("asks only the chosen catalogues, in the chosen order", async () => {
    ol.mockResolvedValue([game("Open Library row")]);
    nb.mockResolvedValue([game("nb.no row")]);
    expect((await searchGames("x", ["nb", "openlibrary"])).map((r) => r.title)).toEqual([
      "nb.no row",
      "Open Library row",
    ]);

    ol.mockClear();
    expect((await searchGames("x", ["nb"])).map((r) => r.title)).toEqual(["nb.no row"]);
    expect(ol).not.toHaveBeenCalled();
  });

  it("lets the first chosen catalogue win a duplicate edition", async () => {
    ol.mockResolvedValue([game("From Open Library", "9780261103344")]);
    nb.mockResolvedValue([game("From nb.no", "0261103342")]);
    expect((await searchGames("x", ["nb", "openlibrary"])).map((r) => r.title)).toEqual([
      "From nb.no",
    ]);
  });

  it("falls back to the keyless catalogues when only Google is chosen but not set up", async () => {
    ol.mockResolvedValue([game("Open Library row")]);
    nb.mockResolvedValue([]);
    expect((await searchGames("x", ["google"])).map((r) => r.title)).toEqual([
      "Open Library row",
    ]);
    expect(gb).not.toHaveBeenCalled();
  });
});

describe("getGameDetails", () => {
  const work = (tags: string[]) => ({ description: "A work", pageCount: null, tags, coverUrl: null });

  beforeEach(() => {
    olWork.mockReset().mockResolvedValue(work(["fantasy"]));
    olEdition.mockReset().mockResolvedValue(null);
    gbDetails.mockReset().mockResolvedValue(null);
  });

  it("takes the page count from Google, then from the Open Library edition", async () => {
    olEdition.mockResolvedValue({ pageCount: 310, workId: "OL1W" });
    expect((await getGameDetails({ isbn: "9780261103344" })).pageCount).toBe(310);

    gbEnabled = true;
    gbDetails.mockResolvedValue({ description: null, pageCount: 320, tags: [], coverUrl: null });
    expect((await getGameDetails({ isbn: "9780261103344" })).pageCount).toBe(320);
  });

  it("finds the work through the edition when no id was given, and fetches its subjects", async () => {
    olEdition.mockResolvedValue({ pageCount: null, workId: "OL27482W" });
    const details = await getGameDetails({ isbn: "9788205530102" });
    expect(olWork).toHaveBeenCalledWith("OL27482W");
    expect(details.openLibraryId).toBe("OL27482W");
    expect(details.tags).toEqual(["fantasy"]);
  });

  it("keeps the id it was given", async () => {
    olEdition.mockResolvedValue({ pageCount: null, workId: "OL999W" });
    const details = await getGameDetails({ openLibraryId: "OL1W", isbn: "9780261103344" });
    expect(olWork).toHaveBeenCalledTimes(1);
    expect(olWork).toHaveBeenCalledWith("OL1W");
    expect(details.openLibraryId).toBe("OL1W");
  });

  it("skips Open Library when it is switched off", async () => {
    const details = await getGameDetails({ openLibraryId: "OL1W", isbn: "9780261103344" }, ["nb"]);
    expect(olWork).not.toHaveBeenCalled();
    expect(olEdition).not.toHaveBeenCalled();
    expect(details.description).toBeNull();
  });

  it("falls back as before when Open Library has no edition for the ISBN", async () => {
    const details = await getGameDetails({ isbn: "9780000000002" });
    expect(olWork).not.toHaveBeenCalled();
    expect(details).toMatchObject({ pageCount: null, tags: [], openLibraryId: null });
  });
});
