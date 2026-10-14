import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { GameFormat, GameOwnership, PrismaClient, PlayStatus } from "@prisma/client";

/**
 * Library housekeeping against a real database: renaming and merging
 * shelves, renaming saved views, and bulk edit and delete, including "every
 * game that matches" and its 2,000-id limit.
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

const { renameShelf } = await import("@/lib/actions/shelves");
const { renameView } = await import("@/lib/actions/saved-views");
const { bulkUpdateGames, bulkDeleteGames } = await import("@/lib/actions/bulk");
const { prisma: appPrisma } = await import("@/lib/prisma");

let userId: string;
let otherUserId: string;
let coversDir: string;
const savedCoversDir = process.env.COVERS_DIR;

beforeAll(async () => {
  coversDir = await fs.mkdtemp(path.join(os.tmpdir(), "mygames-covers-"));
  process.env.COVERS_DIR = coversDir;
});

afterAll(async () => {
  await fs.rm(coversDir, { recursive: true, force: true });
  if (savedCoversDir === undefined) delete process.env.COVERS_DIR;
  else process.env.COVERS_DIR = savedCoversDir;
});

beforeEach(async () => {
  const stamp = `${Date.now()}-${Math.random()}`;
  const [a, b] = await Promise.all([
    prisma.user.create({ data: { username: `lm-${stamp}`, passwordHash: "x" } }),
    prisma.user.create({ data: { username: `lmo-${stamp}`, passwordHash: "x" } }),
  ]);
  userId = a.id;
  otherUserId = b.id;
  currentUserId = userId;
});

afterEach(async () => {
  await prisma.user.deleteMany({ where: { id: { in: [userId, otherUserId] } } });
});

async function makeGame(over: Record<string, unknown> = {}, owner = userId) {
  return prisma.game.create({
    data: { userId: owner, title: "Test Game", searchText: "test game", lengthMinutes: 600, ...over },
  });
}

async function makeShelf(name: string, games: { id: string }[] = [], owner = userId) {
  return prisma.shelf.create({
    data: { userId: owner, name, games: { connect: games.map(({ id }) => ({ id })) } },
  });
}

async function shelfGameIds(shelfId: string) {
  const shelf = await prisma.shelf.findUniqueOrThrow({
    where: { id: shelfId },
    select: { games: { select: { id: true } } },
  });
  return shelf.games.map((b) => b.id).sort();
}

describe("renameShelf", () => {
  it("renames a shelf and keeps its games", async () => {
    const bk = await makeGame();
    const shelf = await makeShelf("Sci fi", [bk]);

    expect(await renameShelf(shelf.id, "  Science fiction ")).toEqual({
      shelfId: shelf.id,
      name: "Science fiction",
    });
    const after = await prisma.shelf.findUniqueOrThrow({ where: { id: shelf.id } });
    expect(after.name).toBe("Science fiction");
    expect(await shelfGameIds(shelf.id)).toEqual([bk.id]);
  });

  it("renames the same shelf when only the case changes", async () => {
    const shelf = await makeShelf("sci fi");
    const res = await renameShelf(shelf.id, "Sci fi");

    expect(res.merged).toBeUndefined();
    expect(res.shelfId).toBe(shelf.id);
    expect((await prisma.shelf.findUniqueOrThrow({ where: { id: shelf.id } })).name).toBe("Sci fi");
  });

  it("merges onto another shelf's name in any case, once per game", async () => {
    const [onlySource, both, onlyTarget] = await Promise.all([makeGame(), makeGame(), makeGame()]);
    const source = await makeShelf("Sci fi", [onlySource, both]);
    const target = await makeShelf("Sci-fi", [both, onlyTarget]);

    const res = await renameShelf(source.id, "sci-FI");

    expect(res).toEqual({ merged: true, shelfId: target.id, name: "Sci-fi", count: 3 });
    expect(await prisma.shelf.findUnique({ where: { id: source.id } })).toBeNull();
    expect(await shelfGameIds(target.id)).toEqual([onlySource.id, both.id, onlyTarget.id].sort());
    // The games themselves are untouched.
    expect(await prisma.game.count({ where: { userId } })).toBe(3);
  });

  it("points saved views on the merged shelf at the shelf it merged into", async () => {
    const source = await makeShelf("Sci fi");
    const target = await makeShelf("Sci-fi");
    const view = await prisma.savedView.create({
      data: { userId, name: "Sci-fi unplayed", query: `shelf=WANT_TO_PLAY&shelfId=${source.id}&group=none&sort=title&dir=asc` },
    });
    const other = await prisma.savedView.create({
      data: { userId, name: "All", query: "group=none&sort=title&dir=asc" },
    });

    await renameShelf(source.id, "Sci-fi");

    const after = await prisma.savedView.findUniqueOrThrow({ where: { id: view.id } });
    expect(new URLSearchParams(after.query).get("shelfId")).toBe(target.id);
    expect(new URLSearchParams(after.query).get("shelf")).toBe("WANT_TO_PLAY");
    expect((await prisma.savedView.findUniqueOrThrow({ where: { id: other.id } })).query).toBe(
      other.query,
    );
  });

  it("refuses another account's shelf and never merges into one", async () => {
    const theirs = await makeShelf("Theirs", [], otherUserId);
    expect(await renameShelf(theirs.id, "Mine now")).toEqual({ error: "Shelf not found" });
    expect((await prisma.shelf.findUniqueOrThrow({ where: { id: theirs.id } })).name).toBe("Theirs");

    const mine = await makeShelf("Mine");
    const res = await renameShelf(mine.id, "theirs");
    expect(res.merged).toBeUndefined();
    expect(res.shelfId).toBe(mine.id);
    expect(await prisma.shelf.count({ where: { userId: otherUserId } })).toBe(1);
  });

  it("explains an empty or too-long name", async () => {
    const shelf = await makeShelf("Shelf");
    expect(await renameShelf(shelf.id, "   ")).toEqual({ error: "Shelf name is required" });
    expect(await renameShelf(shelf.id, "x".repeat(51))).toEqual({
      error: "Shelf name must be at most 50 characters",
    });
  });
});

describe("renameView", () => {
  async function makeView(name: string, owner = userId) {
    return prisma.savedView.create({
      data: { userId: owner, name, query: "group=none&sort=title&dir=asc" },
    });
  }

  it("renames a view", async () => {
    const view = await makeView("Unplayed");
    expect(await renameView(view.id, " Backlog ")).toEqual({});
    expect((await prisma.savedView.findUniqueOrThrow({ where: { id: view.id } })).name).toBe(
      "Backlog",
    );
  });

  it("refuses another view's name, but not the view's own", async () => {
    const view = await makeView("Unplayed");
    await makeView("Favourites");
    expect(await renameView(view.id, "Favourites")).toEqual({
      error: "You already have a view called “Favourites”.",
    });
    expect(await renameView(view.id, "Unplayed")).toEqual({});
  });

  it("refuses another account's view and a bad id", async () => {
    const theirs = await makeView("Theirs", otherUserId);
    expect(await renameView(theirs.id, "Mine")).toEqual({ error: "View not found" });
    expect(await renameView("", "Mine")).toEqual({ error: "View not found" });
    expect((await prisma.savedView.findUniqueOrThrow({ where: { id: theirs.id } })).name).toBe(
      "Theirs",
    );
  });
});

describe("bulkUpdateGames, more fields", () => {
  it("sets format and ownership on the selection only", async () => {
    const [a, b, untouched] = await Promise.all([
      makeGame({ format: GameFormat.SUBSCRIPTION, lengthMinutes: 2400 }),
      makeGame(),
      makeGame(),
    ]);

    const res = await bulkUpdateGames({
      gameIds: [a.id, b.id],
      format: GameFormat.DIGITAL,
      ownership: GameOwnership.BORROWED,
    });
    expect(res).toEqual({ count: 2 });

    const rows = await prisma.game.findMany({ where: { userId } });
    const byId = new Map(rows.map((r) => [r.id, r]));
    for (const id of [a.id, b.id]) {
      expect(byId.get(id)?.format).toBe(GameFormat.DIGITAL);
      expect(byId.get(id)?.ownership).toBe(GameOwnership.BORROWED);
    }
    // The time to beat belongs to the game, whatever the format.
    expect(byId.get(a.id)?.lengthMinutes).toBe(2400);
    expect(byId.get(untouched.id)?.format).toBe(GameFormat.PHYSICAL);
    expect(byId.get(untouched.id)?.ownership).toBe(GameOwnership.OWNED);
  });

  it("removes tags, alone or while adding others", async () => {
    const a = await makeGame({ tags: ["rpg", "epic", "owned"] });
    const b = await makeGame({ tags: ["epic"] });

    await bulkUpdateGames({ gameIds: [a.id, b.id], removeTags: ["epic"] });
    expect((await prisma.game.findUniqueOrThrow({ where: { id: a.id } })).tags).toEqual([
      "rpg",
      "owned",
    ]);
    expect((await prisma.game.findUniqueOrThrow({ where: { id: b.id } })).tags).toEqual([]);

    await bulkUpdateGames({ gameIds: [a.id], addTags: ["replay"], removeTags: ["owned"] });
    expect((await prisma.game.findUniqueOrThrow({ where: { id: a.id } })).tags).toEqual([
      "rpg",
      "replay",
    ]);
  });

  it("refuses a tag both added and removed, writing nothing", async () => {
    const bk = await makeGame({ tags: ["epic"] });
    expect(
      await bulkUpdateGames({ gameIds: [bk.id], addTags: ["new"], removeTags: ["new"] }),
    ).toEqual({ error: "“new” is in both Add tags and Remove tags." });
    expect((await prisma.game.findUniqueOrThrow({ where: { id: bk.id } })).tags).toEqual(["epic"]);
  });

  it("applies to every game matching the filters, past any page, and only the player's", async () => {
    const tagged = await Promise.all(
      Array.from({ length: 205 }, (_, i) => makeGame({ title: `Tagged ${i}`, tags: ["x"] })),
    );
    const untagged = await makeGame({ tags: ["y"] });
    const theirs = await makeGame({ tags: ["x"] }, otherUserId);

    const res = await bulkUpdateGames({
      matching: { tag: "x", sort: "title", dir: "asc", group: "none", limit: "200" },
      ownership: GameOwnership.WISHLIST,
    });

    expect(res).toEqual({ count: tagged.length });
    expect(
      await prisma.game.count({ where: { userId, ownership: GameOwnership.WISHLIST } }),
    ).toBe(205);
    expect((await prisma.game.findUniqueOrThrow({ where: { id: untagged.id } })).ownership).toBe(
      GameOwnership.OWNED,
    );
    expect((await prisma.game.findUniqueOrThrow({ where: { id: theirs.id } })).ownership).toBe(
      GameOwnership.OWNED,
    );
  });

  it("matches on a shelf only when the shelf is the player's", async () => {
    const theirGame = await makeGame({}, otherUserId);
    const theirShelf = await makeShelf("Theirs", [theirGame], otherUserId);
    await makeGame();

    expect(
      await bulkUpdateGames({ matching: { shelfId: theirShelf.id }, status: PlayStatus.DROPPED }),
    ).toEqual({ error: "No matching games" });
    expect((await prisma.game.findUniqueOrThrow({ where: { id: theirGame.id } })).status).toBe(
      PlayStatus.WANT_TO_PLAY,
    );
  });

  it("dates and counts every matching game moved to Completed", async () => {
    const games = await Promise.all([
      makeGame({ status: PlayStatus.PLAYING, tags: ["co-op"] }),
      makeGame({ status: PlayStatus.WANT_TO_PLAY, tags: ["co-op"] }),
    ]);

    const res = await bulkUpdateGames({ matching: { tag: "co-op" }, status: PlayStatus.COMPLETED });
    expect(res).toEqual({ count: 2 });

    for (const bk of games) {
      const after = await prisma.game.findUniqueOrThrow({ where: { id: bk.id } });
      expect(after.status).toBe(PlayStatus.COMPLETED);
      expect(after.dateFinished).not.toBeNull();
      expect(after.timesCompleted).toBe(1);
    }
  });

  it("leaves completed games undated when that is the preference", async () => {
    await prisma.user.update({
      where: { id: userId },
      data: { preferences: { addedAsCompletedFinished: "undated" } },
    });
    const bk = await makeGame({ status: PlayStatus.PLAYING });

    await bulkUpdateGames({ gameIds: [bk.id], status: PlayStatus.COMPLETED });
    const after = await prisma.game.findUniqueOrThrow({ where: { id: bk.id } });
    expect(after.status).toBe(PlayStatus.COMPLETED);
    expect(after.dateFinished).toBeNull();
    expect(after.timesCompleted).toBe(1);
  });

  it("keeps the time played through Completed and Dropped, and clears it on Want to Play", async () => {
    const [done, dropped, shelved] = await Promise.all([
      makeGame({ status: PlayStatus.PLAYING, playedMinutes: 2520 }),
      makeGame({ status: PlayStatus.PLAYING, playedMinutes: 750 }),
      makeGame({ status: PlayStatus.PLAYING, playedMinutes: 90 }),
    ]);

    await bulkUpdateGames({ gameIds: [done.id], status: PlayStatus.COMPLETED });
    await bulkUpdateGames({ gameIds: [dropped.id], status: PlayStatus.DROPPED });
    await bulkUpdateGames({ gameIds: [shelved.id], status: PlayStatus.WANT_TO_PLAY });

    const played = async (id: string) =>
      (await prisma.game.findUniqueOrThrow({ where: { id } })).playedMinutes;
    // "Completed in 42 h", "stopped at 12 h 30 min".
    expect(await played(done.id)).toBe(2520);
    expect(await played(dropped.id)).toBe(750);
    expect(await played(shelved.id)).toBeNull();
  });

  it("takes 2,000 ids, and explains 2,001 instead of 'Invalid input'", async () => {
    const bk = await makeGame();
    const ids = [bk.id, ...Array.from({ length: 1999 }, (_, i) => `missing${i}`)];
    expect(await bulkUpdateGames({ gameIds: ids, status: PlayStatus.COMPLETED })).toEqual({
      count: 1,
    });

    expect(
      await bulkUpdateGames({ gameIds: [...ids, "one-more"], status: PlayStatus.DROPPED }),
    ).toEqual({
      error: "That's more than 2,000 games. Use “Select all games that match” instead.",
    });
  });
});

describe("bulkDeleteGames", () => {
  it("deletes the selection with its history, and nothing else", async () => {
    const [gone, kept] = await Promise.all([makeGame(), makeGame()]);
    const theirs = await makeGame({}, otherUserId);
    await prisma.playthrough.create({ data: { gameId: gone.id } });
    await prisma.quote.create({ data: { gameId: gone.id, text: "A line" } });
    await prisma.loan.create({ data: { gameId: gone.id, borrower: "Sam" } });

    expect(await bulkDeleteGames({ gameIds: [gone.id, theirs.id] })).toEqual({ count: 1 });

    expect(await prisma.game.findUnique({ where: { id: gone.id } })).toBeNull();
    expect(await prisma.playthrough.count({ where: { gameId: gone.id } })).toBe(0);
    expect(await prisma.quote.count({ where: { gameId: gone.id } })).toBe(0);
    expect(await prisma.loan.count({ where: { gameId: gone.id } })).toBe(0);
    expect(await prisma.game.findUnique({ where: { id: kept.id } })).not.toBeNull();
    expect(await prisma.game.findUnique({ where: { id: theirs.id } })).not.toBeNull();
  });

  it("deletes every match only while the count is the one shown", async () => {
    await Promise.all([makeGame({ tags: ["weed"] }), makeGame({ tags: ["weed"] })]);
    const other = await makeGame({ tags: ["keep"] });

    expect(await bulkDeleteGames({ matching: { tag: "weed" }, expectedCount: 3 })).toEqual({
      error: "The games that match have changed. Check the count and try again.",
    });
    expect(await prisma.game.count({ where: { userId } })).toBe(3);

    expect(await bulkDeleteGames({ matching: { tag: "weed" }, expectedCount: 2 })).toEqual({
      count: 2,
    });
    expect(await prisma.game.findMany({ where: { userId }, select: { id: true } })).toEqual([
      { id: other.id },
    ]);
  });

  it("refuses when a match turns up after the count", async () => {
    await Promise.all([makeGame({ tags: ["weed"] }), makeGame({ tags: ["weed"] })]);
    // Another tab adds a matching game just after the server counted two.
    const count = vi.spyOn(appPrisma.game, "count").mockImplementationOnce((async (
      args: Parameters<typeof appPrisma.game.count>[0],
    ) => {
      count.mockRestore();
      const n = await appPrisma.game.count(args);
      await makeGame({ tags: ["weed"] });
      return n;
    }) as never);

    expect(await bulkDeleteGames({ matching: { tag: "weed" }, expectedCount: 2 })).toEqual({
      error: "The games that match have changed. Check the count and try again.",
    });
    expect(await prisma.game.count({ where: { userId } })).toBe(3);
  });

  it("removes cached covers no other game uses, and keeps shared ones", async () => {
    const write = async (name: string) => {
      await fs.writeFile(path.join(coversDir, name), "cover");
      return `/api/covers/${name}`;
    };
    const exists = (url: string) =>
      fs.access(path.join(coversDir, path.basename(url))).then(
        () => true,
        () => false,
      );
    const own = await write("own-cover.jpg");
    const shared = await write("shared-cover.jpg");
    const a = await makeGame({ coverUrl: own });
    const b = await makeGame({ coverUrl: shared });
    await makeGame({ coverUrl: shared }, otherUserId);
    const remote = await makeGame({ coverUrl: "https://covers.example.org/x.jpg" });

    expect(await bulkDeleteGames({ gameIds: [a.id, b.id, remote.id] })).toEqual({ count: 3 });

    expect(await exists(own)).toBe(false);
    expect(await exists(shared)).toBe(true);
  });
});
