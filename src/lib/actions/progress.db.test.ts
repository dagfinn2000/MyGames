import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type Prisma, PrismaClient, PlayStatus } from "@prisma/client";
import { dailyMinuteTotals } from "@/lib/progress";
import type { MoveResult, UndoMove } from "@/lib/play-log";

/**
 * The play-log actions against a real database: quick logging for any
 * day, fixing and deleting entries, and Finished / Stopped with their undo.
 *
 * Stats credit each increase between consecutive entries to the later
 * entry's day, so these pin down the exact moments entries get and what
 * the game's time played does, as well as what is refused.
 */

const prisma = new PrismaClient();

let currentUserId: string | null = null;
vi.mock("@/auth", () => ({
  auth: async () => (currentUserId ? { user: { id: currentUserId } } : null),
  signOut: async () => {},
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

const { logTime, updateProgressEntry, deleteProgressEntry, moveFromPlaying, undoMoveFromPlaying } =
  await import("@/lib/actions/progress");

const OSLO = "Europe/Oslo";
// Monday 12 October 2026, 12:00 in Oslo.
const NOW = new Date("2026-10-12T10:00:00.000Z");
const at = (iso: string) => new Date(iso);

let userId: string;
let otherUserId: string;

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  const stamp = `${Date.now()}-${Math.random()}`;
  const [a, b] = await Promise.all([
    prisma.user.create({
      data: { username: `pr-${stamp}`, passwordHash: "x", preferences: { timeZone: OSLO } },
    }),
    prisma.user.create({ data: { username: `pro-${stamp}`, passwordHash: "x" } }),
  ]);
  userId = a.id;
  otherUserId = b.id;
  currentUserId = userId;
});

afterEach(async () => {
  vi.useRealTimers();
  await prisma.user.deleteMany({ where: { id: { in: [userId, otherUserId] } } });
});

function undoOf(result: MoveResult): UndoMove {
  if ("error" in result) throw new Error(result.error);
  return result.undo;
}

async function setPrefs(preferences: Prisma.InputJsonObject) {
  await prisma.user.update({ where: { id: userId }, data: { preferences } });
}

/** Hollow Knight, usually about 30 hours, being played since 5 October. */
async function makeGame(over: Record<string, unknown> = {}, owner = userId) {
  return prisma.game.create({
    data: {
      userId: owner,
      title: "Hollow Knight",
      developers: ["Team Cherry"],
      platform: "Nintendo Switch",
      searchText: "hollow knight team cherry nintendo switch",
      lengthMinutes: 1800,
      status: PlayStatus.PLAYING,
      dateStarted: at("2026-10-05T00:00:00.000Z"),
      ...over,
    },
  });
}

async function addEntries(gameId: string, entries: [number, string][]) {
  await prisma.progressEntry.createMany({
    data: entries.map(([minutes, iso]) => ({ gameId, minutes, date: at(iso) })),
  });
}

async function log(gameId: string) {
  const rows = await prisma.progressEntry.findMany({
    where: { gameId },
    orderBy: [{ date: "asc" }, { minutes: "asc" }],
  });
  return rows.map((r) => [r.minutes, r.date.toISOString()] as const);
}

async function gameRow(gameId: string) {
  return prisma.game.findUniqueOrThrow({ where: { id: gameId } });
}

describe("logTime", () => {
  it("anchors a fresh playthrough at its start date and logs today now", async () => {
    const game = await makeGame();
    expect(await logTime(game.id, { minutes: 90, day: "today" })).toEqual({
      ok: true,
      message: "Logged 1 h 30 min for today.",
      minutes: 90,
    });
    expect(await log(game.id)).toEqual([
      [0, "2026-10-05T00:00:00.000Z"],
      [90, NOW.toISOString()],
    ]);
    expect((await gameRow(game.id)).playedMinutes).toBe(90);
  });

  it("says how much was played as well as the total", async () => {
    const game = await makeGame({ playedMinutes: 600 });
    await addEntries(game.id, [[0, "2026-10-05T00:00:00.000Z"], [600, "2026-10-10T18:00:00.000Z"]]);
    expect(await logTime(game.id, { minutes: 750, day: "today" })).toMatchObject({
      message: "Logged 2 h 30 min for today, 12 h 30 min in all.",
    });
  });

  it("puts yesterday at the end of yesterday in the player's zone, and credits that day", async () => {
    const game = await makeGame();
    await addEntries(game.id, [[0, "2026-10-05T00:00:00.000Z"], [100, "2026-10-08T18:00:00.000Z"]]);
    const result = await logTime(game.id, { minutes: 150, day: "yesterday" });
    expect(result).toMatchObject({ ok: true, message: "Logged 50 min for yesterday, 2 h 30 min in all." });
    const rows = await log(game.id);
    expect(rows.at(-1)).toEqual([150, "2026-10-11T21:59:59.999Z"]);
    const totals = dailyMinuteTotals(
      rows.map(([minutes, date]) => ({ gameId: game.id, minutes, date: new Date(date) })),
      OSLO,
    );
    expect(totals.get("2026-10-11")).toBe(50);
    expect((await gameRow(game.id)).playedMinutes).toBe(150);
  });

  it("slots an earlier day between two entries and leaves the time played alone", async () => {
    const game = await makeGame({ playedMinutes: 210 });
    await addEntries(game.id, [
      [0, "2026-10-05T00:00:00.000Z"],
      [120, "2026-10-08T18:00:00.000Z"],
      [210, "2026-10-12T07:00:00.000Z"],
    ]);
    expect(await logTime(game.id, { minutes: 160, day: "2026-10-10" })).toEqual({
      ok: true,
      message: "Logged 40 min for 10 Oct 2026, 2 h 40 min in all.",
      minutes: 160,
    });
    expect(await log(game.id)).toContainEqual([160, "2026-10-10T21:59:59.999Z"]);
    expect((await gameRow(game.id)).playedMinutes).toBe(210);
  });

  it("refuses an earlier day with more time than a later entry, and writes nothing", async () => {
    const game = await makeGame({ playedMinutes: 188 });
    await addEntries(game.id, [[0, "2026-10-05T00:00:00.000Z"], [188, "2026-10-12T07:00:00.000Z"]]);
    expect(await logTime(game.id, { minutes: 200, day: "yesterday" })).toEqual({
      error:
        "3 h 20 min for yesterday is more than the 3 h 8 min you logged today. Log it for a later day, or fix that entry.",
    });
    expect(await log(game.id)).toHaveLength(2);
  });

  it("refuses today with less time than the newest entry", async () => {
    const game = await makeGame({ playedMinutes: 400 });
    await addEntries(game.id, [[0, "2026-10-05T00:00:00.000Z"], [400, "2026-10-11T18:00:00.000Z"]]);
    expect(await logTime(game.id, { minutes: 380, day: "today" })).toEqual({
      error:
        "6 h 20 min for today is less than the 6 h 40 min you logged yesterday. If that entry is wrong, fix it with its pencil.",
    });
  });

  it("refuses a future day, a day before the start, and no time at all", async () => {
    const game = await makeGame();
    expect(await logTime(game.id, { minutes: 10, day: "2026-10-13" })).toEqual({
      error: "That day hasn't happened yet.",
    });
    expect(await logTime(game.id, { minutes: 10, day: "2026-10-04" })).toEqual({
      error: "You started this game on 5 Oct 2026. Pick that day or later.",
    });
    expect(await logTime(game.id, { minutes: 0, day: "today" })).toEqual({ error: "Log at least a minute" });
    expect(await logTime(game.id, { minutes: 600_001, day: "today" })).toEqual({
      error: "That's more than 10,000 hours",
    });
    expect(await logTime(game.id, { minutes: 10, day: "2026-02-30" })).toMatchObject({ error: expect.any(String) });
    expect(await log(game.id)).toEqual([]);
  });

  it("takes a time past the usual time to beat, without asking anything", async () => {
    const game = await makeGame({ playedMinutes: 1750 });
    await addEntries(game.id, [[0, "2026-10-05T00:00:00.000Z"], [1750, "2026-10-11T18:00:00.000Z"]]);
    expect(await logTime(game.id, { minutes: 2710, day: "today" })).toEqual({
      ok: true,
      message: "Logged 16 h for today, 45 h 10 min in all.",
      minutes: 2710,
    });
    expect(await gameRow(game.id)).toMatchObject({ status: PlayStatus.PLAYING, playedMinutes: 2710 });
  });

  it("refuses a game that isn't being played, and another account's game", async () => {
    const shelved = await makeGame({ status: PlayStatus.WANT_TO_PLAY });
    expect(await logTime(shelved.id, { minutes: 10, day: "today" })).toEqual({
      error: "Only games you're playing can log time. Set this one to Playing first.",
    });
    const theirs = await makeGame({}, otherUserId);
    expect(await logTime(theirs.id, { minutes: 10, day: "today" })).toEqual({ error: "Game not found" });
    expect(await logTime(42 as unknown as string, { minutes: 10, day: "today" })).toEqual({
      error: "Game not found",
    });
    expect(await log(theirs.id)).toEqual([]);
  });

  it("logs nothing for the time it's already at", async () => {
    const game = await makeGame();
    expect(await logTime(game.id, { minutes: 300, day: "today" })).toMatchObject({ ok: true });
    expect(await logTime(game.id, { minutes: 300, day: "today" })).toEqual({
      ok: true,
      message: "Already at 5 h.",
      minutes: 300,
    });
    expect(await log(game.id)).toHaveLength(2);
  });

  it("compares with the log, not a time played the log never reached", async () => {
    const game = await makeGame({ playedMinutes: 212 });
    await addEntries(game.id, [[0, "2026-10-05T00:00:00.000Z"], [200, "2026-10-10T18:00:00.000Z"]]);
    expect(await logTime(game.id, { minutes: 212, day: "today" })).toMatchObject({
      message: "Logged 12 min for today, 3 h 32 min in all.",
    });
    expect((await log(game.id)).at(-1)).toEqual([212, NOW.toISOString()]);
  });

  it("starts counting again after Play it again", async () => {
    // The first playthrough ended at 30 h; playAgain wrote a 0-minute anchor.
    const game = await makeGame({ dateStarted: at("2026-10-10T09:00:00.000Z") });
    await addEntries(game.id, [
      [0, "2026-09-01T10:00:00.000Z"],
      [1800, "2026-09-30T20:00:00.000Z"],
      [0, "2026-10-10T09:00:00.000Z"],
    ]);
    expect(await logTime(game.id, { minutes: 45, day: "yesterday" })).toMatchObject({
      message: "Logged 45 min for yesterday.",
    });
    const rows = await log(game.id);
    const totals = dailyMinuteTotals(
      rows.map(([minutes, date]) => ({ gameId: game.id, minutes, date: new Date(date) })),
      OSLO,
    );
    expect(totals.get("2026-10-11")).toBe(45);
  });

  describe("east of UTC on the start day", () => {
    // 08:00 on the 12th in Tokyo, before the typed Started date's midnight UTC.
    const morning = new Date("2026-10-11T23:00:00.000Z");
    const started = at("2026-10-12T00:00:00.000Z");

    beforeEach(async () => {
      vi.setSystemTime(morning);
      await setPrefs({ timeZone: "Asia/Tokyo" });
    });

    it("anchors a fresh playthrough no later than its first entry", async () => {
      const game = await makeGame({ dateStarted: started });
      expect(await logTime(game.id, { minutes: 30, day: "today" })).toMatchObject({ ok: true });
      const rows = await log(game.id);
      expect(rows).toEqual([
        [0, morning.toISOString()],
        [30, morning.toISOString()],
      ]);
      const totals = dailyMinuteTotals(
        rows.map(([minutes, date]) => ({ gameId: game.id, minutes, date: new Date(date) })),
        "Asia/Tokyo",
      );
      expect(totals.get("2026-10-12")).toBe(30);
    });

    it("counts on from a game added part-way through earlier that morning", async () => {
      // createGame's lone entry, from 07:30 in Tokyo, with no anchor.
      const game = await makeGame({ dateStarted: started, playedMinutes: 50 });
      await addEntries(game.id, [[50, "2026-10-11T22:30:00.000Z"]]);
      expect(await logTime(game.id, { minutes: 70, day: "today" })).toMatchObject({
        ok: true,
        message: "Logged 20 min for today, 1 h 10 min in all.",
      });
      expect(await log(game.id)).toEqual([
        [50, "2026-10-11T22:30:00.000Z"],
        [70, morning.toISOString()],
      ]);
      expect((await gameRow(game.id)).playedMinutes).toBe(70);
    });

    it("moves an existing start-date anchor back to the entry", async () => {
      const game = await makeGame({ dateStarted: started });
      await addEntries(game.id, [[0, started.toISOString()]]);
      expect(await logTime(game.id, { minutes: 30, day: "today" })).toMatchObject({ ok: true });
      expect(await log(game.id)).toEqual([
        [0, morning.toISOString()],
        [30, morning.toISOString()],
      ]);
    });
  });
});

describe("updateProgressEntry", () => {
  async function seeded(over: Record<string, unknown> = {}) {
    const game = await makeGame({ playedMinutes: 210, ...over });
    await addEntries(game.id, [
      [0, "2026-10-05T00:00:00.000Z"],
      [120, "2026-10-08T18:00:00.000Z"],
      [165, "2026-10-10T18:00:00.000Z"],
      [210, "2026-10-12T07:00:00.000Z"],
    ]);
    const rows = await prisma.progressEntry.findMany({ where: { gameId: game.id }, orderBy: { date: "asc" } });
    return { game, rows };
  }

  it("fixes a time within its neighbours, keeping its moment", async () => {
    const { game, rows } = await seeded();
    expect(await updateProgressEntry(rows[2].id, { minutes: 190, day: "2026-10-10" })).toEqual({
      message: "Fixed: 3 h 10 min for 10 Oct 2026.",
    });
    expect((await log(game.id))[2]).toEqual([190, "2026-10-10T18:00:00.000Z"]);
    expect((await gameRow(game.id)).playedMinutes).toBe(210);
  });

  it("moves the game's time played with the newest entry", async () => {
    const { game, rows } = await seeded();
    await updateProgressEntry(rows[3].id, { minutes: 205, day: "2026-10-12" });
    expect((await gameRow(game.id)).playedMinutes).toBe(205);
  });

  it("takes the newest entry past the usual time to beat", async () => {
    const { game, rows } = await seeded();
    expect(await updateProgressEntry(rows[3].id, { minutes: 2000, day: "2026-10-12" })).toEqual({
      message: "Fixed: 33 h 20 min for today.",
    });
    expect((await gameRow(game.id)).playedMinutes).toBe(2000);
  });

  it("moves an entry to another day", async () => {
    const { game, rows } = await seeded();
    expect(await updateProgressEntry(rows[2].id, { minutes: 165, day: "2026-10-11" })).toEqual({
      message: "Fixed: 2 h 45 min for yesterday.",
    });
    expect((await log(game.id))[2]).toEqual([165, "2026-10-11T21:59:59.999Z"]);
  });

  it("refuses crossing a neighbour, the start, and a future day", async () => {
    const { rows } = await seeded();
    expect(await updateProgressEntry(rows[2].id, { minutes: 230, day: "2026-10-10" })).toEqual({
      error: "That entry has to stay between 2 h and 3 h 30 min, to fit the days around it.",
    });
    // Moved to today, it would come after today's 3 h 30 min.
    expect(await updateProgressEntry(rows[2].id, { minutes: 165, day: "2026-10-12" })).toEqual({
      error: "That entry can't be less than 3 h 30 min, to fit the days around it.",
    });
    expect(await updateProgressEntry(rows[1].id, { minutes: 120, day: "2026-10-01" })).toEqual({
      error: "That's before this playthrough started (5 Oct 2026).",
    });
    expect(await updateProgressEntry(rows[1].id, { minutes: 120, day: "2026-10-13" })).toEqual({
      error: "That day hasn't happened yet.",
    });
  });

  it("keeps an entry of a playthrough with no anchor on or after its Started day", async () => {
    // A game added part-way through: one entry, no 0-minute anchor. Moved
    // before Started it would leave the playthrough and take the game's
    // time played with it.
    const game = await makeGame({ playedMinutes: 120 });
    await addEntries(game.id, [[120, "2026-10-08T12:00:00.000Z"]]);
    const [row] = await prisma.progressEntry.findMany({ where: { gameId: game.id } });
    expect(await updateProgressEntry(row.id, { minutes: 120, day: "2026-09-28" })).toEqual({
      error: "You started this game on 5 Oct 2026. Pick that day or later.",
    });
    expect(await log(game.id)).toEqual([[120, "2026-10-08T12:00:00.000Z"]]);
    expect(await updateProgressEntry(row.id, { minutes: 120, day: "2026-10-05" })).toEqual({
      message: "Fixed: 2 h for 5 Oct 2026.",
    });
    expect((await gameRow(game.id)).playedMinutes).toBe(120);
  });

  it("keeps an entry of an earlier playthrough before the next one starts", async () => {
    const game = await makeGame({ playedMinutes: 50 });
    await addEntries(game.id, [
      [0, "2026-01-05T10:00:00.000Z"],
      [1800, "2026-02-01T10:00:00.000Z"],
      [0, "2026-03-01T10:00:00.000Z"],
      [50, "2026-03-02T10:00:00.000Z"],
    ]);
    const rows = await prisma.progressEntry.findMany({ where: { gameId: game.id }, orderBy: { date: "asc" } });
    expect(await updateProgressEntry(rows[1].id, { minutes: 1800, day: "2026-03-05" })).toEqual({
      error: "That's after you started playing it again (1 Mar 2026).",
    });
    // An earlier playthrough's fix leaves the current one's time alone.
    await updateProgressEntry(rows[1].id, { minutes: 1790, day: "2026-02-01" });
    expect((await gameRow(game.id)).playedMinutes).toBe(50);
  });

  it("refuses the start of a playthrough and another account's entry", async () => {
    const { rows } = await seeded();
    expect(await updateProgressEntry(rows[0].id, { minutes: 5, day: "2026-10-05" })).toEqual({
      error: "The start of a playthrough can't be changed.",
    });
    currentUserId = otherUserId;
    expect(await updateProgressEntry(rows[2].id, { minutes: 150, day: "2026-10-10" })).toEqual({
      error: "Entry not found",
    });
  });
});

describe("deleteProgressEntry", () => {
  it("moves the time played back when the newest entry goes, and only then", async () => {
    const game = await makeGame({ playedMinutes: 210 });
    await addEntries(game.id, [
      [0, "2026-10-05T00:00:00.000Z"],
      [120, "2026-10-08T18:00:00.000Z"],
      [210, "2026-10-12T07:00:00.000Z"],
    ]);
    const rows = await prisma.progressEntry.findMany({ where: { gameId: game.id }, orderBy: { date: "asc" } });
    expect(await deleteProgressEntry(rows[1].id)).toEqual({});
    expect((await gameRow(game.id)).playedMinutes).toBe(210);
    await deleteProgressEntry(rows[2].id);
    expect((await gameRow(game.id)).playedMinutes).toBeNull();
    expect(await log(game.id)).toEqual([[0, "2026-10-05T00:00:00.000Z"]]);
  });

  it("won't delete the start of a playthrough, or another account's entry", async () => {
    const game = await makeGame();
    await addEntries(game.id, [[0, "2026-10-05T00:00:00.000Z"], [20, "2026-10-06T10:00:00.000Z"]]);
    const rows = await prisma.progressEntry.findMany({ where: { gameId: game.id }, orderBy: { date: "asc" } });
    expect(await deleteProgressEntry(rows[0].id)).toEqual({
      error: "The start of a playthrough can't be deleted.",
    });
    currentUserId = otherUserId;
    expect(await deleteProgressEntry(rows[1].id)).toEqual({ error: "Entry not found" });
    expect(await log(game.id)).toHaveLength(2);
  });
});

describe("moveFromPlaying and undo", () => {
  it("completes today, keeping the time played, and can be undone", async () => {
    const game = await makeGame({ playedMinutes: 1650 });
    await prisma.playthrough.create({ data: { gameId: game.id, playedMinutes: 1900 } }); // an earlier one
    await addEntries(game.id, [[0, "2026-10-05T00:00:00.000Z"], [1650, "2026-10-11T18:00:00.000Z"]]);

    const moved = await moveFromPlaying(game.id, "COMPLETED");
    expect(moved).toEqual({
      ok: true,
      finished: true,
      message: "Hollow Knight moved to Completed. Finished today, in 27 h 30 min.",
      undo: { from: "COMPLETED", finishedAt: NOW.toISOString() },
    });
    expect(await gameRow(game.id)).toMatchObject({
      status: PlayStatus.COMPLETED,
      dateStarted: at("2026-10-05T00:00:00.000Z"),
      dateFinished: NOW,
      playedMinutes: 1650,
      timesCompleted: 2,
    });
    // No closing entry: the log already says how long it took.
    expect(await log(game.id)).toHaveLength(2);

    expect(await undoMoveFromPlaying(game.id, undoOf(moved))).toEqual({});
    expect(await gameRow(game.id)).toMatchObject({
      status: PlayStatus.PLAYING,
      dateFinished: null,
      playedMinutes: 1650,
      timesCompleted: 1,
    });
    expect(await log(game.id)).toHaveLength(2);
  });

  it("says nothing about a time it doesn't have", async () => {
    const game = await makeGame();
    expect(await moveFromPlaying(game.id, "COMPLETED")).toMatchObject({
      message: "Hollow Knight moved to Completed. Finished today.",
    });
    const other = await makeGame({ title: "Celeste" });
    expect(await moveFromPlaying(other.id, "DROPPED")).toMatchObject({
      message: "Celeste moved to Dropped.",
    });
  });

  it("stops at the time played, writing nothing to the log", async () => {
    const game = await makeGame({ playedMinutes: 750 });
    await addEntries(game.id, [[0, "2026-10-05T00:00:00.000Z"], [750, "2026-10-11T18:00:00.000Z"]]);
    const moved = await moveFromPlaying(game.id, "DROPPED");
    expect(moved).toMatchObject({
      message: "Hollow Knight moved to Dropped at 12 h 30 min.",
      finished: false,
      undo: { from: "DROPPED", finishedAt: null },
    });
    expect(await gameRow(game.id)).toMatchObject({ status: PlayStatus.DROPPED, playedMinutes: 750 });
    expect(await log(game.id)).toHaveLength(2);
    await undoMoveFromPlaying(game.id, undoOf(moved));
    expect(await gameRow(game.id)).toMatchObject({ status: PlayStatus.PLAYING, playedMinutes: 750 });
  });

  it("refuses a game that isn't being played and another account's game", async () => {
    const shelved = await makeGame({ status: PlayStatus.COMPLETED });
    expect(await moveFromPlaying(shelved.id, "COMPLETED")).toEqual({
      error: "This game isn't in Playing any more.",
    });
    const theirs = await makeGame({}, otherUserId);
    expect(await moveFromPlaying(theirs.id, "COMPLETED")).toEqual({ error: "Game not found" });
    expect((await gameRow(theirs.id)).status).toBe(PlayStatus.PLAYING);
  });

  it("won't undo once the game has changed, and leaves the log alone", async () => {
    const game = await makeGame({ playedMinutes: 100, dateStarted: at("2026-09-01T10:00:00.000Z") });
    await addEntries(game.id, [
      [0, "2026-01-05T10:00:00.000Z"],
      [1800, "2026-02-01T00:00:00.000Z"],
      [0, "2026-09-01T10:00:00.000Z"],
      [100, "2026-10-10T10:00:00.000Z"],
    ]);
    const moved = await moveFromPlaying(game.id, "COMPLETED");
    const undo = undoOf(moved);

    // A crafted undo aimed at another finish is refused.
    expect(
      await undoMoveFromPlaying(game.id, { ...undo, finishedAt: "2026-02-01T00:00:00.000Z" }),
    ).toEqual({ error: "This game has changed since. Open it to set its status." });
    // So is one after the game was moved on elsewhere.
    await prisma.game.update({ where: { id: game.id }, data: { status: PlayStatus.WANT_TO_PLAY } });
    expect(await undoMoveFromPlaying(game.id, undo)).toEqual({
      error: "This game has changed since. Open it to set its status.",
    });
    await prisma.game.update({ where: { id: game.id }, data: { status: PlayStatus.COMPLETED } });

    expect(await undoMoveFromPlaying(game.id, undo)).toEqual({});
    expect(await log(game.id)).toEqual([
      [0, "2026-01-05T10:00:00.000Z"],
      [1800, "2026-02-01T00:00:00.000Z"],
      [0, "2026-09-01T10:00:00.000Z"],
      [100, "2026-10-10T10:00:00.000Z"],
    ]);
    expect((await gameRow(game.id)).playedMinutes).toBe(100);
  });

  it("refuses an undo for another account's game", async () => {
    const theirs = await makeGame({ status: PlayStatus.DROPPED }, otherUserId);
    expect(await undoMoveFromPlaying(theirs.id, { from: "DROPPED", finishedAt: null })).toEqual({
      error: "Game not found",
    });
    expect((await gameRow(theirs.id)).status).toBe(PlayStatus.DROPPED);
  });
});
