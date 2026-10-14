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
  const games: [string, string[], string | null, string | null][] = [
    ["Hollow Knight", ["Team Cherry"], null, "Nintendo Switch"],
    ["Pokémon Red", ["Game Freak"], "Pokémon", "Game Boy"],
    ["Mørkt Hav", ["Fjordlys"], null, null],
    ["100% Orange Juice", ["Orange_Juice"], null, "PC"],
    ["The Legend of Zelda: Breath of the Wild", ["Nintendo"], "The Legend of Zelda", null],
  ];
  await prisma.game.createMany({
    data: games.map(([title, developers, seriesName, platform]) => ({
      userId,
      title,
      developers,
      seriesName,
      platform,
      searchText: buildSearchText(title, developers, seriesName, platform),
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
    expect(await search("   zelda   ")).toEqual(["The Legend of Zelda: Breath of the Wild"]);
  });

  it("matches each word anywhere in title, developers, series or platform", async () => {
    expect(await search("cherry hollow")).toEqual(["Hollow Knight"]);
    expect(await search("switch knight")).toEqual(["Hollow Knight"]);
    expect(await search("freak boy")).toEqual(["Pokémon Red"]);
    expect(await search("cherry zelda")).toEqual([]);
  });

  it("ignores accents on either side", async () => {
    expect(await search("pokemon")).toEqual(["Pokémon Red"]);
    expect(await search("Pokémon")).toEqual(["Pokémon Red"]);
    expect(await search("morkt")).toEqual(["Mørkt Hav"]);
  });

  it("treats % and _ as plain characters", async () => {
    // As wildcards either would match every game.
    expect(await search("%")).toEqual(["100% Orange Juice"]);
    expect(await search("_")).toEqual(["100% Orange Juice"]);
    expect(await search("orange%juice")).toEqual([]);
  });

  it("survives a null byte in the URL", async () => {
    // Postgres refuses \0 in text; the page used to crash on ?tag=%00.
    const where = buildGameWhere(userId, parseFilters({ tag: "\0", q: "hol\0low" }));
    await expect(prisma.game.count({ where })).resolves.toBe(1);
  });
});

describe("searching tags and reviews too", () => {
  /** Search as the player with these Preferences would. */
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
    await set("Hollow Knight", { tags: ["metroidvania", "åpen verden"] });
    // Saved the way updatePlay and import save a review: with its
    // folded copy, which is what search reads.
    const review = (text: string) => ({ review: text, reviewSearchText: foldForSearch(text) });
    await set("Pokémon Red", review("ØRKEN LEVEL, ÉPIC BOSS, all in capitals"));
    await set("Mørkt Hav", review("Better than any Pokémon game."));
    await set("100% Orange Juice", review("Half_way there"));
  });

  it("looks only where it always has until asked", async () => {
    expect(await searchIn("metroidvania", [])).toEqual([]);
    expect(await searchIn("better", [])).toEqual([]);
  });

  it("finds tags, accents folded", async () => {
    expect(await searchIn("metroidvania", ["tags"])).toEqual(["Hollow Knight"]);
    expect(await searchIn("apen", ["tags"])).toEqual(["Hollow Knight"]);
    expect(await searchIn("Åpen", ["tags"])).toEqual(["Hollow Knight"]);
  });

  it("still wants every word to match somewhere", async () => {
    expect(await searchIn("cherry metroidvania", ["tags"])).toEqual(["Hollow Knight"]);
    expect(await searchIn("zelda metroidvania", ["tags"])).toEqual([]);
  });

  it("finds reviews, accents and capitals folded either way", async () => {
    // Pokémon Red by its title, Mørkt Hav by its review.
    expect(await searchIn("pokemon", ["review"])).toEqual(["Mørkt Hav", "Pokémon Red"]);
    expect(await searchIn("Pokémon better", ["review"])).toEqual(["Mørkt Hav"]);
    expect(await searchIn("orken epic", ["review"])).toEqual(["Pokémon Red"]);
  });

  it("treats % and _ in a review as plain characters", async () => {
    expect(await searchIn("half_way", ["review"])).toEqual(["100% Orange Juice"]);
    expect(await searchIn("half%way", ["review"])).toEqual([]);
  });

  it("never matches another player's tags or reviews", async () => {
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
        },
      });
      expect(await searchIn("secret", ["tags", "review"])).toEqual([]);
    } finally {
      await prisma.user.delete({ where: { id: other.id } });
    }
  });

  it("matches reviews in SQL, without reading them first", async () => {
    // However many reviews match, the search is one condition per word.
    const where = await resolveGameWhere(userId, parseFilters({ q: "pokemon better" }), {
      searchAlsoIn: ["review"],
      timeZone: "UTC",
    });
    expect(where.AND).toEqual([
      { OR: [{ searchText: { contains: "pokemon" } }, { reviewSearchText: { contains: "pokemon" } }] },
      { OR: [{ searchText: { contains: "better" } }, { reviewSearchText: { contains: "better" } }] },
    ]);
  });
});
