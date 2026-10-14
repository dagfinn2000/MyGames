import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { GameFormat, GameOwnership, PrismaClient, PlayStatus, type Prisma } from "@prisma/client";
import type { GameDetails, GameMetadata } from "@/lib/metadata/types";

/**
 * The shelf scan's server actions against a real database, with the game
 * catalogues stubbed: what's under test is what lands in the library (with
 * the reader's New games settings and tag rules), what is reported instead
 * of added, and that the lookup budget is respected.
 */

const prisma = new PrismaClient();

let currentUserId: string | null = null;
vi.mock("@/auth", () => ({
  auth: async () => (currentUserId ? { user: { id: currentUserId } } : null),
  signOut: async () => {},
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  after: () => {},
}));

const searchGames = vi.fn<(q: string) => Promise<GameMetadata[]>>();
const getGameDetails = vi.fn<(params: unknown) => Promise<GameDetails>>();
vi.mock("@/lib/metadata", async () => {
  class CataloguesUnreachableError extends Error {}
  return {
    CataloguesUnreachableError,
    searchGames: (q: string) => searchGames(q),
    getGameDetails: (params: unknown) => getGameDetails(params),
  };
});
const { CataloguesUnreachableError } = await import("@/lib/metadata");

const { scanAddGame, removeScannedGame } = await import("@/lib/actions/shelf-scan");
const { takeMetadataBudget } = await import("@/lib/api-guard");

let userId: string;
let otherUserId: string;
let coversDir: string;
const savedCoversDir = process.env.COVERS_DIR;

beforeAll(async () => {
  coversDir = await fs.mkdtemp(path.join(os.tmpdir(), "mygames-scan-covers-"));
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
    prisma.user.create({ data: { username: `scan-${stamp}`, passwordHash: "x" } }),
    prisma.user.create({ data: { username: `scano-${stamp}`, passwordHash: "x" } }),
  ]);
  userId = a.id;
  otherUserId = b.id;
  currentUserId = userId;
  searchGames.mockReset().mockResolvedValue([hobbit()]);
  getGameDetails.mockReset().mockResolvedValue({
    description: "In a hole in the ground there lived a hobbit.",
    pageCount: 310,
    tags: ["Fantasy", "Fiction, General"],
    coverUrl: null,
    openLibraryId: "OL27482W",
  });
});

afterEach(async () => {
  await prisma.user.deleteMany({ where: { id: { in: [userId, otherUserId] } } });
});

function hobbit(over: Partial<GameMetadata> = {}): GameMetadata {
  return {
    title: "The Hobbit",
    authors: ["J.R.R. Tolkien"],
    isbn: "9780000000001", // another edition of the work
    coverUrl: null,
    description: null,
    pageCount: 290,
    publishedDate: "1937",
    tags: [],
    openLibraryId: "OL27482W",
    source: "openlibrary",
    ...over,
  };
}

const SCANNED = "9780261103344";

async function setPrefs(prefs: Prisma.InputJsonObject) {
  await prisma.user.update({ where: { id: userId }, data: { preferences: prefs } });
}

