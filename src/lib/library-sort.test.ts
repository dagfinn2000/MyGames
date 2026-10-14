import { describe, expect, it } from "vitest";
import { GameFormat, GameOwnership, PlayStatus } from "@prisma/client";
import {
  developerSortKey,
  groupGames,
  ratingLabel,
  releaseSortKey,
  releaseYear,
  seriesHeading,
  seriesProgress,
  sliceGroups,
  sortGames,
  titleSortKey,
  type GroupableGame,
} from "@/lib/library-sort";

function game(overrides: Partial<GroupableGame> & { title: string }): GroupableGame {
  return {
    developers: [],
    rating: null,
    seriesName: null,
    seriesNumber: null,
    dateFinished: null,
    dateStarted: null,
    lengthMinutes: null,
    releaseDate: null,
    createdAt: new Date(0),
    updatedAt: new Date(0),
    status: PlayStatus.WANT_TO_PLAY,
    format: GameFormat.PHYSICAL,
    ownership: GameOwnership.OWNED,
    platform: null,
    tags: [],
    ...overrides,
  };
}

describe("developerSortKey", () => {
  it("files studios as written, case and stray spaces aside", () => {
    expect(developerSortKey("Team Cherry")).toBe("team cherry");
    expect(developerSortKey("  FromSoftware ")).toBe("fromsoftware");
  });

  it("never files a name by its last word, nor skips a leading The", () => {
    // A studio's name is one name: nothing is filed by its last word.
    expect(developerSortKey("Hideo Kojima")).toBe("hideo kojima");
    expect(developerSortKey("The Chinese Room")).toBe("the chinese room");
  });
});

describe("sortGames by developer", () => {
  const cherry = game({ title: "Hollow Knight", developers: ["Team Cherry"] });
  const chineseRoom = game({ title: "Dear Esther", developers: ["The Chinese Room"] });
  const valve = game({ title: "Half-Life", developers: ["Valve"] });
  const cdpr = game({ title: "The Witcher 3: Wild Hunt", developers: ["CD Projekt Red"] });

  it("orders developers as written, a leading The included", () => {
    const sorted = sortGames([valve, chineseRoom, cherry, cdpr], "developer", "asc");
    expect(sorted.map((b) => b.title)).toEqual([
      "The Witcher 3: Wild Hunt", // CD Projekt Red
      "Hollow Knight", // Team Cherry
      "Dear Esther", // The Chinese Room, under T
      "Half-Life", // Valve
    ]);
  });

  it("flips developer order on desc but keeps shelf order within a developer", () => {
    const portal = game({
      title: "Portal",
      developers: ["Valve"],
      seriesName: "Portal",
      seriesNumber: 1,
    });
    const portal2 = game({
      title: "Portal 2",
      developers: ["Valve"],
      seriesName: "Portal",
      seriesNumber: 2,
    });
    const sorted = sortGames([portal2, cherry, portal], "developer", "desc");
    expect(sorted.map((b) => b.title)).toEqual([
      "Portal", // Valve before Team Cherry on desc…
      "Portal 2", // …but the series stays in play order
      "Hollow Knight",
    ]);
  });

  it("keeps a series together as a block, in series order, spin-offs slotted in", () => {
    const one = game({
      title: "Dark Souls",
      developers: ["FromSoftware"],
      seriesName: "Dark Souls",
      seriesNumber: 1,
    });
    const spinOff = game({
      title: "Zz Artorias of the Abyss", // title alone would sort it last
      developers: ["FromSoftware"],
      seriesName: "Dark Souls",
      seriesNumber: 1.5,
    });
    const two = game({
      title: "Dark Souls II",
      developers: ["FromSoftware"],
      seriesName: "Dark Souls",
      seriesNumber: 2,
    });
    const standalone = game({ title: "Bloodborne", developers: ["FromSoftware"] });
    const laterStandalone = game({ title: "Sekiro: Shadows Die Twice", developers: ["FromSoftware"] });

    const sorted = sortGames([two, laterStandalone, spinOff, standalone, one], "developer", "asc");
    expect(sorted.map((b) => b.title)).toEqual([
      "Bloodborne", // B before D(ark Souls)
      "Dark Souls", // Dark Souls block: 1, 1.5, 2
      "Zz Artorias of the Abyss",
      "Dark Souls II",
      "Sekiro: Shadows Die Twice", // S after D
    ]);
  });
});

