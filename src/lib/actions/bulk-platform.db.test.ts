import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PrismaClient, PlayStatus } from "@prisma/client";
import { buildSearchText } from "@/lib/utils";

/**
 * Bulk Set platform against a real database. The platform is part of every
 * game's searchText, so the point here is that the two always move
 * together: a game moved to "Steam Deck" must be found by searching for
 * it, and no longer by the platform it had. And, like every bulk action,
 * that it only ever touches the signed-in player's games.
 *
 * Kept apart from actions.db.test.ts so other work on those actions doesn't
 * collide with these.
 */

const prisma = new PrismaClient();

let currentUserId: string | null = null;
vi.mock("@/auth", () => ({
  auth: async () => (currentUserId ? { user: { id: currentUserId } } : null),
  signOut: async () => {},
}));

vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

// The real helpers, wrapped so a test can make one throw partway through the
// transaction and see that nothing before it stuck.
vi.mock("@/lib/bulk", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/bulk")>();
  return {
    ...actual,
    retag: vi.fn(actual.retag),
    replatform: vi.fn(actual.replatform),
  };
});

const { bulkUpdateGames, libraryPlatforms } = await import("@/lib/actions/bulk");
const { replatform, retag } = await import("@/lib/bulk");

let userId: string;
let otherUserId: string;

beforeEach(async () => {
  const stamp = `${Date.now()}-${Math.random()}`;
  const [a, b] = await Promise.all([
    prisma.user.create({ data: { username: `bp-${stamp}`, passwordHash: "x" } }),
    prisma.user.create({ data: { username: `bpo-${stamp}`, passwordHash: "x" } }),
  ]);
  userId = a.id;
  otherUserId = b.id;
  currentUserId = userId;
});

afterEach(async () => {
  await prisma.user.deleteMany({ where: { id: { in: [userId, otherUserId] } } });
});

/** A game whose searchText is built the way the game actions build it. */
async function makeGame(
  over: {
    title?: string;
    developers?: string[];
    seriesName?: string | null;
    platform?: string | null;
    tags?: string[];
    status?: PlayStatus;
  } = {},
  owner = userId,
) {
  const title = over.title ?? "Hollow Knight";
  const developers = over.developers ?? ["Team Cherry"];
  const seriesName = over.seriesName ?? null;
  const platform = over.platform === undefined ? "PC" : over.platform;
  return prisma.game.create({
    data: {
      userId: owner,
      title,
      developers,
      seriesName,
      platform,
      tags: over.tags ?? [],
      status: over.status,
      searchText: buildSearchText(title, developers, seriesName, platform),
    },
  });
}

const reload = (id: string) => prisma.game.findUniqueOrThrow({ where: { id } });