describe("scanAddGame", () => {
  it("adds the game with the New games settings and the scanned ISBN", async () => {
    await setPrefs({
      newGameFormat: "EBOOK",
      newGameOwnership: "WISHLIST",
      newGameStatus: "WANT_TO_PLAY",
    });
    const res = await scanAddGame(SCANNED);

    expect(res.kind).toBe("added");
    expect(res.budget).toEqual({ used: 3, limit: 90 });
    const game = await prisma.game.findFirstOrThrow({ where: { userId } });
    expect(game).toMatchObject({
      title: "The Hobbit",
      authors: ["J.R.R. Tolkien"],
      isbn: SCANNED,
      format: GameFormat.EBOOK,
      ownership: GameOwnership.WISHLIST,
      status: PlayStatus.WANT_TO_PLAY,
      pageCount: 310,
      openLibraryId: "OL27482W",
      searchText: "the hobbit j.r.r. tolkien",
    });
    expect(game.tags).toEqual(["fantasy", "fiction", "general"]);
  });

  it("applies the tag rules and the import mode to the subjects", async () => {
    await setPrefs({
      importTagsMode: "known",
      tagRenames: [{ from: "fiction", to: "novels" }],
      tagSkips: ["general"],
    });
    await prisma.game.create({
      data: { userId, title: "Other", searchText: "other", tags: ["novels"] },
    });
    await scanAddGame(SCANNED);

    const game = await prisma.game.findFirstOrThrow({ where: { userId, isbn: SCANNED } });
    expect(game.tags).toEqual(["novels"]);
  });

  it("follows the finish-date preference for a game added as Read", async () => {
    await setPrefs({ newGameStatus: "COMPLETED", addedAsCompletedFinished: "undated" });
    await scanAddGame(SCANNED);
    let game = await prisma.game.findFirstOrThrow({ where: { userId } });
    expect(game.dateFinished).toBeNull();
    expect(game.timesCompleted).toBe(1);

    await prisma.game.deleteMany({ where: { userId } });
    await setPrefs({ newGameStatus: "COMPLETED", addedAsCompletedFinished: "today" });
    await scanAddGame(SCANNED);
    game = await prisma.game.findFirstOrThrow({ where: { userId } });
    expect(game.dateFinished?.toDateString()).toBe(new Date().toDateString());
  });

  it("answers 'have' for an ISBN already in the library, in its other form, without asking the catalogues", async () => {
    const mine = await prisma.game.create({
      data: { userId, title: "The Hobbit", searchText: "the hobbit", isbn: "0261103342" },
    });
    const res = await scanAddGame(SCANNED);

    expect(res).toMatchObject({ kind: "have", match: "isbn", game: { id: mine.id } });
    expect(res.budget.used).toBe(0);
    expect(searchGames).not.toHaveBeenCalled();
    expect(await prisma.game.count({ where: { userId } })).toBe(1);
  });

  it("says how the library holds the match, so a wishlist copy isn't worded as one you have", async () => {
    const wished = await prisma.game.create({
      data: {
        userId,
        title: "The Hobbit",
        searchText: "the hobbit",
        isbn: SCANNED,
        format: GameFormat.EBOOK,
        ownership: GameOwnership.WISHLIST,
      },
    });
    expect(await scanAddGame(SCANNED)).toMatchObject({
      kind: "have",
      match: "isbn",
      game: { id: wished.id, ownership: GameOwnership.WISHLIST, format: GameFormat.EBOOK },
    });

    await prisma.game.update({
      where: { id: wished.id },
      data: {
        isbn: null,
        ownership: GameOwnership.GIVEN_AWAY,
        authors: ["J.R.R. Tolkien"],
        searchText: "the hobbit j.r.r. tolkien",
      },
    });
    expect(await scanAddGame(SCANNED)).toMatchObject({
      kind: "have",
      match: "title",
      game: { id: wished.id, ownership: GameOwnership.GIVEN_AWAY, format: GameFormat.EBOOK },
    });
  });

  it("reports the same title in another edition, and adds it when asked to", async () => {
    await prisma.game.create({
      data: {
        userId,
        title: "The Hobbit",
        authors: ["J. R. R. Tolkien"],
        searchText: "the hobbit j. r. r. tolkien",
      },
    });
    expect(await scanAddGame(SCANNED)).toMatchObject({ kind: "have", match: "title" });
    expect(await prisma.game.count({ where: { userId } })).toBe(1);

    expect((await scanAddGame(SCANNED, { force: true })).kind).toBe("added");
    expect(await prisma.game.count({ where: { userId } })).toBe(2);
  });

  it("answers notFound and adds nothing when no catalogue knows the code", async () => {
    searchGames.mockResolvedValue([]);
    expect(await scanAddGame(SCANNED)).toMatchObject({ kind: "notFound", isbn: SCANNED });
    expect(await prisma.game.count({ where: { userId } })).toBe(0);
  });

  it("pauses with a wait when the lookup budget is spent, and adds nothing", async () => {
    for (let i = 0; i < 90; i++) takeMetadataBudget(userId);
    const res = await scanAddGame(SCANNED);

    expect(res.kind).toBe("paused");
    if (res.kind === "paused") expect(res.retryInMs).toBeGreaterThan(0);
    expect(searchGames).not.toHaveBeenCalled();
    expect(await prisma.game.count({ where: { userId } })).toBe(0);
  });

  it("still adds the game, without details, when only the search fits in the budget", async () => {
    for (let i = 0; i < 89; i++) takeMetadataBudget(userId);
    expect((await scanAddGame(SCANNED)).kind).toBe("added");

    expect(getGameDetails).not.toHaveBeenCalled();
    const game = await prisma.game.findFirstOrThrow({ where: { userId } });
    expect(game.pageCount).toBe(290);
    expect(game.description).toBeNull();
  });

  it("says so when the catalogues are down", async () => {
    searchGames.mockRejectedValue(new CataloguesUnreachableError());
    expect(await scanAddGame(SCANNED)).toMatchObject({
      kind: "error",
      message: "Couldn't reach the game catalogues",
    });
    expect(await prisma.game.count({ where: { userId } })).toBe(0);
  });

  it("refuses junk before any lookup", async () => {
    expect((await scanAddGame("not a barcode")).kind).toBe("error");
    expect((await scanAddGame("9".repeat(40))).kind).toBe("error");
    expect(searchGames).not.toHaveBeenCalled();
  });

  it("throws when signed out", async () => {
    currentUserId = null;
    await expect(scanAddGame(SCANNED)).rejects.toThrow("Not authenticated");
  });
});

describe("removeScannedGame", () => {
  it("deletes the reader's own game and its cached cover", async () => {
    await fs.writeFile(path.join(coversDir, "scanned.jpg"), "cover");
    const bk = await prisma.game.create({
      data: { userId, title: "Oops", searchText: "oops", coverUrl: "/api/covers/scanned.jpg" },
    });
    expect(await removeScannedGame(bk.id)).toEqual({});

    expect(await prisma.game.findUnique({ where: { id: bk.id } })).toBeNull();
    await expect(fs.access(path.join(coversDir, "scanned.jpg"))).rejects.toThrow();
  });

  it("leaves another account's game alone", async () => {
    const theirs = await prisma.game.create({
      data: { userId: otherUserId, title: "Theirs", searchText: "theirs" },
    });
    expect(await removeScannedGame(theirs.id)).toEqual({ error: "Game not found" });
    expect(await prisma.game.findUnique({ where: { id: theirs.id } })).not.toBeNull();
  });
});