describe("sortGames by field", () => {
  it("sorts by title", () => {
    const sorted = sortGames(
      [game({ title: "Portal" }), game({ title: "Celeste" })],
      "title",
      "asc",
    );
    expect(sorted.map((b) => b.title)).toEqual(["Celeste", "Portal"]);
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

  it("groups by developer as written, games without one last", () => {
    const groups = groupGames(
      [
        game({ title: "V", developers: ["Valve"] }),
        game({ title: "X" }), // no developer
        game({ title: "T", developers: ["Team Cherry"] }),
      ],
      "developer",
    );
    // Last, like the developer sort puts them.
    expect(groups?.map((g) => g.title)).toEqual(["Team Cherry", "Valve", "Unknown developer"]);
  });

  it("groups by platform by name, games without one last", () => {
    const groups = groupGames(
      [
        game({ title: "Hades", platform: "PC" }),
        game({ title: "Celeste", platform: "Nintendo Switch" }),
        game({ title: "Tetris" }),
        game({ title: "Blank", platform: "  " }),
        game({ title: "Portal 2", platform: "PC" }),
      ],
      "platform",
    )!;
    expect(groups.map((g) => g.title)).toEqual(["Nintendo Switch", "PC", "No platform"]);
    // In the order they came, as with every grouping but series.
    expect(groups[1].games.map((b) => b.title)).toEqual(["Hades", "Portal 2"]);
    expect(groups[2].games.map((b) => b.title)).toEqual(["Tetris", "Blank"]);
  });

  it("groups by series in play order, non-series games trailing", () => {
    const groups = groupGames(
      [
        game({ title: "Standalone" }),
        game({ title: "Two", seriesName: "Saga", seriesNumber: 2 }),
        game({ title: "One", seriesName: "Saga", seriesNumber: 1 }),
        game({ title: "Spin-off", seriesName: "Saga", seriesNumber: 1.5 }),
      ],
      "series",
    );
    expect(groups?.map((g) => g.title)).toEqual(["Saga", "Not in a series"]);
    expect(groups?.[0].games.map((b) => b.title)).toEqual(["One", "Spin-off", "Two"]);
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
      game({ title: "The Witcher 3: Wild Hunt" }),
      game({ title: "Celeste" }),
      game({ title: "A Short Hike" }),
    ];
    expect(titles(sortGames(games, "title", "asc"))).toEqual([
      "A Short Hike",
      "Celeste",
      "The Witcher 3: Wild Hunt",
    ]);
    expect(titles(sortGames(games, "title", "asc", { ignoreArticles: true }))).toEqual([
      "Celeste",
      "A Short Hike",
      "The Witcher 3: Wild Hunt",
    ]);
  });

  it("skips the alphabet's own articles too, but never a whole title", () => {
    expect(titleSortKey("Die Gilde", { ignoreArticles: true, alphabet: "de" })).toBe("Gilde");
    expect(titleSortKey("Die Gilde", { ignoreArticles: true })).toBe("Die Gilde");
    expect(titleSortKey("A", { ignoreArticles: true })).toBe("A");
  });

  it("puts Æ, Ø and Å after Z in the Norwegian alphabet", () => {
    const games = [game({ title: "Åsgard" }), game({ title: "Zork" }), game({ title: "Æther" })];
    expect(titles(sortGames(games, "title", "asc", { alphabet: "nb" }))).toEqual([
      "Zork",
      "Æther",
      "Åsgard",
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
      ["length", { lengthMinutes: 600 }, { lengthMinutes: 3000 }],
      ["released", { releaseDate: "1998" }, { releaseDate: "2017-03" }],
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

  it("counts a time to beat of 0 as none", () => {
    const games = [
      game({ title: "Zero", lengthMinutes: 0 }),
      game({ title: "Some", lengthMinutes: 10 }),
    ];
    expect(titles(sortGames(games, "length", "asc"))).toEqual(["Some", "Zero"]);
  });

  it("breaks ties by developer, then title, A to Z even when sorted descending", () => {
    const games = [
      game({ title: "B", developers: ["Valve"], rating: 8 }),
      game({ title: "Z", developers: ["CD Projekt Red"], rating: 8 }),
      game({ title: "A", developers: ["Valve"], rating: 8 }),
      game({ title: "No developer", rating: 8 }),
      game({ title: "Top", developers: ["Valve"], rating: 10 }),
    ];
    expect(titles(sortGames(games, "rating", "desc"))).toEqual([
      "Top",
      "Z",
      "A",
      "B",
      "No developer",
    ]);
  });

  it("puts games without a developer last under Developer, both ways", () => {
    const games = [
      game({ title: "Nobody's" }),
      game({ title: "Valve's", developers: ["Valve"] }),
      game({ title: "Cherry's", developers: ["Team Cherry"] }),
    ];
    expect(titles(sortGames(games, "developer", "asc"))).toEqual(["Cherry's", "Valve's", "Nobody's"]);
    expect(titles(sortGames(games, "developer", "desc"))).toEqual(["Valve's", "Cherry's", "Nobody's"]);
  });

  it("sorts by release date and by when a game was last changed", () => {
    const games = [
      game({ title: "Old", releaseDate: "Q4 1998", updatedAt: new Date(3000) }),
      game({ title: "New", releaseDate: "2020-05-01", updatedAt: new Date(1000) }),
    ];
    expect(titles(sortGames(games, "released", "desc"))).toEqual(["New", "Old"]);
    expect(titles(sortGames(games, "updatedAt", "desc"))).toEqual(["Old", "New"]);
  });

  it("sorts releases within a year by month and day, a bare year first", () => {
    const games = [
      game({ title: "Day", releaseDate: "2017-03-03" }),
      game({ title: "Year", releaseDate: "2017" }),
      game({ title: "Month", releaseDate: "2017-02" }),
      game({ title: "Earlier", releaseDate: "2016-12-31" }),
    ];
    expect(titles(sortGames(games, "released", "asc"))).toEqual(["Earlier", "Year", "Month", "Day"]);
  });

  it("falls back to date added for a sort name from Object's prototype", () => {
    const older = game({ title: "Older", createdAt: new Date(1000) });
    const newer = game({ title: "Newer", createdAt: new Date(2000) });
    expect(titles(sortGames([older, newer], "constructor", "desc"))).toEqual(["Newer", "Older"]);
  });
});

describe("release dates", () => {
  it("reads the first four-digit year", () => {
    expect(releaseYear("2017-03")).toBe(2017);
    expect(releaseYear("Q4 1998")).toBe(1998);
    expect(releaseYear("Nov 14, 2023")).toBe(2023);
    expect(releaseYear("")).toBeNull();
    expect(releaseYear(null)).toBeNull();
    expect(releaseYear("TBA")).toBeNull();
  });

  it("turns a date into a number that sorts, to the day where it's known", () => {
    expect(releaseSortKey("2017-03-03")).toBe(20170303);
    expect(releaseSortKey("2017-3")).toBe(20170300);
    expect(releaseSortKey("2017")).toBe(20170000);
    expect(releaseSortKey("Nov 14, 2023")).toBe(20230000);
    // A span of years is its first year, not a month called 20.
    expect(releaseSortKey("1998-2001")).toBe(19980000);
    expect(releaseSortKey("TBA")).toBeNull();
    expect(releaseSortKey(null)).toBeNull();
  });
});

describe("the newer groupings", () => {
  const titles = (g: { games: GroupableGame[] }) => g.games.map((b) => b.title);
  const completed = (title: string, dateFinished?: string) =>
    game({
      title,
      status: PlayStatus.COMPLETED,
      dateFinished: dateFinished ? new Date(dateFinished) : null,
    });

  it("files finishes by year in the player's zone, newest first", () => {
    const games = [
      // 23:30 UTC on New Year's Eve is already 2026 in Oslo.
      completed("Late", "2025-12-31T23:30:00Z"),
      // Typed into a date field: that day everywhere, New York included.
      completed("Typed", "2026-01-01T00:00:00Z"),
      completed("Older", "2024-06-01T10:00:00Z"),
      completed("Undated"),
      // Not Completed, so a leftover date doesn't count.
      game({
        title: "Playing",
        status: PlayStatus.PLAYING,
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

  it("files statuses in playing order and drops empty ones", () => {
    const groups = groupGames(
      [
        game({ title: "Done", status: PlayStatus.COMPLETED }),
        game({ title: "Now", status: PlayStatus.PLAYING }),
        game({ title: "Later", status: PlayStatus.WANT_TO_PLAY }),
      ],
      "status",
    )!;
    expect(groups.map((g) => g.title)).toEqual(["Playing", "Want to Play", "Completed"]);
  });

  it("files formats and ownership in a fixed order with their labels", () => {
    const games = [
      game({ title: "S", format: GameFormat.SUBSCRIPTION, ownership: GameOwnership.GIVEN_AWAY }),
      game({ title: "D", format: GameFormat.DIGITAL, ownership: GameOwnership.WISHLIST }),
      game({ title: "P", format: GameFormat.PHYSICAL, ownership: GameOwnership.BORROWED }),
      game({ title: "O", format: GameFormat.PHYSICAL, ownership: GameOwnership.OWNED }),
    ];
    expect(groupGames(games, "format")!.map((g) => g.title)).toEqual([
      "Physical",
      "Digital",
      "Subscription",
    ]);
    expect(groupGames(games, "ownership")!.map((g) => g.title)).toEqual([
      "Owned",
      "Borrowed",
      "Wishlist",
      "No longer have it",
    ]);
  });

  it("puts a game under each of its tags, in the player's alphabet, untagged last", () => {
    const games = [
      game({ title: "Both", tags: ["åpen verden", "zombies"] }),
      game({ title: "None" }),
      game({ title: "One", tags: ["zombies"] }),
    ];
    const groups = groupGames(games, "tag", { alphabet: "nb" })!;
    expect(groups.map((g) => g.title)).toEqual(["zombies", "åpen verden", "No tags"]);
    expect(titles(groups[0])).toEqual(["Both", "One"]);
    expect(titles(groups[1])).toEqual(["Both"]);
  });

  it("files shelves in the player's shelf order, then by name, unshelved last", () => {
    const fav = { id: "s-fav", name: "Favourites" };
    const cosy = { id: "s-cosy", name: "Cosy games" };
    const coop = { id: "s-coop", name: "Couch co-op" };
    const games = [
      game({ title: "Loose", shelves: [] }),
      game({ title: "Loved", shelves: [fav, cosy] }),
      game({ title: "Party", shelves: [coop] }),
    ];
    expect(groupGames(games, "shelf")!.map((g) => g.title)).toEqual([
      "Cosy games",
      "Couch co-op",
      "Favourites",
      "Not on a shelf",
    ]);
    const ordered = groupGames(games, "shelf", { shelfOrder: ["s-fav", "deleted-shelf"] })!;
    expect(ordered.map((g) => g.title)).toEqual([
      "Favourites",
      "Cosy games",
      "Couch co-op",
      "Not on a shelf",
    ]);
  });

  it("is one 'Not on a shelf' section when there are no shelves", () => {
    const groups = groupGames([game({ title: "A" })], "shelf")!;
    expect(groups.map((g) => g.title)).toEqual(["Not on a shelf"]);
  });

  it("files ratings highest first in the player's style, unrated last", () => {
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
      game({
        title: "A",
        developers: ["Valve"],
        platform: "PC",
        seriesName: "S",
        tags: ["x"],
        rating: 8,
      }),
      completed("B", "2024-02-02T10:00:00Z"),
    ];
    const groupings = [
      "developer",
      "platform",
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
        game({ title: "Two", seriesName: "halo ", seriesNumber: 2 }),
        game({ title: "One", seriesName: "Halo", seriesNumber: 1 }),
      ],
      "series",
    )!;
    expect(groups).toHaveLength(1);
    expect(groups[0].title).toBe("halo");
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
  const { WANT_TO_PLAY, PLAYING, COMPLETED, DROPPED } = PlayStatus;
  const member = (seriesNumber: number | null, status: PlayStatus, timesCompleted = 0) => ({
    seriesNumber,
    status,
    timesCompleted,
  });

  it("counts what's completed and names what's next", () => {
    const p = seriesProgress([
      member(1, COMPLETED),
      member(2, COMPLETED),
      member(3, COMPLETED),
      member(4, WANT_TO_PLAY),
      member(5, WANT_TO_PLAY),
    ]);
    expect(p).toMatchObject({ total: 5, completed: 3, playing: null, next: 4, missing: [] });
    expect(seriesHeading(p, 5)).toEqual({ detail: "5 games · 3 completed · next #4" });
  });

  it("says which game is being played instead of what's next", () => {
    const p = seriesProgress([member(1, COMPLETED), member(2, PLAYING), member(3, WANT_TO_PLAY)]);
    expect(p.playing).toBe(2);
    expect(seriesHeading(p, 3).detail).toBe("3 games · 1 completed · playing #2");
  });

  it("skips dropped games, as Pick for me does", () => {
    const p = seriesProgress([member(1, COMPLETED), member(2, DROPPED), member(3, WANT_TO_PLAY)]);
    expect(p.next).toBe(3);
    expect(p.completed).toBe(1);
  });

  it("counts a game completed before and being replayed as completed", () => {
    const p = seriesProgress([member(1, PLAYING, 1), member(2, COMPLETED)]);
    expect(p.completed).toBe(2);
    expect(seriesHeading(p, 2).detail).toBe("2 games · all completed");
  });

  it("lists whole numbers with no game; spin-offs and prequels fill no gap", () => {
    const p = seriesProgress([
      member(0, COMPLETED),
      member(1.5, COMPLETED),
      member(2, COMPLETED),
      member(6, WANT_TO_PLAY),
      member(null, WANT_TO_PLAY),
    ]);
    expect(p.missing).toEqual([1, 3, 4, 5]);
    expect(seriesHeading(p, 5).note).toBe("#1, #3, #4, #5 missing");
  });

  it("shortens a long list of gaps", () => {
    const p = seriesProgress([member(1, COMPLETED), member(10, WANT_TO_PLAY)]);
    expect(seriesHeading(p, 2).note).toBe("#2, #3, #4, #5, #6 and 3 more missing");
  });

  it("has no next or gaps for a series without numbers", () => {
    const p = seriesProgress([member(null, COMPLETED), member(null, WANT_TO_PLAY)]);
    expect(p).toMatchObject({ next: null, playing: null, missing: [] });
    expect(seriesHeading(p, 2)).toEqual({ detail: "2 games · 1 completed" });
  });

  it("says when the filters on screen show only part of a series", () => {
    const p = seriesProgress([member(1, COMPLETED), member(2, COMPLETED), member(3, WANT_TO_PLAY)]);
    expect(seriesHeading(p, 1).detail).toBe("1 of 3 games · 2 completed · next #3");
  });

  it("prints numbers as stored", () => {
    const p = seriesProgress([member(1, COMPLETED), member(1.5, WANT_TO_PLAY)]);
    expect(seriesHeading(p, 2).detail).toBe("2 games · 1 completed · next #1.5");
  });
});
