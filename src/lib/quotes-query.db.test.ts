import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { parseQuotesParams, type QuotesParams } from "@/lib/quote-order";
import { loadQuotes, quoteSources } from "@/lib/quotes-query";

/**
 * The quotes page's queries against a real database: every filter stays
 * inside the player's own library, the From filter and search match what
 * they say, and Show more and shuffle agree with each other.
 */
const prisma = new PrismaClient();

let userId: string;
let otherUserId: string;

const PREFS = { quotesOrder: "newest", quotesGroupByGame: false } as const;
const SORT = {};

function params(over: Partial<QuotesParams> = {}): QuotesParams {
  return { ...parseQuotesParams({}, PREFS), ...over };
}

async function makeGame(owner: string, over: Record<string, unknown> = {}) {
  return prisma.game.create({
    data: { userId: owner, title: "Untitled", searchText: "untitled", ...over },
  });
}

async function addQuotes(
  gameId: string,
  quotes: { text: string; speaker?: string; note?: string; at?: string }[],
) {
  for (const q of quotes) {
    await prisma.quote.create({
      data: {
        gameId,
        text: q.text,
        speaker: q.speaker ?? null,
        note: q.note ?? null,
        ...(q.at && { createdAt: new Date(q.at) }),
      },
    });
  }
}

beforeEach(async () => {
  const stamp = `${Date.now()}-${Math.random()}`;
  const [a, b] = await Promise.all([
    prisma.user.create({ data: { username: `qq-${stamp}`, passwordHash: "x" } }),
    prisma.user.create({ data: { username: `qo-${stamp}`, passwordHash: "x" } }),
  ]);
  userId = a.id;
  otherUserId = b.id;
});

afterEach(async () => {
  await prisma.user.deleteMany({ where: { id: { in: [userId, otherUserId] } } });
});

