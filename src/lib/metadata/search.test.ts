import { beforeEach, describe, expect, it, vi } from "vitest";
import type { GameMetadata, GameSource } from "@/lib/metadata/types";

/**
 * How the catalogues' answers are combined: searchGames has to tell "no
 * catalogue has this game" apart from "no catalogue answered", ask IGDB only
 * when the server is set up for it, keep the player's order and list each
 * game once. The catalogue clients are stubbed; their own parsing is tested
 * next to them.
 */

const igdbSearch = vi.fn();
const igdbGame = vi.fn();
const wikiSearch = vi.fn();
const wikiGame = vi.fn();
const steamSearch = vi.fn();
const steamGame = vi.fn();
const steamArt = vi.fn();
let igdbOn = false;
vi.mock("@/lib/metadata/igdb", () => ({
  igdbEnabled: () => igdbOn,
  searchIgdb: (q: string, opts?: unknown) => igdbSearch(q, opts),
  getIgdbGame: (slug: string) => igdbGame(slug),
}));
vi.mock("@/lib/metadata/wikipedia", () => ({
  searchWikipedia: (q: string, opts?: unknown) => wikiSearch(q, opts),
  getWikipediaGame: (qid: string) => wikiGame(qid),
}));
vi.mock("@/lib/metadata/steam", () => ({
  searchSteam: (q: string, opts?: unknown) => steamSearch(q, opts),
  getSteamGame: (id: string) => steamGame(id),
  steamCoverArt: (id: string) => steamArt(id),
}));

const { CataloguesUnreachableError, getCoverCandidates, getGameDetails, searchGames } =
  await import("@/lib/metadata");

const down = () => Promise.reject(new Error("down"));

const ids: Record<GameSource, (n: string) => string> = {
  igdb: (n) => `igdb:${n}`,
  wikipedia: () => `wikidata:Q${Math.floor(Math.random() * 1e6)}`,
  steam: () => `steam:${Math.floor(Math.random() * 1e6)}`,
};

function game(source: GameSource, title: string, over: Partial<GameMetadata> = {}): GameMetadata {
  return {
    title,
    developers: [],
    publisher: null,
    platforms: [],
    coverUrl: null,
    description: null,
    lengthMinutes: null,
    releaseDate: null,
    tags: [],
    seriesName: null,
    catalogueId: ids[source](title.toLowerCase().replace(/\W+/g, "-")),
    source,
    ...over,
  };
}

const titles = (rows: GameMetadata[]) => rows.map((r) => `${r.title} (${r.source})`);

beforeEach(() => {
  igdbOn = false;
  for (const f of [igdbSearch, wikiSearch, steamSearch]) f.mockReset().mockResolvedValue([]);
  for (const f of [igdbGame, wikiGame, steamGame, steamArt]) f.mockReset().mockResolvedValue(null);
});

