import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GameOwnership, PrismaClient } from "@prisma/client";

/**
 * setOwnership ("I bought it" on the Do I own this? page) against a real
 * database: it changes the one field, and only on the signed-in user's game.
 */

const prisma = new PrismaClient();

let currentUserId: string | null = null;
vi.mock("@/auth", () => ({
  auth: async () => (currentUserId ? { user: { id: currentUserId } } : null),
  signOut: async () => {},
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

const { setOwnership } = await import("@/lib/actions/ownership");

let userId: string;
let otherUserId: string;

async function makeGame(over: Record<string, unknown> = {}, owner = userId) {
  return prisma.game.create({
    data: { userId: owner, title: "Test Game", searchText: "test game", ...over },
  });
}

async function ownershipOf(id: string) {
  return (await prisma.game.findUniqueOrThrow({ where: { id } })).ownership;
}

beforeEach(async () => {
  const stamp = `${Date.now()}-${Math.random()}`;
  const [a, b] = await Promise.all([
    prisma.user.create({ data: { username: `own-${stamp}`, passwordHash: "x" } }),
    prisma.user.create({ data: { username: `own-oth-${stamp}`, passwordHash: "x" } }),
  ]);
  userId = a.id;
  otherUserId = b.id;
  currentUserId = userId;
});

afterEach(async () => {
  await prisma.user.deleteMany({ where: { id: { in: [userId, otherUserId] } } });
});

describe("setOwnership", () => {
  it("marks a wishlist game as owned", async () => {
    const bk = await makeGame({ ownership: GameOwnership.WISHLIST, rating: 8 });

    expect(await setOwnership(bk.id, GameOwnership.OWNED)).toEqual({ success: true });
    const after = await prisma.game.findUniqueOrThrow({ where: { id: bk.id } });
    expect(after.ownership).toBe(GameOwnership.OWNED);
    expect(after.rating).toBe(8);
  });

  it("leaves another account's game alone", async () => {
    const theirs = await makeGame({ ownership: GameOwnership.WISHLIST }, otherUserId);

    expect(await setOwnership(theirs.id, GameOwnership.OWNED)).toEqual({
      error: "Game not found",
    });
    expect(await ownershipOf(theirs.id)).toBe(GameOwnership.WISHLIST);
  });

  it("refuses an ownership that doesn't exist", async () => {
    const bk = await makeGame({ ownership: GameOwnership.GIVEN_AWAY });

    const res = await setOwnership(bk.id, "GIVEN" as GameOwnership);
    expect(res.error).toBeTruthy();
    expect(await ownershipOf(bk.id)).toBe(GameOwnership.GIVEN_AWAY);
  });

  it("needs a session", async () => {
    const bk = await makeGame({ ownership: GameOwnership.WISHLIST });
    currentUserId = null;

    await expect(setOwnership(bk.id, GameOwnership.OWNED)).rejects.toThrow();
    expect(await ownershipOf(bk.id)).toBe(GameOwnership.WISHLIST);
  });
});
