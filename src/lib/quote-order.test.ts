import { describe, expect, it } from "vitest";
import {
  QUOTES_MAX,
  QUOTES_PAGE_SIZE,
  compareNewestFirst,
  groupQuotes,
  newSeed,
  orderQuotes,
  parseQuotesParams,
  quotesHref,
  seededShuffle,
  sliceQuoteGroups,
  type OrderableQuote,
} from "@/lib/quote-order";

const PREFS = { quotesOrder: "newest", quotesGroupByGame: false } as const;
const OPTS = { seed: 42, sort: {} };

let n = 0;
/** A quote; each one made is a day newer than the one before. */
function quote(
  over: Partial<OrderableQuote> & {
    gameId?: string;
    title?: string;
    developers?: string[];
    platform?: string | null;
  } = {},
): OrderableQuote {
  n++;
  const { title, developers, platform, ...rest } = over;
  return {
    id: `q${String(n).padStart(3, "0")}`,
    gameId: "g1",
    createdAt: new Date(Date.UTC(2026, 0, n)),
    game: {
      title: title ?? "Game",
      developers: developers ?? ["Some Studio"],
      platform: platform === undefined ? "PC" : platform,
    },
    ...rest,
  };
}

/** n quotes with distinct ids, in id order. */
function many(count: number): OrderableQuote[] {
  return Array.from({ length: count }, () => quote());
}

describe("seededShuffle", () => {
  const items = Array.from({ length: 20 }, (_, i) => `id-${i}`);
  const key = (s: string) => s;

  it("gives the same order for the same seed", () => {
    expect(seededShuffle(items, 7, key)).toEqual(seededShuffle(items, 7, key));
  });

  it("gives a different order for a different seed", () => {
    expect(seededShuffle(items, 7, key)).not.toEqual(seededShuffle(items, 8, key));
  });

  it("returns a permutation and leaves the input alone", () => {
    const copy = [...items];
    const out = seededShuffle(items, 99, key);
    expect(items).toEqual(copy);
    expect([...out].sort()).toEqual([...items].sort());
    expect(out).not.toEqual(items);
  });

  it("does not depend on the input order", () => {
    expect(seededShuffle([...items].reverse(), 5, key)).toEqual(seededShuffle(items, 5, key));
  });

  it("keeps the others in place when one item goes", () => {
    const before = seededShuffle(items, 3, key);
    const after = seededShuffle(
      items.filter((i) => i !== before[4]),
      3,
      key,
    );
    expect(after).toEqual(before.filter((i) => i !== before[4]));
  });
});

describe("newSeed", () => {
  it("stays within 1..2147483647", () => {
    for (let i = 0; i < 200; i++) {
      const s = newSeed();
      expect(Number.isInteger(s)).toBe(true);
      expect(s).toBeGreaterThanOrEqual(1);
      expect(s).toBeLessThanOrEqual(2147483647);
    }
  });
});

describe("compareNewestFirst", () => {
  it("puts the quote added last first", () => {
    const a = quote({ createdAt: new Date("2026-03-01T10:00:00Z") });
    const b = quote({ createdAt: new Date("2026-05-01T10:00:00Z") });
    const c = quote({ createdAt: new Date("2026-01-01T10:00:00Z") });
    expect([a, b, c].sort(compareNewestFirst)).toEqual([b, a, c]);
  });

  it("breaks ties by id, so the order never wobbles", () => {
    const t = new Date("2026-05-01T10:00:00Z");
    const early = quote({ createdAt: new Date("2026-04-01T10:00:00Z") });
    const x = quote({ id: "x", createdAt: t });
    const w = quote({ id: "w", createdAt: t });
    expect([w, early, x].sort(compareNewestFirst)).toEqual([x, w, early]);
  });
});