describe("searchGames", () => {
  it("reports an outage when no catalogue answers", async () => {
    wikiSearch.mockImplementation(down);
    steamSearch.mockImplementation(down);
    await expect(searchGames("hollow knight")).rejects.toBeInstanceOf(CataloguesUnreachableError);
  });

  it("returns an empty list when the catalogues answered with nothing", async () => {
    wikiSearch.mockResolvedValue([]);
    steamSearch.mockImplementation(down);
    expect(await searchGames("zzzz")).toEqual([]);
  });

  it("asks IGDB only when the server is set up for it", async () => {
    igdbSearch.mockResolvedValue([game("igdb", "Hollow Knight")]);
    await searchGames("hollow knight");
    expect(igdbSearch).not.toHaveBeenCalled();

    igdbOn = true;
    wikiSearch.mockImplementation(down);
    steamSearch.mockImplementation(down);
    expect(titles(await searchGames("hollow knight"))).toEqual(["Hollow Knight (igdb)"]);

    igdbSearch.mockImplementation(down);
    await expect(searchGames("hollow knight")).rejects.toBeInstanceOf(CataloguesUnreachableError);
  });

  it("falls back to the keyless catalogues when only IGDB is chosen but not set up", async () => {
    wikiSearch.mockResolvedValue([game("wikipedia", "Portal 2", { releaseDate: "2011-04-19" })]);
    expect(titles(await searchGames("portal", ["igdb"]))).toEqual(["Portal 2 (wikipedia)"]);
    expect(igdbSearch).not.toHaveBeenCalled();
    expect(steamSearch).toHaveBeenCalled();
  });

  it("asks only the chosen catalogues, in the chosen order", async () => {
    igdbOn = true;
    igdbSearch.mockResolvedValue([game("igdb", "Celeste", { releaseDate: "2018-01-25" })]);
    steamSearch.mockResolvedValue([game("steam", "Celeste Classic")]);
    expect(titles(await searchGames("celeste", ["steam", "igdb"]))).toEqual([
      "Celeste Classic (steam)",
      "Celeste (igdb)",
    ]);

    expect(titles(await searchGames("celeste", ["steam"]))).toEqual(["Celeste Classic (steam)"]);
    expect(wikiSearch).not.toHaveBeenCalled();
    expect(igdbSearch).toHaveBeenCalledTimes(1);
  });

  it("lists a game once, from the first catalogue, filled in from the others", async () => {
    igdbOn = true;
    igdbSearch.mockResolvedValue([
      game("igdb", "The Witcher 3: Wild Hunt", {
        releaseDate: "2015-05-19",
        developers: ["CD Projekt Red"],
        lengthMinutes: 3090,
      }),
    ]);
    wikiSearch.mockResolvedValue([
      game("wikipedia", "The Witcher 3: Wild Hunt", {
        releaseDate: "2015-05",
        developers: ["CD Projekt"],
        description: "An action role-playing game.",
        coverUrl: "https://upload.wikimedia.org/witcher3.jpg",
        seriesName: "The Witcher",
      }),
    ]);
    const [only, ...rest] = await searchGames("witcher 3");
    expect(rest).toEqual([]);
    expect(only).toMatchObject({
      source: "igdb",
      developers: ["CD Projekt Red"],
      lengthMinutes: 3090,
      description: "An action role-playing game.",
      coverUrl: "https://upload.wikimedia.org/witcher3.jpg",
      seriesName: "The Witcher",
    });
  });

  it("matches titles across catalogues ignoring case, accents, punctuation and ™", async () => {
    wikiSearch.mockResolvedValue([game("wikipedia", "Pokémon Legends: Arceus", { releaseDate: "2022" })]);
    steamSearch.mockResolvedValue([]);
    igdbOn = true;
    igdbSearch.mockResolvedValue([game("igdb", "POKEMON LEGENDS ARCEUS™", { releaseDate: "2022-01-28" })]);
    expect(titles(await searchGames("arceus"))).toEqual(["POKEMON LEGENDS ARCEUS™ (igdb)"]);
  });

  it("keeps same-named games from different years apart", async () => {
    igdbOn = true;
    igdbSearch.mockResolvedValue([
      game("igdb", "Doom", { releaseDate: "1993-12-10" }),
      game("igdb", "Doom", { releaseDate: "2016-05-13" }),
    ]);
    wikiSearch.mockResolvedValue([game("wikipedia", "Doom", { releaseDate: "2016-05-13", seriesName: "Doom" })]);
    const rows = await searchGames("doom");
    expect(rows.map((r) => r.releaseDate)).toEqual(["1993-12-10", "2016-05-13"]);
    expect(rows[1].seriesName).toBe("Doom");
  });

  it("joins a row without a year to the one row of that title with a year", async () => {
    // Steam's search gives no year, and without IGDB keys every PC game
    // would otherwise be listed twice, from Wikipedia and from Steam.
    wikiSearch.mockResolvedValue([
      game("wikipedia", "Hollow Knight", { releaseDate: "2017-02-24", developers: ["Team Cherry"] }),
      game("wikipedia", "Hades"),
    ]);
    steamSearch.mockResolvedValue([
      game("steam", "Hollow Knight", { platforms: ["PC", "Mac", "Linux"] }),
      game("steam", "Hades", { platforms: ["PC", "Mac"] }),
    ]);
    const rows = await searchGames("knight");
    expect(titles(rows)).toEqual(["Hollow Knight (wikipedia)", "Hades (wikipedia)"]);
    expect(rows[0]).toMatchObject({ releaseDate: "2017-02-24", platforms: ["PC", "Mac", "Linux"] });
    // Two rows without a year match by title, as before.
    expect(rows[1].platforms).toEqual(["PC", "Mac"]);
  });

  it("keeps the player's first catalogue's row, taking the year from the other", async () => {
    igdbOn = true;
    steamSearch.mockResolvedValue([game("steam", "Portal 2", { coverUrl: "https://steam.example/620.jpg" })]);
    igdbSearch.mockResolvedValue([game("igdb", "Portal 2", { releaseDate: "2011-04-19", lengthMinutes: 510 })]);
    const rows = await searchGames("portal 2", ["steam", "igdb"]);
    expect(titles(rows)).toEqual(["Portal 2 (steam)"]);
    expect(rows[0]).toMatchObject({
      releaseDate: "2011-04-19",
      lengthMinutes: 510,
      coverUrl: "https://steam.example/620.jpg",
    });
  });

  it("leaves a row without a year alone when its title has more than one year", async () => {
    igdbOn = true;
    igdbSearch.mockResolvedValue([
      game("igdb", "Doom", { releaseDate: "1993-12-10" }),
      game("igdb", "Doom", { releaseDate: "2016-05-13" }),
    ]);
    steamSearch.mockResolvedValue([game("steam", "DOOM", { coverUrl: "https://steam.example/doom.jpg" })]);
    const rows = await searchGames("doom");
    expect(titles(rows)).toEqual(["Doom (igdb)", "Doom (igdb)", "DOOM (steam)"]);
    expect(rows.slice(0, 2).map((r) => r.coverUrl)).toEqual([null, null]);
  });

  it("keeps two entries from the same catalogue", async () => {
    steamSearch.mockResolvedValue([game("steam", "Portal"), game("steam", "Portal")]);
    expect(await searchGames("portal")).toHaveLength(2);
  });
});

