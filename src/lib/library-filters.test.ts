import { describe, expect, it } from "vitest";
import { PlayStatus } from "@prisma/client";
import {
  activeFilterChips,
  buildGameWhere,
  finishedYearRanges,
  parseFilters,
  searchPlaceholder,
  setTagState,
  tagList,
} from "@/lib/library-filters";

const where = (sp: Record<string, string>, ctx = {}) => buildGameWhere("u1", parseFilters(sp), ctx);

describe("parseFilters", () => {
  it("cleans tag lists: trimmed, each once, without 'all'", () => {
    expect(parseFilters({ tag: " metroidvania, classic ,,metroidvania,all" }).tag).toBe(
      "metroidvania,classic",
    );
    expect(parseFilters({ tag: "all" }).tag).toBe("");
  });

  it("keeps a tag in both lists only as left out", () => {
    const f = parseFilters({ tag: "metroidvania,classic", notTag: "classic" });
    expect(f.tag).toBe("metroidvania");
    expect(f.notTag).toBe("classic");
  });

  it("splits a tag at its comma: the list can't hold one", () => {
    expect(tagList("shoot, 'em up")).toEqual(["shoot", "'em up"]);
  });

  it("keeps 'all' tag matching only alongside tags", () => {
    expect(parseFilters({ tag: "a,b", tagMatch: "all" }).tagMatch).toBe("all");
    expect(parseFilters({ tagMatch: "all" }).tagMatch).toBe("");
    expect(parseFilters({ tag: "a", tagMatch: "any" }).tagMatch).toBe("");
  });

  it("only takes a year from 1000 on", () => {
    expect(parseFilters({ finished: "2024" }).finished).toBe("2024");
    for (const bad of ["abcd", "20245", "0099", "999", "2024 "]) {
      expect(parseFilters({ finished: bad }).finished, bad).toBe("");
    }
  });

  it("only takes known values for missing, rating and ownership", () => {
    expect(parseFilters({ missing: "length" }).missing).toBe("length");
    expect(parseFilters({ missing: "platform" }).missing).toBe("platform");
    expect(parseFilters({ missing: "spine" }).missing).toBe("");
    expect(parseFilters({ minRating: "unrated" }).minRating).toBe("unrated");
    expect(parseFilters({ minRating: "8" }).minRating).toBe("8");
    expect(parseFilters({ minRating: "all" }).minRating).toBe("");
    expect(parseFilters({ minRating: "11" }).minRating).toBe("");
    expect(parseFilters({ owned: "lent" }).owned).toBe("lent");
    expect(parseFilters({ owned: "constructor" }).owned).toBe("all");
  });

  it("trims the developer and platform and caps their length", () => {
    expect(parseFilters({ developer: "  Team Cherry " }).developer).toBe("Team Cherry");
    expect(parseFilters({ developer: "x".repeat(600) }).developer).toHaveLength(500);
    expect(parseFilters({ platform: " Nintendo Switch " }).platform).toBe("Nintendo Switch");
    expect(parseFilters({ platform: "x".repeat(200) }).platform).toHaveLength(100);
  });

  it("drops null bytes from every new parameter", () => {
    const f = parseFilters({
      developer: "Team\0 Cherry",
      platform: "P\0C",
      tag: "fan\0tasy",
      notTag: "clas\0sic",
      tagMatch: "a\0ll",
      finished: "20\x0024",
      missing: "co\0ver",
      minRating: "unr\0ated",
    });
    expect(f).toMatchObject({
      developer: "Team Cherry",
      platform: "PC",
      tag: "fantasy",
      notTag: "classic",
      tagMatch: "all",
      finished: "2024",
      missing: "cover",
      minRating: "unrated",
    });
  });
});

