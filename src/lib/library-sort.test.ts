import { describe, expect, it } from "vitest";
import { GameFormat, GameOwnership, ReadingStatus } from "@prisma/client";
import {
  authorSortKey,
  groupGames,
  publishedYear,
  ratingLabel,
  seriesHeading,
  seriesProgress,
  sliceGroups,
  sortGames,
  titleSortKey,
  type GroupableGame,
} from "@/lib/library-sort";

function game(overrides: Partial<GroupableGame> & { title: string }): GroupableGame {
  return {
    authors: [],
    rating: null,
    seriesName: null,
    seriesNumber: null,
    dateFinished: null,
    dateStarted: null,
    pageCount: null,
    publishedDate: null,
    createdAt: new Date(0),
    updatedAt: new Date(0),
    status: ReadingStatus.WANT_TO_READ,
    format: GameFormat.PHYSICAL,
    ownership: GameOwnership.OWNED,
    tags: [],
    ...overrides,
  };
}

describe("authorSortKey", () => {
  it("files authors by surname", () => {
    expect(authorSortKey("Brandon Sanderson")).toBe("sanderson brandon");
  });

  it("keeps surname particles with the last name", () => {
    expect(authorSortKey("Ursula K. Le Guin")).toBe("le guin ursula k.");
    expect(authorSortKey("Robert van Gulik")).toBe("van gulik robert");
    expect(authorSortKey("Erik van der Berg")).toBe("van der berg erik");
  });

  it("moves suffixes to the end", () => {
    expect(authorSortKey("Martin Luther King Jr.")).toBe("king martin luther jr.");
  });

  it("uses single-word names as their own key", () => {
    expect(authorSortKey("Homer")).toBe("homer");
  });
});

describe("sortGames by author", () => {
  const leGuin = game({ title: "A Wizard of Earthsea", authors: ["Ursula K. Le Guin"] });
  const vanGulik = game({ title: "The Chinese Maze Murders", authors: ["Robert van Gulik"] });
  const homer = game({ title: "The Odyssey", authors: ["Homer"] });
  const sanderson = game({ title: "Elantris", authors: ["Brandon Sanderson"] });

  it("orders authors surname-first: Le Guin under L, van Gulik under V", () => {
    const sorted = sortGames([vanGulik, leGuin, sanderson, homer], "author", "asc");
    expect(sorted.map((b) => b.title)).toEqual([
      "The Odyssey", // Homer
      "A Wizard of Earthsea", // Le Guin
      "Elantris", // Sanderson
      "The Chinese Maze Murders", // van Gulik
    ]);
  });

  it("flips author order on desc but keeps shelf order within an author", () => {
    const mistborn1 = game({
      title: "The Final Empire",
      authors: ["Brandon Sanderson"],
      seriesName: "Mistborn",
      seriesNumber: 1,
    });
    const mistborn2 = game({
      title: "The Well of Ascension",
      authors: ["Brandon Sanderson"],
      seriesName: "Mistborn",
      seriesNumber: 2,
    });
    const sorted = sortGames([mistborn2, homer, mistborn1], "author", "desc");
    expect(sorted.map((b) => b.title)).toEqual([
      "The Final Empire", // Sanderson before Homer on desc…
      "The Well of Ascension", // …but the series stays in reading order
      "The Odyssey",
    ]);
  });

  it("keeps a series together as a block, in series order, novellas slotted in", () => {
    const one = game({
      title: "The Final Empire",
      authors: ["Brandon Sanderson"],
      seriesName: "Mistborn",
      seriesNumber: 1,
    });
    const novella = game({
      title: "Zz Secret History", // title alone would sort it last
      authors: ["Brandon Sanderson"],
      seriesName: "Mistborn",
      seriesNumber: 1.5,
    });
    const two = game({
      title: "The Well of Ascension",
      authors: ["Brandon Sanderson"],
      seriesName: "Mistborn",
      seriesNumber: 2,
    });
    const standalone = game({ title: "Elantris", authors: ["Brandon Sanderson"] });
    const zzStandalone = game({ title: "Warbreaker", authors: ["Brandon Sanderson"] });

    const sorted = sortGames([two, zzStandalone, novella, standalone, one], "author", "asc");
    expect(sorted.map((b) => b.title)).toEqual([
      "Elantris", // E before M(istborn)
      "The Final Empire", // Mistborn block: 1, 1.5, 2
      "Zz Secret History",
      "The Well of Ascension",
      "Warbreaker", // W after M
    ]);
  });
});