describe("loadQuotes", () => {
  it("never shows another player's quotes, even with their shelf or tag", async () => {
    const theirShelf = await prisma.shelf.create({ data: { userId: otherUserId, name: "Theirs" } });
    const theirs = await makeGame(otherUserId, {
      title: "Their Game",
      tags: ["secret"],
      shelves: { connect: { id: theirShelf.id } },
    });
    await addQuotes(theirs.id, [{ text: "Not yours" }]);
    const mine = await makeGame(userId, { title: "My Game", tags: ["secret"] });
    await addQuotes(mine.id, [{ text: "Mine" }]);

    const all = await loadQuotes(userId, params(), SORT);
    expect(all.list!.map((q) => q.text)).toEqual(["Mine"]);

    const byShelf = await loadQuotes(userId, params({ shelfId: theirShelf.id }), SORT);
    expect(byShelf.total).toBe(0);
    const byTag = await loadQuotes(userId, params({ tag: "secret" }), SORT);
    expect(byTag.list!.map((q) => q.text)).toEqual(["Mine"]);
  });

  it("filters by tag or by shelf", async () => {
    const shelf = await prisma.shelf.create({ data: { userId, name: "Favourites" } });
    const fantasy = await makeGame(userId, { title: "Skyrim", tags: ["fantasy"] });
    const shelved = await makeGame(userId, {
      title: "Shelved",
      shelves: { connect: { id: shelf.id } },
    });
    const plain = await makeGame(userId, { title: "Plain" });
    await addQuotes(fantasy.id, [{ text: "Here be dragons" }]);
    await addQuotes(shelved.id, [{ text: "On the shelf" }]);
    await addQuotes(plain.id, [{ text: "Nothing special" }]);

    const byTag = await loadQuotes(userId, params({ tag: "fantasy" }), SORT);
    expect(byTag.list!.map((q) => q.text)).toEqual(["Here be dragons"]);
    const byShelf = await loadQuotes(userId, params({ shelfId: shelf.id }), SORT);
    expect(byShelf.list!.map((q) => q.text)).toEqual(["On the shelf"]);
  });

  it("searches the quote, who says it, its note, and the game", async () => {
    const game = await makeGame(userId, {
      title: "Ōkami",
      developers: ["Clover Studio"],
      platform: "PlayStation 2",
      searchText: "okami clover studio playstation 2",
    });
    const other = await makeGame(userId, { title: "Other" });
    await addQuotes(game.id, [{ text: "The sun rises once more" }]);
    await addQuotes(other.id, [
      { text: "Something about the moon" },
      { text: "Plain", note: "remember the MOON" },
      { text: "Spoken", speaker: "Moon Presence" },
      { text: "Nothing" },
    ]);

    const text = (q: string) =>
      loadQuotes(userId, params({ q }), SORT).then((r) => r.list!.map((x) => x.text).sort());
    expect(await text("moon")).toEqual(["Plain", "Something about the moon", "Spoken"]);
    expect(await text("presence")).toEqual(["Spoken"]);
    expect(await text("okami")).toEqual(["The sun rises once more"]);
    expect(await text("studio clover")).toEqual(["The sun rises once more"]);
    expect(await text("playstation")).toEqual(["The sun rises once more"]);
  });

  it("counts every match while showing up to the limit", async () => {
    const game = await makeGame(userId);
    await prisma.quote.createMany({
      data: Array.from({ length: 205 }, (_, i) => ({
        gameId: game.id,
        text: `Quote ${i}`,
        createdAt: new Date(Date.UTC(2026, 0, 1, 0, i)),
      })),
    });

    const first = await loadQuotes(userId, params(), SORT);
    expect(first.total).toBe(205);
    expect(first.shown).toBe(200);
    expect(first.list).toHaveLength(200);
    expect(first.list![0].text).toBe("Quote 204");

    const more = await loadQuotes(userId, params({ limit: 400 }), SORT);
    expect(more.shown).toBe(205);
    expect(more.list!.at(-1)!.text).toBe("Quote 0");
  });

  it("keeps a shuffle stable as more are shown", async () => {
    const game = await makeGame(userId);
    await prisma.quote.createMany({
      data: Array.from({ length: 250 }, (_, i) => ({ gameId: game.id, text: `Q${i}` })),
    });

    const shuffle = (limit: number, seed = 777) =>
      loadQuotes(userId, params({ order: "shuffle", seed, limit }), SORT).then((r) =>
        r.list!.map((q) => q.id),
      );
    const page1 = await shuffle(200);
    const page2 = await shuffle(400);
    expect(page1).toHaveLength(200);
    expect(page2).toHaveLength(250);
    expect(page2.slice(0, 200)).toEqual(page1);
    expect(await shuffle(200, 778)).not.toEqual(page1);
    const newest = (await loadQuotes(userId, params(), SORT)).list!.map((q) => q.id);
    expect(page1).not.toEqual(newest);
  });

  it("groups by game with real totals, each game's quotes newest first", async () => {
    const a = await makeGame(userId, { title: "Celeste" });
    const b = await makeGame(userId, { title: "Hades" });
    await addQuotes(a.id, [
      { text: "a-first", at: "2026-01-01T00:00:00Z" },
      { text: "a-second", speaker: "Theo", at: "2026-01-02T00:00:00Z" },
      { text: "a-third", at: "2026-01-03T00:00:00Z" },
    ]);
    await addQuotes(b.id, [{ text: "b-only", at: "2026-05-01T00:00:00Z" }]);

    const grouped = await loadQuotes(userId, params({ group: true }), SORT);
    expect(grouped.list).toBeNull();
    expect(grouped.total).toBe(4);
    expect(
      grouped.groups!.map((g) => [g.game.title, g.total, g.quotes.map((q) => q.text)]),
    ).toEqual([
      // Newest: Hades' quote is the newest of all.
      ["Hades", 1, ["b-only"]],
      ["Celeste", 3, ["a-third", "a-second", "a-first"]],
    ]);
    expect(grouped.groups![1].quotes[1].speaker).toBe("Theo");

    const byGame = await loadQuotes(userId, params({ group: true, order: "game" }), SORT);
    expect(byGame.groups!.map((g) => g.game.title)).toEqual(["Celeste", "Hades"]);
    const oldest = await loadQuotes(userId, params({ group: true, order: "oldest" }), SORT);
    expect(oldest.groups!.map((g) => g.quotes.map((q) => q.text))).toEqual([
      ["a-third", "a-second", "a-first"],
      ["b-only"],
    ]);
  });
});

describe("quoteSources", () => {
  it("offers only shelves and tags with quotes, from this player's library", async () => {
    const [withQuotes, empty, theirs] = await Promise.all([
      prisma.shelf.create({ data: { userId, name: "Has quotes" } }),
      prisma.shelf.create({ data: { userId, name: "Empty" } }),
      prisma.shelf.create({ data: { userId: otherUserId, name: "Theirs" } }),
    ]);
    const quoted = await makeGame(userId, {
      tags: ["rpg", "classics"],
      shelves: { connect: { id: withQuotes.id } },
    });
    await makeGame(userId, { tags: ["unquoted"], shelves: { connect: { id: empty.id } } });
    const theirGame = await makeGame(otherUserId, {
      tags: ["their-tag"],
      shelves: { connect: { id: theirs.id } },
    });
    await addQuotes(quoted.id, [{ text: "A" }, { text: "B" }]);
    await addQuotes(theirGame.id, [{ text: "C" }]);

    const sources = await quoteSources(userId);
    expect(sources.shelves).toEqual([{ id: withQuotes.id, name: "Has quotes" }]);
    expect(sources.tags).toEqual(["classics", "rpg"]);

    // The shelf in the URL shows up even without quotes, but only if it's
    // this player's.
    const picked = await quoteSources(userId, { shelfId: empty.id });
    expect(picked.shelves.map((s) => s.name)).toEqual(["Empty", "Has quotes"]);
    const foreign = await quoteSources(userId, { shelfId: theirs.id });
    expect(foreign.shelves.map((s) => s.name)).toEqual(["Has quotes"]);
  });
});