describe("orderQuotes", () => {
  it("newest and oldest go by date added, with the id breaking ties", () => {
    const t = new Date("2026-05-01T10:00:00Z");
    const a = quote({ createdAt: new Date("2026-01-01T00:00:00Z") });
    const b = quote({ id: "b", createdAt: t });
    const c = quote({ id: "c", createdAt: t });
    expect(orderQuotes([a, b, c], "newest", OPTS)).toEqual([c, b, a]);
    expect(orderQuotes([c, b, a], "oldest", OPTS)).toEqual([a, b, c]);
  });

  it("by game files titles with the player's rules, newest first within", () => {
    const witcherFirst = quote({ gameId: "w", title: "The Witcher 3: Wild Hunt" });
    const witcherLater = quote({ gameId: "w", title: "The Witcher 3: Wild Hunt" });
    const ostersjoen = quote({ gameId: "o", title: "Østersjøen" });
    const zork = quote({ gameId: "z", title: "Zork" });
    const ico = quote({ gameId: "i", title: "Ico" });
    const all = [zork, witcherFirst, ostersjoen, ico, witcherLater];

    // Plain English sorting: "The Witcher 3" under T, Ø with O.
    expect(orderQuotes(all, "game", OPTS).map((q) => q.gameId)).toEqual([
      "i", "o", "w", "w", "z",
    ]);
    // Articles ignored and the Norwegian alphabet: W, then Ø after Z.
    expect(
      orderQuotes(all, "game", { seed: 1, sort: { ignoreArticles: true, alphabet: "nb" } }),
    ).toEqual([ico, witcherLater, witcherFirst, zork, ostersjoen]);
  });

  it("by game sorts same-titled games by developer, then platform", () => {
    const humanHead = quote({ gameId: "h", title: "Prey", developers: ["Human Head Studios"] });
    const arkane = quote({ gameId: "a", title: "Prey", developers: ["Arkane Studios"] });
    expect(orderQuotes([humanHead, arkane], "game", OPTS)).toEqual([arkane, humanHead]);

    // The same game on two systems is two games in the library.
    const pc = quote({ gameId: "p", title: "Hollow Knight", developers: ["Team Cherry"], platform: "PC" });
    const noPlatform = quote({ gameId: "x", title: "Hollow Knight", developers: ["Team Cherry"], platform: null });
    const switchCopy = quote({
      gameId: "s",
      title: "Hollow Knight",
      developers: ["Team Cherry"],
      platform: "Nintendo Switch",
    });
    expect(orderQuotes([pc, switchCopy, noPlatform], "game", OPTS)).toEqual([noPlatform, switchCopy, pc]);
  });

  it("shuffle does not depend on the input order", () => {
    const qs = many(25);
    const shuffled = orderQuotes(qs, "shuffle", OPTS);
    expect(orderQuotes([...qs].reverse(), "shuffle", OPTS)).toEqual(shuffled);
    expect(shuffled).not.toEqual(qs);
    expect(orderQuotes(qs, "shuffle", { ...OPTS, seed: 43 })).not.toEqual(shuffled);
  });
});

describe("groupQuotes", () => {
  const a1 = quote({ gameId: "a", title: "Celeste", createdAt: new Date("2026-03-01T00:00:00Z") });
  const a2 = quote({ gameId: "a", title: "Celeste", createdAt: new Date("2026-06-01T00:00:00Z") });
  const b1 = quote({ gameId: "b", title: "Hades", createdAt: new Date("2026-01-01T00:00:00Z") });
  const b2 = quote({ gameId: "b", title: "Hades", createdAt: new Date("2026-04-01T00:00:00Z") });
  const c1 = quote({ gameId: "c", title: "Inside", createdAt: new Date("2026-02-01T00:00:00Z") });
  const all = [b1, c1, a1, b2, a2];

  it("keeps each game's quotes newest first, whatever order the games are in", () => {
    for (const order of ["newest", "oldest", "game", "shuffle"] as const) {
      const groups = groupQuotes(all, order, OPTS);
      expect(groups.find((g) => g.gameId === "a")!.quotes).toEqual([a2, a1]);
      expect(groups.find((g) => g.gameId === "b")!.quotes).toEqual([b2, b1]);
    }
  });

  it("newest puts the game with the newest quote first", () => {
    expect(groupQuotes(all, "newest", OPTS).map((g) => g.gameId)).toEqual(["a", "b", "c"]);
  });

  it("oldest puts the game with the oldest quote first", () => {
    expect(groupQuotes(all, "oldest", OPTS).map((g) => g.gameId)).toEqual(["b", "c", "a"]);
  });

  it("by game goes by title", () => {
    expect(groupQuotes(all, "game", OPTS).map((g) => g.gameId)).toEqual(["a", "b", "c"]);
  });

  it("shuffle is stable for a seed, whatever the input order", () => {
    const games = Array.from({ length: 12 }, (_, i) => quote({ gameId: `game-${i}` }));
    const order = groupQuotes(games, "shuffle", OPTS).map((g) => g.gameId);
    expect(groupQuotes([...games].reverse(), "shuffle", OPTS).map((g) => g.gameId)).toEqual(order);
    expect(order).not.toEqual(games.map((q) => q.gameId));
  });
});