describe("sortGames by field", () => {
  it("sorts by title", () => {
    const sorted = sortGames(
      [game({ title: "Beta" }), game({ title: "Alpha" })],
      "title",
      "asc",
    );
    expect(sorted.map((b) => b.title)).toEqual(["Alpha", "Beta"]);
  });

  it("sorts by rating, unrated last", () => {
    const sorted = sortGames(
      [
        game({ title: "Mid", rating: 6 }),
        game({ title: "Unrated" }),
        game({ title: "Top", rating: 10 }),
      ],
      "rating",
      "desc",
    );
    expect(sorted.map((b) => b.title)).toEqual(["Top", "Mid", "Unrated"]);
  });

  it("falls back to createdAt for unknown sorts", () => {
    const older = game({ title: "Older", createdAt: new Date(1000) });
    const newer = game({ title: "Newer", createdAt: new Date(2000) });
    expect(sortGames([older, newer], "bogus", "desc")[0].title).toBe("Newer");
  });
});

describe("groupGames", () => {
  it("returns null for the flat view", () => {
    expect(groupGames([game({ title: "A" })], "none")).toBeNull();
  });

  it("groups by author in surname order, authorless games last", () => {
    const groups = groupGames(
      [
        game({ title: "V", authors: ["Robert van Gulik"] }),
        game({ title: "X" }), // no author
        game({ title: "L", authors: ["Ursula K. Le Guin"] }),
      ],
      "author",
    );
    // Last, like the author sort puts them.
    expect(groups?.map((g) => g.title)).toEqual([
      "Ursula K. Le Guin",
      "Robert van Gulik",
      "Unknown author",
    ]);
  });

  it("groups by series in reading order, non-series games trailing", () => {
    const groups = groupGames(
      [
        game({ title: "Standalone" }),
        game({ title: "Two", seriesName: "Saga", seriesNumber: 2 }),
        game({ title: "One", seriesName: "Saga", seriesNumber: 1 }),
        game({ title: "Novella", seriesName: "Saga", seriesNumber: 1.5 }),
      ],
      "series",
    );
    expect(groups?.map((g) => g.title)).toEqual(["Saga", "Not in a series"]);
    expect(groups?.[0].games.map((b) => b.title)).toEqual(["One", "Novella", "Two"]);
    expect(groups?.[1].games.map((b) => b.title)).toEqual(["Standalone"]);
  });

  it("puts unnumbered series entries after numbered ones", () => {
    const groups = groupGames(
      [
        game({ title: "Companion", seriesName: "Saga" }),
        game({ title: "One", seriesName: "Saga", seriesNumber: 1 }),
      ],
      "series",
    );
    expect(groups?.[0].games.map((b) => b.title)).toEqual(["One", "Companion"]);
  });
});