describe("bulk Set platform", () => {
  it("sets the platform and rebuilds each game's searchText around it", async () => {
    const a = await makeGame({ title: "Celeste", developers: ["Maddy Makes Games"] });
    const b = await makeGame({
      title: "Ōkami",
      developers: ["Clover Studio"],
      seriesName: "Ōkami",
      platform: "PlayStation 2",
    });
    const untouched = await makeGame({ title: "Untouched" });

    const res = await bulkUpdateGames({ gameIds: [a.id, b.id], platform: "  Steam Deck " });
    expect(res).toEqual({ count: 2 });

    const afterA = await reload(a.id);
    expect(afterA.platform).toBe("Steam Deck");
    expect(afterA.searchText).toBe("celeste maddy makes games steam deck");
    const afterB = await reload(b.id);
    expect(afterB.platform).toBe("Steam Deck");
    // Each game's own title, developers and series, folded as ever.
    expect(afterB.searchText).toBe("okami clover studio okami steam deck");
    expect(afterB.title).toBe("Ōkami");

    // Search finds them by the new platform and no longer by the old one.
    const found = await prisma.game.findMany({
      where: { userId, searchText: { contains: "steam deck" } },
      select: { id: true },
    });
    expect(found.map((g) => g.id).sort()).toEqual([a.id, b.id].sort());
    expect(
      await prisma.game.count({ where: { userId, searchText: { contains: "playstation 2" } } }),
    ).toBe(0);

    const other = await reload(untouched.id);
    expect(other.platform).toBe("PC");
    expect(other.searchText).toBe(untouched.searchText);
  });

  it("clears the platform, out of searchText too, given null or an empty name", async () => {
    const a = await makeGame({ platform: "Nintendo Switch" });
    const b = await makeGame({ platform: "PC" });

    expect(await bulkUpdateGames({ gameIds: [a.id], platform: null })).toEqual({ count: 1 });
    expect(await bulkUpdateGames({ gameIds: [b.id], platform: "   " })).toEqual({ count: 1 });

    for (const id of [a.id, b.id]) {
      const after = await reload(id);
      expect(after.platform).toBeNull();
      expect(after.searchText).toBe("hollow knight team cherry");
    }
  });

  it("leaves games already on that platform as they were", async () => {
    const same = await makeGame({ platform: "PC" });
    const before = await reload(same.id);

    expect(await bulkUpdateGames({ gameIds: [same.id], platform: "PC" })).toEqual({ count: 1 });

    const after = await reload(same.id);
    expect(after.platform).toBe("PC");
    // Not written at all, so its updatedAt hasn't moved.
    expect(after.updatedAt).toEqual(before.updatedAt);
  });

  it("silently drops ids belonging to another account", async () => {
    const mine = await makeGame();
    const theirs = await makeGame({ platform: "PC" }, otherUserId);

    const res = await bulkUpdateGames({ gameIds: [mine.id, theirs.id], platform: "Linux" });
    expect(res).toEqual({ count: 1 });

    expect((await reload(mine.id)).platform).toBe("Linux");
    const after = await reload(theirs.id);
    expect(after.platform).toBe("PC");
    expect(after.searchText).toBe(theirs.searchText);
  });

  it("refuses when every id is another account's", async () => {
    const theirs = await makeGame({}, otherUserId);
    expect(await bulkUpdateGames({ gameIds: [theirs.id], platform: null })).toEqual({
      error: "No matching games",
    });
    expect((await reload(theirs.id)).platform).toBe("PC");
  });

  it("applies to every game matching the filters, and only the player's", async () => {
    const switchGames = await Promise.all(
      Array.from({ length: 12 }, (_, i) =>
        makeGame({ title: `Switch game ${i}`, platform: "Switch" }),
      ),
    );
    const pcGame = await makeGame({ title: "PC game", platform: "PC" });
    const theirs = await makeGame({ title: "Their switch game", platform: "Switch" }, otherUserId);

    const res = await bulkUpdateGames({
      matching: { platform: "Switch", sort: "title", dir: "asc", group: "none", limit: "5" },
      platform: "Nintendo Switch",
    });
    expect(res).toEqual({ count: switchGames.length });

    const moved = await prisma.game.findMany({
      where: { id: { in: switchGames.map((g) => g.id) } },
    });
    for (const g of moved) {
      expect(g.platform).toBe("Nintendo Switch");
      expect(g.searchText).toBe(buildSearchText(g.title, g.developers, g.seriesName, "Nintendo Switch"));
    }
    expect((await reload(pcGame.id)).platform).toBe("PC");
    const theirAfter = await reload(theirs.id);
    expect(theirAfter.platform).toBe("Switch");
    expect(theirAfter.searchText).toBe(theirs.searchText);
  });

  it("matches on a search and clears every match", async () => {
    const hits = await Promise.all([
      makeGame({ title: "Metroid Dread", developers: ["MercurySteam"], platform: "Switch" }),
      makeGame({ title: "Metroid Prime", developers: ["Retro Studios"], platform: "GameCube" }),
    ]);
    const miss = await makeGame({ title: "Celeste" });

    const res = await bulkUpdateGames({ matching: { q: "metroid" }, platform: null });
    expect(res).toEqual({ count: 2 });
    expect((await reload(hits[0].id)).searchText).toBe("metroid dread mercurysteam");
    expect((await reload(hits[1].id)).searchText).toBe("metroid prime retro studios");
    expect((await reload(miss.id)).platform).toBe("PC");
  });

  it("applies along with the other changes", async () => {
    const bk = await makeGame({ status: PlayStatus.PLAYING, tags: ["indie"] });
    const res = await bulkUpdateGames({
      gameIds: [bk.id],
      status: PlayStatus.COMPLETED,
      addTags: ["metroidvania"],
      platform: "Nintendo Switch",
    });
    expect(res).toEqual({ count: 1 });

    const after = await reload(bk.id);
    expect(after.status).toBe(PlayStatus.COMPLETED);
    expect(after.timesCompleted).toBe(1);
    expect(after.tags).toEqual(["indie", "metroidvania"]);
    expect(after.platform).toBe("Nintendo Switch");
    expect(after.searchText).toBe("hollow knight team cherry nintendo switch");
  });

  it("rolls the platform back when a later step in the transaction fails", async () => {
    const bk = await makeGame({ tags: ["indie"] });
    vi.mocked(retag).mockImplementationOnce(() => {
      throw new Error("tags failed");
    });

    await expect(
      bulkUpdateGames({ gameIds: [bk.id], platform: "Linux", addTags: ["metroidvania"] }),
    ).rejects.toThrow("tags failed");

    const after = await reload(bk.id);
    expect(after.platform).toBe("PC");
    expect(after.searchText).toBe(bk.searchText);
    expect(after.tags).toEqual(["indie"]);
    expect(after.updatedAt).toEqual(bk.updatedAt);
  });

  it("rolls the earlier changes back when the platform step fails", async () => {
    const bk = await makeGame({ status: PlayStatus.PLAYING });
    vi.mocked(replatform).mockImplementationOnce(() => {
      throw new Error("platform failed");
    });

    await expect(
      bulkUpdateGames({ gameIds: [bk.id], status: PlayStatus.COMPLETED, platform: "Linux" }),
    ).rejects.toThrow("platform failed");

    const after = await reload(bk.id);
    expect(after.status).toBe(PlayStatus.PLAYING);
    expect(after.timesCompleted).toBe(0);
    expect(after.platform).toBe("PC");
    expect(after.searchText).toBe(bk.searchText);
  });

  it("writes nothing when another part of the change is refused", async () => {
    const bk = await makeGame();
    const theirShelf = await prisma.shelf.create({ data: { userId: otherUserId, name: "Theirs" } });

    expect(
      await bulkUpdateGames({ gameIds: [bk.id], platform: "Linux", addShelfId: theirShelf.id }),
    ).toEqual({ error: "Shelf not found" });
    const after = await reload(bk.id);
    expect(after.platform).toBe("PC");
    expect(after.searchText).toBe(bk.searchText);
  });

  it("refuses a platform that is too long without writing anything", async () => {
    const bk = await makeGame();
    expect(await bulkUpdateGames({ gameIds: [bk.id], platform: "x".repeat(101) })).toEqual({
      error: "A platform can be at most 100 characters.",
    });
    expect((await reload(bk.id)).platform).toBe("PC");
  });

  it("still needs some change to apply", async () => {
    const bk = await makeGame();
    expect(await bulkUpdateGames({ gameIds: [bk.id] })).toEqual({ error: "Nothing to apply" });
    expect(await bulkUpdateGames({ gameIds: [bk.id], platform: undefined })).toEqual({
      error: "Nothing to apply",
    });
  });

  it("needs a session", async () => {
    const bk = await makeGame();
    currentUserId = null;
    expect(await bulkUpdateGames({ gameIds: [bk.id], platform: "Linux" })).toEqual({
      error: "Not authenticated",
    });
    expect((await reload(bk.id)).platform).toBe("PC");
  });
});

describe("libraryPlatforms", () => {
  it("lists the player's own platforms once each, trimmed and in order", async () => {
    await Promise.all([
      makeGame({ platform: "PlayStation 5" }),
      makeGame({ platform: "Amiga" }),
      makeGame({ platform: "Amiga" }),
      makeGame({ platform: " Amiga " }),
      makeGame({ platform: "" }),
      makeGame({ platform: null }),
      makeGame({ platform: "Their console" }, otherUserId),
    ]);

    expect(await libraryPlatforms()).toEqual(["Amiga", "PlayStation 5"]);
  });

  it("is empty when signed out", async () => {
    await makeGame({ platform: "PC" });
    currentUserId = null;
    expect(await libraryPlatforms()).toEqual([]);
  });
});
