import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { buildGameWhere, parseFilters } from "@/lib/library-filters";
import { resolveGameWhere } from "@/lib/library-where";
import type { SearchField } from "@/lib/preferences";
import { buildSearchText, foldForSearch } from "@/lib/utils";

/**
 * Library search against a real database: the words, accents and LIKE
 * wildcards are all about what Postgres does with the pattern, which a fake
 * would only guess at.
 */
const prisma = new PrismaClient();

let userId: string;

beforeEach(async () => {
  const user = await prisma.user.create({
    data: { username: `srch-${Date.now()}-${Math.random()}`, passwordHash: "x" },
  });
  userId = user.id;
  const games: [string, string[]][] = [
    ["The Hobbit", ["J.R.R. Tolkien"]],
    ["Jane Eyre", ["Charlotte Brontë"]],
    ["Lykkeland", ["Bjørn Olav Nordahl"]],
    ["100% Cotton", ["Some Author"]],
    ["Harry Potter and the Philosopher's Stone", ["J.K. Rowling"]],
  ];
  await prisma.game.createMany({
    data: games.map(([title, authors]) => ({
      userId,
      title,
      authors,
      searchText: buildSearchText(title, authors, null),
    })),
  });
});

afterEach(async () => {
  await prisma.user.delete({ where: { id: userId } }).catch(() => {});
});

async function search(q: string): Promise<string[]> {
  const where = buildGameWhere(userId, parseFilters({ q }));
  const rows = await prisma.game.findMany({ where, select: { title: true }, orderBy: { title: "asc" } });
  return rows.map((r) => r.title);
}

describe("library search", () => {
  it("ignores spaces around the query", async () => {
    expect(await search("   harry   ")).toEqual(["Harry Potter and the Philosopher's Stone"]);
  });

  it("matches each word anywhere in title, authors or series", async () => {
    expect(await search("tolkien hobbit")).toEqual(["The Hobbit"]);
    expect(await search("tolkien eyre")).toEqual([]);
  });

  it("ignores accents on either side", async () => {
    expect(await search("bronte")).toEqual(["Jane Eyre"]);
    expect(await search("Brontë")).toEqual(["Jane Eyre"]);
    expect(await search("bjorn")).toEqual(["Lykkeland"]);
  });

  it("treats % and _ as plain characters", async () => {
    expect(await search("%")).toEqual(["100% Cotton"]);
    expect(await search("_")).toEqual([]);
  });

  it("survives a null byte in the URL", async () => {
    // Postgres refuses \0 in text; the page used to crash on ?tag=%00.
    const where = buildGameWhere(userId, parseFilters({ tag: "\0", q: "hob\0bit" }));
    await expect(prisma.game.count({ where })).resolves.toBe(1);
  });
});

describe("searching tags, ISBN and reviews too", () => {
  /** Search as the reader with these Preferences would. */
  async function searchIn(q: string, fields: SearchField[]): Promise<string[]> {
    const where = await resolveGameWhere(userId, parseFilters({ q }), {
      searchAlsoIn: fields,
      timeZone: "UTC",
    });
    const rows = await prisma.game.findMany({ where, select: { title: true }, orderBy: { title: "asc" } });
    return rows.map((r) => r.title);
  }

  beforeEach(async () => {
    const set = (title: string, data: object) =>
      prisma.game.updateMany({ where: { userId, title }, data });
    await set("The Hobbit", { tags: ["fantasy", "æventyr"], isbn: "9780261102217" });
    // Saved the way updatePlay and import save a review: with its
    // folded copy, which is what search reads.
    const review = (text: string) => ({ review: text, reviewSearchText: foldForSearch(text) });
    await set("Jane Eyre", review("ÆRØ ÉMILE, all in capitals"));
    await set("Lykkeland", { ...review("Better than anything by a Brontë."), isbn: "080442957x" });
    await set("100% Cotton", { isbn: "9781984000000", ...review("Half_way there") });
  });

  it("looks only where it always has until asked", async () => {
    expect(await searchIn("fantasy", [])).toEqual([]);
    expect(await searchIn("better", [])).toEqual([]);
    expect(await searchIn("9780261102217", [])).toEqual([]);
  });

  it("finds tags, accents folded", async () => {
    expect(await searchIn("fantasy", ["tags"])).toEqual(["The Hobbit"]);
    expect(await searchIn("aeventyr", ["tags"])).toEqual(["The Hobbit"]);
    expect(await searchIn("Æventyr", ["tags"])).toEqual(["The Hobbit"]);
  });

  it("still wants every word to match somewhere", async () => {
    expect(await searchIn("tolkien fantasy", ["tags"])).toEqual(["The Hobbit"]);
    expect(await searchIn("rowling fantasy", ["tags"])).toEqual([]);
  });

  it("finds reviews, accents and capitals folded either way", async () => {
    // Jane Eyre by its author, Lykkeland by its review.
    expect(await searchIn("bronte", ["review"])).toEqual(["Jane Eyre", "Lykkeland"]);
    expect(await searchIn("Brontë better", ["review"])).toEqual(["Lykkeland"]);
    expect(await searchIn("aero emile", ["review"])).toEqual(["Jane Eyre"]);
  });

  it("treats % and _ in a review as plain characters", async () => {
    expect(await searchIn("half_way", ["review"])).toEqual(["100% Cotton"]);
    expect(await searchIn("half%way", ["review"])).toEqual([]);
  });

  it("finds an ISBN however it's typed", async () => {
    for (const q of ["9780261102217", "978-0-261-10221-7", "978 0 261 10221 7", "0261102214", "0-261"]) {
      expect(await searchIn(q, ["isbn"]), q).toEqual(["The Hobbit"]);
    }
    // Stored with a lowercase check digit.
    expect(await searchIn("080442957X", ["isbn"])).toEqual(["Lykkeland"]);
    expect(await searchIn("9780804429573", ["isbn"])).toEqual(["Lykkeland"]);
  });

  it("doesn't take a year for part of an ISBN", async () => {
    expect(await searchIn("1984", ["isbn"])).toEqual([]);
  });

  it("never matches another reader's tags or reviews", async () => {
    const other = await prisma.user.create({
      data: { username: `srch-o-${Date.now()}-${Math.random()}`, passwordHash: "x" },
    });
    try {
      await prisma.game.create({
        data: {
          userId: other.id,
          title: "Theirs",
          searchText: "theirs",
          tags: ["secret-tag"],
          review: "secret words",
          reviewSearchText: "secret words",
          isbn: "9780000000002",
        },
      });
      expect(await searchIn("secret", ["tags", "review", "isbn"])).toEqual([]);
      expect(await searchIn("9780000000002", ["tags", "review", "isbn"])).toEqual([]);
    } finally {
      await prisma.user.delete({ where: { id: other.id } });
    }
  });

  it("matches reviews in SQL, without reading them first", async () => {
    // However many reviews match, the search is one condition per word.
    const where = await resolveGameWhere(userId, parseFilters({ q: "bronte better" }), {
      searchAlsoIn: ["review"],
      timeZone: "UTC",
    });
    expect(where.AND).toEqual([
      { OR: [{ searchText: { contains: "bronte" } }, { reviewSearchText: { contains: "bronte" } }] },
      { OR: [{ searchText: { contains: "better" } }, { reviewSearchText: { contains: "better" } }] },
    ]);
  });
});