describe("sorting rules", () => {
  const titles = (games: GroupableGame[]) => games.map((b) => b.title);

  it("files titles past a leading article when asked", () => {
    const games = [
      game({ title: "The Hobbit" }),
      game({ title: "Dune" }),
      game({ title: "A Wizard of Earthsea" }),
    ];
    expect(titles(sortGames(games, "title", "asc"))).toEqual([
      "A Wizard of Earthsea",
      "Dune",
      "The Hobbit",
    ]);
    expect(titles(sortGames(games, "title", "asc", { ignoreArticles: true }))).toEqual([
      "Dune",
      "The Hobbit",
      "A Wizard of Earthsea",
    ]);
  });

  it("skips the alphabet's own articles too, but never a whole title", () => {
    expect(titleSortKey("Den siste viking", { ignoreArticles: true, alphabet: "nb" })).toBe(
      "siste viking",
    );
    expect(titleSortKey("Den siste viking", { ignoreArticles: true })).toBe("Den siste viking");
    expect(titleSortKey("It", { ignoreArticles: true })).toBe("It");
  });

  it("sorts authors as written when asked", () => {
    expect(authorSortKey("Ursula K. Le Guin", { authorOrder: "as-written" })).toBe(
      "ursula k. le guin",
    );
  });

  it("puts Æ, Ø and Å after Z in the Norwegian alphabet", () => {
    const games = [
      game({ title: "Åsgårdsreien" }),
      game({ title: "Zorro" }),
      game({ title: "Ærlig talt" }),
    ];
    expect(titles(sortGames(games, "title", "asc", { alphabet: "nb" }))).toEqual([
      "Zorro",
      "Ærlig talt",
      "Åsgårdsreien",
    ]);
  });
});

describe("games without a value, and ties", () => {
  const titles = (games: GroupableGame[]) => games.map((b) => b.title);
  const day = (s: string) => new Date(`${s}T12:00:00Z`);

  it("puts games with no value last, whichever way round", () => {
    const cases: [string, Partial<GroupableGame>, Partial<GroupableGame>][] = [
      ["rating", { rating: 4 }, { rating: 8 }],
      ["dateFinished", { dateFinished: day("2024-01-01") }, { dateFinished: day("2025-01-01") }],
      ["dateStarted", { dateStarted: day("2024-01-01") }, { dateStarted: day("2025-01-01") }],
      ["pageCount", { pageCount: 100 }, { pageCount: 900 }],
      ["published", { publishedDate: "1999" }, { publishedDate: "2003-07" }],
    ];
    for (const [sort, low, high] of cases) {
      const games = [
        game({ title: "None" }),
        game({ title: "High", ...high }),
        game({ title: "Low", ...low }),
      ];
      expect(titles(sortGames(games, sort, "desc")), sort).toEqual(["High", "Low", "None"]);
      expect(titles(sortGames(games, sort, "asc")), sort).toEqual(["Low", "High", "None"]);
    }
  });

  it("counts a page count of 0 as none", () => {
    const games = [game({ title: "Zero", pageCount: 0 }), game({ title: "Some", pageCount: 10 })];
    expect(titles(sortGames(games, "pageCount", "asc"))).toEqual(["Some", "Zero"]);
  });

  it("breaks ties by author surname, then title, A to Z even when sorted descending", () => {
    const games = [
      game({ title: "B", authors: ["Zadie Smith"], rating: 8 }),
      game({ title: "Z", authors: ["Ursula K. Le Guin"], rating: 8 }),
      game({ title: "A", authors: ["Zadie Smith"], rating: 8 }),
      game({ title: "No author", rating: 8 }),
      game({ title: "Top", authors: ["Zadie Smith"], rating: 10 }),
    ];
    expect(titles(sortGames(games, "rating", "desc"))).toEqual([
      "Top",
      "Z",
      "A",
      "B",
      "No author",
    ]);
  });

  it("puts games without an author last under Author, both ways", () => {
    const games = [
      game({ title: "Nobody's" }),
      game({ title: "Homer's", authors: ["Homer"] }),
      game({ title: "Le Guin's", authors: ["Ursula K. Le Guin"] }),
    ];
    expect(titles(sortGames(games, "author", "asc"))).toEqual(["Homer's", "Le Guin's", "Nobody's"]);
    expect(titles(sortGames(games, "author", "desc"))).toEqual(["Le Guin's", "Homer's", "Nobody's"]);
  });

  it("sorts by year published and by when a game was last changed", () => {
    const games = [
      game({ title: "Old", publishedDate: "c. 1950", updatedAt: new Date(3000) }),
      game({ title: "New", publishedDate: "2020-05-01", updatedAt: new Date(1000) }),
    ];
    expect(titles(sortGames(games, "published", "desc"))).toEqual(["New", "Old"]);
    expect(titles(sortGames(games, "updatedAt", "desc"))).toEqual(["Old", "New"]);
  });

  it("falls back to date added for a sort name from Object's prototype", () => {
    const older = game({ title: "Older", createdAt: new Date(1000) });
    const newer = game({ title: "Newer", createdAt: new Date(2000) });
    expect(titles(sortGames([older, newer], "constructor", "desc"))).toEqual(["Newer", "Older"]);
  });
});