describe("getGameDetails", () => {
  it("fetches the entry from its own catalogue by id", async () => {
    steamGame.mockResolvedValue(
      game("steam", "Portal 2", { catalogueId: "steam:620", developers: ["Valve"], releaseDate: "2011-04-18" }),
    );
    const details = await getGameDetails({ catalogueId: "steam:620", title: "Portal 2" });
    expect(steamGame).toHaveBeenCalledWith("620");
    expect(details).toMatchObject({ developers: ["Valve"], releaseDate: "2011-04-18", catalogueId: "steam:620" });
    expect(igdbSearch).not.toHaveBeenCalled();
  });

  it("asks IGDB by title for the time to beat, counting only the exact title", async () => {
    igdbOn = true;
    wikiGame.mockResolvedValue(
      game("wikipedia", "Hollow Knight", { catalogueId: "wikidata:Q20647440", releaseDate: "2017-02-24" }),
    );
    igdbSearch.mockResolvedValue([
      game("igdb", "Hollow Knight: Silksong", { lengthMinutes: 2400 }),
      game("igdb", "Hollow Knight", { lengthMinutes: 1600, releaseDate: "2017-02-24" }),
    ]);
    const details = await getGameDetails({ catalogueId: "wikidata:Q20647440" });
    expect(igdbSearch).toHaveBeenCalledWith("Hollow Knight", undefined);
    expect(details).toMatchObject({ lengthMinutes: 1600, catalogueId: "wikidata:Q20647440" });

    igdbSearch.mockResolvedValue([game("igdb", "Hollow Knight: Silksong", { lengthMinutes: 2400 })]);
    expect((await getGameDetails({ catalogueId: "wikidata:Q20647440" })).lengthMinutes).toBeNull();
  });

  it("prefers the IGDB game from the same year when a title was reused", async () => {
    igdbOn = true;
    steamGame.mockResolvedValue(game("steam", "Doom", { catalogueId: "steam:379720", releaseDate: "2016-05-12" }));
    igdbSearch.mockResolvedValue([
      game("igdb", "Doom", { lengthMinutes: 300, releaseDate: "1993-12-10" }),
      game("igdb", "Doom", { lengthMinutes: 680, releaseDate: "2016-05-13" }),
    ]);
    expect((await getGameDetails({ catalogueId: "steam:379720" })).lengthMinutes).toBe(680);
  });

  it("leaves IGDB alone when it isn't set up, or when the entry has a time already", async () => {
    steamGame.mockResolvedValue(game("steam", "Celeste", { catalogueId: "steam:504230" }));
    await getGameDetails({ catalogueId: "steam:504230" });
    expect(igdbSearch).not.toHaveBeenCalled();

    igdbOn = true;
    igdbGame.mockResolvedValue(game("igdb", "Celeste", { lengthMinutes: 480 }));
    expect((await getGameDetails({ catalogueId: "igdb:celeste" })).lengthMinutes).toBe(480);
    expect(igdbSearch).not.toHaveBeenCalled();
  });

  it("skips a catalogue the player switched off", async () => {
    const details = await getGameDetails({ catalogueId: "steam:620", title: "Portal 2" }, ["wikipedia"]);
    expect(steamGame).not.toHaveBeenCalled();
    expect(details).toMatchObject({ description: null, catalogueId: null });
  });

  it("takes IGDB's game of that exact title when there is no entry to go on", async () => {
    igdbOn = true;
    igdbSearch.mockResolvedValue([
      game("igdb", "Portal 2", { catalogueId: "igdb:portal-2", developers: ["Valve"], lengthMinutes: 520 }),
    ]);
    expect(await getGameDetails({ title: "portal 2" })).toMatchObject({
      catalogueId: "igdb:portal-2",
      developers: ["Valve"],
      lengthMinutes: 520,
    });
    expect(await getGameDetails({ title: "Portal" })).toMatchObject({ catalogueId: null });
  });

  it("answers with nothing when the entry can't be fetched", async () => {
    wikiGame.mockImplementation(down);
    expect(await getGameDetails({ catalogueId: "wikidata:Q1" })).toMatchObject({
      catalogueId: null,
      tags: [],
    });
  });
});

