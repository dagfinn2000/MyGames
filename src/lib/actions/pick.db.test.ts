import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GameOwnership, PrismaClient, PlayStatus } from "@prisma/client";

/**
 * Pick for me against a real database. The rule itself is unit-tested in
 * lib/pick.test.ts; what's pinned down here is that the action feeds it the
 * right rows: the tab and filters on screen, the switches from the stored
 * preferences, the whole series from the library, and nothing from another
 * account.
 */

const prisma = new PrismaClient();

let currentUserId: string | null = null;
vi.mock("@/auth", () => ({
  auth: async () => (currentUserId ? { user: { id: currentUserId } } : null),
  signOut: async () => {},
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

const { pickRandomGame } = await import("@/lib/actions/pick");

let userId: string;
let otherUserId: string;

async function makeGame(over: Record<string, unknown> = {}, owner = userId) {
  return prisma.game.create({
    data: { userId: owner, title: "Test Game", searchText: "test game", ...over },
  });
}

async function setPrefs(preferences: Record<string, boolean>) {
  await prisma.user.update({ where: { id: userId }, data: { preferences } });
}

/** Every game the pick can return, found by running it at both ends of
 *  Math.random's range (the pool is in database order, so this covers a
 *  pool of one or two exactly and shows a larger pool isn't a single game). */
async function picks(params: Record<string, string>): Promise<Set<string>> {
  const out = new Set<string>();
  const spy = vi.spyOn(Math, "random");
  try {
    for (const r of [0, 0.999]) {
      spy.mockReturnValue(r);
      const res = await pickRandomGame(params);
      out.add("id" in res ? res.id : res.reason);
    }
  } finally {
    spy.mockRestore();
  }
  return out;
}

beforeEach(async () => {
  const stamp = `${Date.now()}-${Math.random()}`;
  const [a, b] = await Promise.all([
    prisma.user.create({ data: { username: `pick-${stamp}`, passwordHash: "x" } }),
    prisma.user.create({ data: { username: `pick-oth-${stamp}`, passwordHash: "x" } }),
  ]);
  userId = a.id;
  otherUserId = b.id;
  currentUserId = userId;
});

afterEach(async () => {
  await prisma.user.deleteMany({ where: { id: { in: [userId, otherUserId] } } });
});

describe("pickRandomGame", () => {
  it("stays on the status tab instead of opening a Want to Play game", async () => {
    const done = await makeGame({ status: PlayStatus.COMPLETED });
    await makeGame({ status: PlayStatus.WANT_TO_PLAY });

    expect(await picks({ shelf: "COMPLETED" })).toEqual(new Set([done.id]));
  });

  it("prefers Want to Play on the All tab, and falls back when there is none", async () => {
    const want = await makeGame({ status: PlayStatus.WANT_TO_PLAY });
    const done = await makeGame({ status: PlayStatus.COMPLETED });
    expect(await picks({})).toEqual(new Set([want.id]));

    await prisma.game.delete({ where: { id: want.id } });
    expect(await picks({ shelf: "all" })).toEqual(new Set([done.id]));
  });

  it("only picks games you have when asked to", async () => {
    await setPrefs({ pickOnlyHave: true });
    const owned = await makeGame();
    const borrowed = await makeGame({ ownership: GameOwnership.BORROWED });
    await makeGame({ ownership: GameOwnership.WISHLIST });
    await makeGame({ ownership: GameOwnership.GIVEN_AWAY });
    const lent = await makeGame();
    await prisma.loan.create({ data: { gameId: lent.id, borrower: "Kari" } });
    // A loan that came back doesn't count.
    const back = await makeGame();
    await prisma.loan.create({
      data: { gameId: back.id, borrower: "Ola", returnedAt: new Date() },
    });

    const seen = new Set<string>();
    const spy = vi.spyOn(Math, "random");
    try {
      for (let i = 0; i < 6; i++) {
        spy.mockReturnValue(i / 6);
        const res = await pickRandomGame({});
        if ("id" in res) seen.add(res.id);
      }
    } finally {
      spy.mockRestore();
    }
    expect(seen).toEqual(new Set([owned.id, borrowed.id, back.id]));
  });

  it("only picks the next game in a series when asked to", async () => {
    await setPrefs({ pickNextInSeries: true });
    await makeGame({ seriesName: "Halo", seriesNumber: 1, status: PlayStatus.COMPLETED });
    const two = await makeGame({ seriesName: "Halo", seriesNumber: 2 });
    await makeGame({ seriesName: "halo", seriesNumber: 3 });

    // #1 is not on the Want to Play tab, but it still counts as completed.
    expect(await picks({ shelf: "WANT_TO_PLAY" })).toEqual(new Set([two.id]));
  });

  it("says when the switches leave nothing, and when nothing matches", async () => {
    await setPrefs({ pickOnlyHave: true });
    await makeGame({ ownership: GameOwnership.WISHLIST });

    expect(await picks({})).toEqual(new Set(["settings"]));
    expect(await picks({ shelf: "COMPLETED" })).toEqual(new Set(["none"]));
    expect(await picks({ q: "no such game" })).toEqual(new Set(["none"]));
  });

  it("never looks at another account's games", async () => {
    await setPrefs({ pickNextInSeries: true });
    await makeGame({ status: PlayStatus.WANT_TO_PLAY }, otherUserId);
    // Their unplayed #1 in a same-named series must not hold back my #2.
    await makeGame({ seriesName: "Halo", seriesNumber: 1 }, otherUserId);
    const mine = await makeGame({ seriesName: "Halo", seriesNumber: 2 });

    expect(await picks({})).toEqual(new Set([mine.id]));
  });

  it("treats a malformed request as no filters rather than failing", async () => {
    const want = await makeGame();
    const res = await pickRandomGame(null as unknown as Record<string, string>);
    expect(res).toEqual({ id: want.id });
  });

  it("refuses without a session", async () => {
    currentUserId = null;
    await expect(pickRandomGame({})).rejects.toThrow();
  });
});