describe("publishedYear", () => {
  it("reads the first four-digit year", () => {
    expect(publishedYear("2003-07")).toBe(2003);
    expect(publishedYear("c. 1999")).toBe(1999);
    expect(publishedYear("May 12, 1987")).toBe(1987);
    expect(publishedYear("")).toBeNull();
    expect(publishedYear(null)).toBeNull();
    expect(publishedYear("n.d.")).toBeNull();
  });
});

describe("the newer groupings", () => {
  const titles = (g: { games: GroupableGame[] }) => g.games.map((b) => b.title);
  const read = (title: string, dateFinished?: string) =>
    game({
      title,
      status: ReadingStatus.READ,
      dateFinished: dateFinished ? new Date(dateFinished) : null,
    });

  it("files finishes by year in the reader's zone, newest first", () => {
    const games = [
      // 23:30 UTC on New Year's Eve is already 2026 in Oslo.
      read("Late", "2025-12-31T23:30:00Z"),
      // Typed into a date field: that day everywhere, New York included.
      read("Typed", "2026-01-01T00:00:00Z"),
      read("Older", "2024-06-01T10:00:00Z"),
      read("Undated"),
      // Not Read, so a leftover date doesn't count.
      game({
        title: "Reading",
        status: ReadingStatus.READING,
        dateFinished: new Date("2024-06-01T10:00:00Z"),
      }),
    ];
    const oslo = groupGames(games, "yearFinished", { timeZone: "Europe/Oslo" })!;
    expect(oslo.map((g) => g.title)).toEqual([
      "2026",
      "2024",
      "Finished, date not known",
      "Not finished",
    ]);
    expect(titles(oslo[0])).toEqual(["Late", "Typed"]);
    const ny = groupGames(games, "yearFinished", { timeZone: "America/New_York" })!;
    expect(ny.map((g) => g.title)).toEqual([
      "2026",
      "2025",
      "2024",
      "Finished, date not known",
      "Not finished",
    ]);
    expect(titles(ny[0])).toEqual(["Typed"]);
  });

  it("files statuses in reading order and drops empty ones", () => {
    const groups = groupGames(
      [
        game({ title: "Done", status: ReadingStatus.READ }),
        game({ title: "Now", status: ReadingStatus.READING }),
        game({ title: "Later", status: ReadingStatus.WANT_TO_READ }),
      ],
      "status",
    )!;
    expect(groups.map((g) => g.title)).toEqual(["Currently Reading", "Want to Read", "Read"]);
  });

  it("files formats and ownership in a fixed order with their labels", () => {
    const games = [
      game({ title: "A", format: GameFormat.AUDIOBOOK, ownership: GameOwnership.GIVEN_AWAY }),
      game({ title: "E", format: GameFormat.EBOOK, ownership: GameOwnership.WISHLIST }),
      game({ title: "P", format: GameFormat.PHYSICAL, ownership: GameOwnership.BORROWED }),
      game({ title: "O", format: GameFormat.PHYSICAL, ownership: GameOwnership.OWNED }),
    ];
    expect(groupGames(games, "format")!.map((g) => g.title)).toEqual([
      "Physical",
      "Ebook",
      "Audiobook",
    ]);
    expect(groupGames(games, "ownership")!.map((g) => g.title)).toEqual([
      "Owned",
      "Borrowed",
      "Wishlist",
      "No longer have it",
    ]);
  });

  it("puts a game under each of its tags, in the reader's alphabet, untagged last", () => {
    const games = [
      game({ title: "Both", tags: ["ærlig", "zebra"] }),
      game({ title: "None" }),
      game({ title: "One", tags: ["zebra"] }),
    ];
    const groups = groupGames(games, "tag", { alphabet: "nb" })!;
    expect(groups.map((g) => g.title)).toEqual(["zebra", "ærlig", "No tags"]);
    expect(titles(groups[0])).toEqual(["Both", "One"]);
    expect(titles(groups[1])).toEqual(["Both"]);
  });

  it("files shelves in the reader's shelf order, then by name, unshelved last", () => {
    const fav = { id: "s-fav", name: "Favourites" };
    const beach = { id: "s-beach", name: "Beach reads" };
    const club = { id: "s-club", name: "Couch co-op" };
    const games = [
      game({ title: "Loose", shelves: [] }),
      game({ title: "Loved", shelves: [fav, beach] }),
      game({ title: "Club", shelves: [club] }),
    ];
    expect(groupGames(games, "shelf")!.map((g) => g.title)).toEqual([
      "Beach reads",
      "Couch co-op",
      "Favourites",
      "Not on a shelf",
    ]);
    const ordered = groupGames(games, "shelf", { shelfOrder: ["s-fav", "deleted-shelf"] })!;
    expect(ordered.map((g) => g.title)).toEqual([
      "Favourites",
      "Beach reads",
      "Couch co-op",
      "Not on a shelf",
    ]);
  });

  it("is one 'Not on a shelf' section when there are no shelves", () => {
    const groups = groupGames([game({ title: "A" })], "shelf")!;
    expect(groups.map((g) => g.title)).toEqual(["Not on a shelf"]);
  });

  it("files ratings highest first in the reader's style, unrated last", () => {
    const games = [
      game({ title: "Half", rating: 1 }),
      game({ title: "Top", rating: 10 }),
      game({ title: "None" }),
      game({ title: "Odd", rating: 9 }),
    ];
    expect(groupGames(games, "rating")!.map((g) => g.title)).toEqual([
      "5 stars",
      "4½ stars",
      "½ star",
      "Unrated",
    ]);
    // An odd value under whole stars still shows, as the half it is.
    expect(groupGames(games, "rating", { ratingStyle: "whole" })![1].title).toBe("4½ stars");
    expect(groupGames(games, "rating", { ratingStyle: "ten" })!.map((g) => g.title)).toEqual([
      "10/10",
      "9/10",
      "1/10",
      "Unrated",
    ]);
  });

  it("gives every section a unique, stable key", () => {
    const games = [
      game({ title: "A", authors: ["Ann"], seriesName: "S", tags: ["x"], rating: 8 }),
      read("B", "2024-02-02T10:00:00Z"),
    ];
    const groupings = [
      "author",
      "series",
      "yearFinished",
      "status",
      "format",
      "ownership",
      "tag",
      "shelf",
      "rating",
    ];
    for (const group of groupings) {
      const keys = groupGames(games, group)!.map((g) => g.key);
      expect(new Set(keys).size, group).toBe(keys.length);
      expect(groupGames(games, group)!.map((g) => g.key), group).toEqual(keys);
    }
  });

  it("treats series names that differ only in case and spaces as one series", () => {
    const groups = groupGames(
      [
        game({ title: "Two", seriesName: "dune ", seriesNumber: 2 }),
        game({ title: "One", seriesName: "Dune", seriesNumber: 1 }),
      ],
      "series",
    )!;
    expect(groups).toHaveLength(1);
    expect(groups[0].title).toBe("dune");
    expect(titles(groups[0])).toEqual(["One", "Two"]);
  });
});