describe("getCoverCandidates", () => {
  it("puts the entry's own cover first, then takes turns between the catalogues", async () => {
    igdbOn = true;
    igdbGame.mockResolvedValue(game("igdb", "Hades", { coverUrl: "https://igdb/hades.jpg" }));
    igdbSearch.mockResolvedValue([
      game("igdb", "Hades", { coverUrl: "https://igdb/hades.jpg" }),
      game("igdb", "Hades II", { coverUrl: "https://igdb/hades2.jpg" }),
    ]);
    wikiSearch.mockResolvedValue([
      game("wikipedia", "Hades", { coverUrl: "https://wiki/hades.jpg" }),
      game("wikipedia", "Hades II", { coverUrl: "https://wiki/hades2.jpg" }),
    ]);
    steamSearch.mockResolvedValue([game("steam", "Hades", { catalogueId: "steam:1145360" })]);
    steamArt.mockResolvedValue("https://steam/1145360.jpg");

    const covers = await getCoverCandidates({ catalogueId: "igdb:hades", title: "Hades" });
    expect(covers.map((c) => c.url)).toEqual([
      "https://igdb/hades.jpg",
      "https://wiki/hades.jpg",
      "https://steam/1145360.jpg",
      "https://igdb/hades2.jpg",
      "https://wiki/hades2.jpg",
    ]);
    expect(covers[2].source).toBe("steam");
    expect(steamArt).toHaveBeenCalledWith("1145360");
  });

  it("drops a catalogue that fails and caps the grid at twelve", async () => {
    wikiSearch.mockResolvedValue(
      Array.from({ length: 20 }, (_, i) => game("wikipedia", `Game ${i}`, { coverUrl: `https://wiki/${i}.jpg` })),
    );
    steamSearch.mockImplementation(down);
    const covers = await getCoverCandidates({ title: "game" });
    expect(covers).toHaveLength(12);
    expect(covers[0]).toEqual({ url: "https://wiki/0.jpg", source: "wikipedia" });
  });

  it("asks for nothing without a title or an entry", async () => {
    expect(await getCoverCandidates({})).toEqual([]);
    expect(wikiSearch).not.toHaveBeenCalled();
  });
});