describe("buildGameWhere", () => {
  it("builds exactly the old shape for the old filters", () => {
    expect(
      where({ shelf: "COMPLETED", tag: "rpg", q: "witcher", minRating: "8", series: "The Witcher" }),
    ).toEqual({
      userId: "u1",
      status: PlayStatus.COMPLETED,
      rating: { gte: 8 },
      tags: { has: "rpg" },
      seriesName: { equals: "The Witcher", mode: "insensitive" },
      AND: [{ searchText: { contains: "witcher" } }],
    });
  });

  it("matches any, all or none of several tags", () => {
    expect(where({ tag: "a,b" }).tags).toEqual({ hasSome: ["a", "b"] });
    expect(where({ tag: "a,b", tagMatch: "all" }).tags).toEqual({ hasEvery: ["a", "b"] });
    expect(where({ notTag: "c" }).AND).toEqual([{ NOT: { tags: { hasSome: ["c"] } } }]);
  });

  it("matches one developer exactly", () => {
    expect(where({ developer: "Team Cherry" }).developers).toEqual({ has: "Team Cherry" });
  });

  it("matches one platform exactly, like a format", () => {
    expect(where({ platform: "Nintendo Switch", format: "DIGITAL" })).toEqual({
      userId: "u1",
      format: "DIGITAL",
      platform: "Nintendo Switch",
    });
    // A format the library doesn't have is no filter at all.
    expect(where({ format: "EBOOK" }).format).toBeUndefined();
  });

  it("leaves the status tab alone for unrated games", () => {
    const w = where({ shelf: "COMPLETED", minRating: "unrated" });
    expect(w.status).toBe(PlayStatus.COMPLETED);
    expect(w.rating).toBeUndefined();
    expect(w.AND).toEqual([{ rating: null }, { status: { not: PlayStatus.WANT_TO_PLAY } }]);
  });

  it("looks for each missing detail", () => {
    expect(where({ missing: "cover" }).AND).toEqual([{ OR: [{ coverUrl: null }, { coverUrl: "" }] }]);
    expect(where({ missing: "length" }).AND).toEqual([
      { OR: [{ lengthMinutes: null }, { lengthMinutes: { lte: 0 } }] },
    ]);
    expect(where({ missing: "platform" }).AND).toEqual([
      { OR: [{ platform: null }, { platform: "" }] },
    ]);
    expect(where({ missing: "tags" }).AND).toEqual([{ tags: { isEmpty: true } }]);
  });

  it("finds a year's finishes: the sure middle, and the edges looked up ahead", () => {
    const { sure } = finishedYearRanges(2024);
    expect(where({ finished: "2024" }).AND).toEqual([
      {
        OR: [
          { status: PlayStatus.COMPLETED, dateFinished: sure },
          { playthroughs: { some: { dateFinished: sure } } },
        ],
      },
    ]);
    const withEdges = where({ finished: "2024" }, { finishedEdgeIds: ["b1"] });
    expect(withEdges.AND).toEqual([
      {
        OR: [
          { status: PlayStatus.COMPLETED, dateFinished: sure },
          { playthroughs: { some: { dateFinished: sure } } },
          { id: { in: ["b1"] } },
        ],
      },
    ]);
  });

  it("covers every zone between the sure middle and the edges", () => {
    const { sure, edges } = finishedYearRanges(2024);
    expect(edges[0].lt).toEqual(sure.gte);
    expect(edges[1].gte).toEqual(sure.lt);
    // Kiritimati (UTC+14) and Baker Island (UTC−12) both fall inside.
    expect(edges[0].gte.getTime()).toBeLessThanOrEqual(Date.UTC(2024, 0, 1) - 14 * 3600_000);
    expect(edges[1].lt.getTime()).toBeGreaterThanOrEqual(Date.UTC(2025, 0, 1) + 12 * 3600_000);
  });

  it("matches every word, a number like any other", () => {
    // A number is a word like any other: part of a title ("1942"), or a year.
    expect(where({ q: "doom 1993" }).AND).toEqual([
      { searchText: { contains: "doom" } },
      { searchText: { contains: "1993" } },
    ]);
  });

  it("adds the tag and review matches for each word", () => {
    const w = where(
      { q: "fromsoftware souls" },
      { searchIn: ["tags", "review"], tagsByTerm: [[], ["soulslike", "souls"]] },
    );
    expect(w.AND).toEqual([
      {
        OR: [
          { searchText: { contains: "fromsoftware" } },
          { reviewSearchText: { contains: "fromsoftware" } },
        ],
      },
      {
        OR: [
          { searchText: { contains: "souls" } },
          { tags: { hasSome: ["soulslike", "souls"] } },
          { reviewSearchText: { contains: "souls" } },
        ],
      },
    ]);
  });
});

describe("activeFilterChips", () => {
  const label = (v: string) => `≥ ${v}/10`;

  it("labels every chip and says how to remove it", () => {
    const chips = activeFilterChips(
      parseFilters({
        developer: "Team Cherry",
        tag: "metroidvania,classic",
        tagMatch: "all",
        notTag: "horror",
        finished: "2024",
        minRating: "8",
        missing: "length",
        series: "Hollow Knight",
      }),
      label,
    );
    expect(chips.map((c) => c.label)).toEqual([
      "Developer: Team Cherry",
      "Tag: metroidvania",
      "Tag: classic",
      "Not tagged: horror",
      "Finished in 2024",
      "Rating: ≥ 8/10",
      "Missing: time to beat",
      "Series: Hollow Knight",
    ]);
    // Removing one tag keeps the others, and how they match.
    expect(chips[1].clear).toEqual({ tag: "classic", tagMatch: "all" });
    expect(chips[3].clear).toEqual({ notTag: "" });
    expect(chips[0].clear).toEqual({ developer: "" });
  });

  it("drops the match rule with the last tag", () => {
    const [chip] = activeFilterChips(parseFilters({ tag: "roguelike", tagMatch: "all" }), label);
    expect(chip.clear).toEqual({ tag: "", tagMatch: "" });
  });

  it("calls unrated games Unrated, and has no chips for filters on the bar", () => {
    expect(activeFilterChips(parseFilters({ minRating: "unrated" }), label)[0].label).toBe("Unrated");
    // Search, format and platform each show in their own control.
    expect(
      activeFilterChips(parseFilters({ q: "zelda", format: "DIGITAL", platform: "PC" }), label),
    ).toEqual([]);
  });
});

describe("setTagState", () => {
  it("never keeps a tag in both lists", () => {
    const start = { include: ["co-op"], exclude: ["horror"] };
    expect(setTagState(start, "horror", "in")).toEqual({ include: ["co-op", "horror"], exclude: [] });
    expect(setTagState(start, "co-op", "not")).toEqual({ include: [], exclude: ["horror", "co-op"] });
    expect(setTagState(start, "co-op", "off")).toEqual({ include: [], exclude: ["horror"] });
  });
});

describe("searchPlaceholder", () => {
  it("names what the search looks in", () => {
    expect(searchPlaceholder([])).toBe("Search title or developer…");
    expect(searchPlaceholder(["review"])).toBe("Search title, developer or review…");
    expect(searchPlaceholder(["review", "tags"])).toBe("Search title, developer, tags or review…");
  });
});