describe("ratingLabel", () => {
  it("words a stored rating in each style", () => {
    expect(ratingLabel(10)).toBe("5 stars");
    expect(ratingLabel(9)).toBe("4½ stars");
    expect(ratingLabel(3)).toBe("1½ stars");
    expect(ratingLabel(2)).toBe("1 star");
    expect(ratingLabel(1)).toBe("½ star");
    expect(ratingLabel(9, "ten")).toBe("9/10");
    expect(ratingLabel(9, "off")).toBe("9/10");
  });
});

describe("sliceGroups", () => {
  it("counts every entry against the budget, repeats included", () => {
    const a = game({ title: "A", tags: ["x", "y"] });
    const b = game({ title: "B", tags: ["x"] });
    const c = game({ title: "C", tags: ["y"] });
    const groups = groupGames([a, b, c], "tag")!; // x: A B, y: A C
    const sliced = sliceGroups(groups, 3);
    expect(sliced.groups.map((g) => [g.title, g.games.map((x) => x.title), g.total])).toEqual([
      ["x", ["A", "B"], 2],
      ["y", ["A"], 2],
    ]);
    expect(sliced.shownEntries).toBe(3);
    expect(sliced.totalEntries).toBe(4);
  });

  it("leaves out sections the budget doesn't reach", () => {
    const groups = groupGames(
      [game({ title: "A", tags: ["x"] }), game({ title: "B", tags: ["y"] })],
      "tag",
    )!;
    const sliced = sliceGroups(groups, 1);
    expect(sliced.groups.map((g) => g.title)).toEqual(["x"]);
    expect(sliced).toMatchObject({ shownEntries: 1, totalEntries: 2 });
  });
});