describe("sliceQuoteGroups", () => {
  const groups = [
    { gameId: "a", quotes: [1, 2, 3] },
    { gameId: "b", quotes: [4, 5, 6, 7] },
    { gameId: "c", quotes: [8] },
  ];

  it("fills groups in order, cuts the last one, and keeps real totals", () => {
    expect(sliceQuoteGroups(groups, 5)).toEqual([
      { gameId: "a", quotes: [1, 2, 3], total: 3 },
      { gameId: "b", quotes: [4, 5], total: 4 },
    ]);
  });

  it("stops exactly at the budget", () => {
    expect(sliceQuoteGroups(groups, 3).map((g) => g.gameId)).toEqual(["a"]);
    expect(sliceQuoteGroups(groups, 100)).toHaveLength(3);
  });
});

describe("parseQuotesParams", () => {
  it("falls back to the saved order and grouping", () => {
    expect(parseQuotesParams({}, PREFS)).toEqual({
      q: "",
      order: "newest",
      group: false,
      seed: null,
      tag: "",
      shelfId: "",
      limit: QUOTES_PAGE_SIZE,
    });
    const saved = { quotesOrder: "game", quotesGroupByGame: true } as const;
    expect(parseQuotesParams({ order: "random", group: "maybe" }, saved)).toMatchObject({
      order: "game",
      group: true,
    });
  });

  it("lets the URL win", () => {
    expect(parseQuotesParams({ order: "oldest", group: "game" }, PREFS)).toMatchObject({
      order: "oldest",
      group: true,
    });
    const saved = { quotesOrder: "shuffle", quotesGroupByGame: true } as const;
    expect(parseQuotesParams({ order: "newest", group: "none" }, saved)).toMatchObject({
      order: "newest",
      group: false,
    });
  });

  it("only takes a seed in range", () => {
    const seed = (s: string) => parseQuotesParams({ seed: s }, PREFS).seed;
    expect(seed("1")).toBe(1);
    expect(seed("2147483647")).toBe(2147483647);
    expect(seed("0")).toBeNull();
    expect(seed("abc")).toBeNull();
    expect(seed("-5")).toBeNull();
    expect(seed("2147483648")).toBeNull();
    expect(seed("12345678901")).toBeNull();
  });

  it("clamps the limit", () => {
    const limit = (l: string) => parseQuotesParams({ limit: l }, PREFS).limit;
    expect(limit("50")).toBe(QUOTES_PAGE_SIZE);
    expect(limit("400")).toBe(400);
    expect(limit("99999")).toBe(QUOTES_MAX);
    expect(limit("lots")).toBe(QUOTES_PAGE_SIZE);
  });

  it("drops null bytes, trims, and refuses odd values", () => {
    const p = parseQuotesParams(
      { q: " hope\0 ", tag: "\0fantasy ", shelfId: "abc;drop" },
      PREFS,
    );
    expect(p.q).toBe("hope");
    expect(p.tag).toBe("fantasy");
    expect(p.shelfId).toBe("");
    expect(parseQuotesParams({ tag: "x".repeat(201) }, PREFS).tag).toBe("");
    expect(parseQuotesParams({ shelfId: "clx9abc123" }, PREFS).shelfId).toBe("clx9abc123");
  });

  it("ignores repeated params", () => {
    expect(parseQuotesParams({ order: ["oldest", "game"] }, PREFS).order).toBe("newest");
  });
});

describe("quotesHref", () => {
  const roundTrip = (href: string) =>
    parseQuotesParams(Object.fromEntries(new URLSearchParams(href.slice(href.indexOf("?") + 1))), PREFS);

  it("always writes order and group", () => {
    expect(quotesHref({ order: "newest", group: false })).toBe("/quotes?order=newest&group=none");
    expect(quotesHref({ order: "game", group: true })).toBe("/quotes?order=game&group=game");
  });

  it("writes the seed only for a shuffle", () => {
    expect(quotesHref({ order: "newest", group: false, seed: 5 })).not.toContain("seed");
    expect(quotesHref({ order: "shuffle", group: false, seed: 5 })).toContain("seed=5");
  });

  it("writes the limit only above one page", () => {
    expect(quotesHref({ order: "newest", group: false, limit: 200 })).not.toContain("limit");
    expect(quotesHref({ order: "newest", group: false, limit: 400 })).toContain("limit=400");
  });

  it("keeps one From filter, the shelf winning", () => {
    const href = quotesHref({ order: "newest", group: false, tag: "fantasy", shelfId: "s1" });
    expect(href).toContain("shelfId=s1");
    expect(href).not.toContain("tag=");
  });

  it("round-trips through parseQuotesParams", () => {
    const p = {
      q: "a & b?",
      order: "shuffle",
      group: true,
      seed: 123456,
      tag: "sci-fi & more",
      shelfId: "",
      limit: 600,
    } as const;
    expect(roundTrip(quotesHref(p))).toEqual(p);
  });
});