describe("series progress", () => {
  const { WANT_TO_READ, READING, READ, DNF } = ReadingStatus;
  const member = (seriesNumber: number | null, status: ReadingStatus, timesRead = 0) => ({
    seriesNumber,
    status,
    timesRead,
  });

  it("counts what's read and names what's next", () => {
    const p = seriesProgress([
      member(1, READ),
      member(2, READ),
      member(3, READ),
      member(4, WANT_TO_READ),
      member(5, WANT_TO_READ),
    ]);
    expect(p).toMatchObject({ total: 5, read: 3, reading: null, next: 4, missing: [] });
    expect(seriesHeading(p, 5)).toEqual({ detail: "5 games · 3 read · next #4" });
  });

  it("says which game is being read instead of what's next", () => {
    const p = seriesProgress([member(1, READ), member(2, READING), member(3, WANT_TO_READ)]);
    expect(p.reading).toBe(2);
    expect(seriesHeading(p, 3).detail).toBe("3 games · 1 read · reading #2");
  });

  it("skips games put down, as Pick for me does", () => {
    const p = seriesProgress([member(1, READ), member(2, DNF), member(3, WANT_TO_READ)]);
    expect(p.next).toBe(3);
    expect(p.read).toBe(1);
  });

  it("counts a game read before and being re-read as read", () => {
    const p = seriesProgress([member(1, READING, 1), member(2, READ)]);
    expect(p.read).toBe(2);
    expect(seriesHeading(p, 2).detail).toBe("2 games · all read");
  });

  it("lists whole numbers with no game; novellas and prequels fill no gap", () => {
    const p = seriesProgress([
      member(0, READ),
      member(1.5, READ),
      member(2, READ),
      member(6, WANT_TO_READ),
      member(null, WANT_TO_READ),
    ]);
    expect(p.missing).toEqual([1, 3, 4, 5]);
    expect(seriesHeading(p, 5).note).toBe("#1, #3, #4, #5 missing");
  });

  it("shortens a long list of gaps", () => {
    const p = seriesProgress([member(1, READ), member(10, WANT_TO_READ)]);
    expect(seriesHeading(p, 2).note).toBe("#2, #3, #4, #5, #6 and 3 more missing");
  });

  it("has no next or gaps for a series without numbers", () => {
    const p = seriesProgress([member(null, READ), member(null, WANT_TO_READ)]);
    expect(p).toMatchObject({ next: null, reading: null, missing: [] });
    expect(seriesHeading(p, 2)).toEqual({ detail: "2 games · 1 read" });
  });

  it("says when the filters on screen show only part of a series", () => {
    const p = seriesProgress([member(1, READ), member(2, READ), member(3, WANT_TO_READ)]);
    expect(seriesHeading(p, 1).detail).toBe("1 of 3 games · 2 read · next #3");
  });

  it("prints numbers as stored", () => {
    const p = seriesProgress([member(1, READ), member(1.5, WANT_TO_READ)]);
    expect(seriesHeading(p, 2).detail).toBe("2 games · 1 read · next #1.5");
  });
});
