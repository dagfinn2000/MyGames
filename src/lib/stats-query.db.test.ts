import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { dailyMinuteTotals } from "@/lib/progress";
import { dailyMinuteTotalsForUser } from "@/lib/progress-query";
import { buildPasses, countWindow, tally, type CountRules } from "@/lib/stats-count";
import { yearWindow } from "@/lib/stats-period";
import { gameDayMinuteTotalsForUser, loadStatsInputs } from "@/lib/stats-query";

/**
 * The per-game log totals behind hours played "as logged" must be the play
 * calendar's numbers split by game: per game they equal dailyMinuteTotals
 * on that game's entries, and summed per day they equal
 * dailyMinuteTotalsForUser. If the delta rule changes in lib/progress.ts or
 * lib/progress-query.ts and not here, this fails.
 */
const prisma = new PrismaClient();
const USER = "stats-query-user";
const OTHER = "stats-query-other";
const ZONES = ["UTC", "Europe/Oslo", "America/New_York", "Asia/Tokyo"];

const at = (iso: string) => new Date(iso);

const games = [
  // A normal run, with times that fall on different days east and west.
  { id: "sq-a", status: "COMPLETED" as const, dateStarted: null },
  // Overlapping days with a backwards correction.
  { id: "sq-b", status: "PLAYING" as const, dateStarted: null },
  // A lone entry: credits nothing.
  { id: "sq-c", status: "PLAYING" as const, dateStarted: null },
  // Completed, then played again from a 0-minute anchor on the same day.
  { id: "sq-d", status: "PLAYING" as const, dateStarted: at("2026-03-02T21:00:00Z") },
  // No anchor: the current playthrough starts on the start date.
  { id: "sq-f", status: "PLAYING" as const, dateStarted: at("2026-04-10T00:00:00Z") },
  // Dropped at 3 h 38 min.
  {
    id: "sq-e",
    status: "DROPPED" as const,
    dateStarted: null,
    playedMinutes: 218,
    platform: "Nintendo Switch",
  },
];

const entries: { gameId: string; minutes: number; date: Date }[] = [
  { gameId: "sq-a", minutes: 0, date: at("2026-03-01T09:00:00Z") },
  { gameId: "sq-a", minutes: 40, date: at("2026-03-01T23:30:00Z") },
  { gameId: "sq-a", minutes: 90, date: at("2026-03-02T03:30:00Z") },
  { gameId: "sq-a", minutes: 150, date: at("2026-03-03T12:00:00Z") },

  { gameId: "sq-b", minutes: 0, date: at("2026-03-02T10:00:00Z") },
  { gameId: "sq-b", minutes: 25, date: at("2026-03-02T21:00:00Z") },
  { gameId: "sq-b", minutes: 10, date: at("2026-03-04T12:00:00Z") },
  { gameId: "sq-b", minutes: 60, date: at("2026-03-05T12:00:00Z") },

  { gameId: "sq-c", minutes: 300, date: at("2026-03-06T12:00:00Z") },

  { gameId: "sq-d", minutes: 0, date: at("2026-03-01T09:00:00Z") },
  { gameId: "sq-d", minutes: 100, date: at("2026-03-01T20:00:00Z") },
  { gameId: "sq-d", minutes: 300, date: at("2026-03-02T12:00:00Z") },
  { gameId: "sq-d", minutes: 0, date: at("2026-03-02T21:00:00Z") },
  { gameId: "sq-d", minutes: 40, date: at("2026-03-02T22:00:00Z") },
  { gameId: "sq-d", minutes: 90, date: at("2026-03-03T12:00:00Z") },

  { gameId: "sq-f", minutes: 10, date: at("2026-04-01T12:00:00Z") },
  { gameId: "sq-f", minutes: 50, date: at("2026-04-02T12:00:00Z") },
  // The morning of 10 April in Tokyo, still 9 April in UTC.
  { gameId: "sq-f", minutes: 65, date: at("2026-04-09T20:00:00Z") },
  { gameId: "sq-f", minutes: 80, date: at("2026-04-11T12:00:00Z") },

  { gameId: "sq-e", minutes: 0, date: at("2026-05-01T12:00:00Z") },
  { gameId: "sq-e", minutes: 120, date: at("2026-05-03T12:00:00Z") },
  { gameId: "sq-e", minutes: 218, date: at("2026-05-09T18:00:00Z") },
];

beforeAll(async () => {
  await prisma.user.deleteMany({ where: { id: { in: [USER, OTHER] } } });
  await prisma.user.create({
    data: { id: USER, username: `statsq-${Date.now()}`, passwordHash: "x" },
  });
  await prisma.user.create({
    data: { id: OTHER, username: `statsq-other-${Date.now()}`, passwordHash: "x" },
  });
  for (const g of games) {
    await prisma.game.create({
      data: { ...g, userId: USER, title: g.id, searchText: g.id },
    });
  }
  await prisma.progressEntry.createMany({ data: entries });
  await prisma.playthrough.create({
    data: { gameId: "sq-a", dateFinished: at("2025-05-01T00:00:00Z"), playedMinutes: 1500 },
  });

  // Someone else's playing, which must never show up.
  await prisma.game.create({
    data: { id: "sq-other", userId: OTHER, title: "theirs", searchText: "theirs", status: "DROPPED" },
  });
  await prisma.progressEntry.createMany({
    data: [
      { gameId: "sq-other", minutes: 0, date: at("2026-03-02T09:00:00Z") },
      { gameId: "sq-other", minutes: 500, date: at("2026-03-02T20:00:00Z") },
    ],
  });
  await prisma.playthrough.create({ data: { gameId: "sq-other", dateFinished: at("2025-01-01T00:00:00Z") } });
});

afterAll(async () => {
  await prisma.user.deleteMany({ where: { id: { in: [USER, OTHER] } } });
  await prisma.$disconnect();
});

describe("gameDayMinuteTotalsForUser", () => {
  it("matches dailyMinuteTotals game by game, in every zone", async () => {
    for (const zone of ZONES) {
      const rows = await gameDayMinuteTotalsForUser(USER, zone);
      for (const { id } of games) {
        const fromSql = new Map<string, number>();
        for (const r of rows.filter((r) => r.gameId === id)) {
          fromSql.set(r.day, (fromSql.get(r.day) ?? 0) + r.minutes);
        }
        const fromJs = dailyMinuteTotals(
          entries.filter((e) => e.gameId === id),
          zone,
        );
        expect(Object.fromEntries([...fromSql].sort()), `${id} ${zone}`).toEqual(
          Object.fromEntries([...fromJs].sort()),
        );
      }
    }
  });

  it("sums per day to the play calendar's totals", async () => {
    for (const zone of ZONES) {
      const rows = await gameDayMinuteTotalsForUser(USER, zone);
      const summed = new Map<string, number>();
      for (const r of rows) summed.set(r.day, (summed.get(r.day) ?? 0) + r.minutes);
      const calendar = await dailyMinuteTotalsForUser(USER, zone);
      expect(Object.fromEntries([...summed].sort()), zone).toEqual(
        Object.fromEntries([...calendar].sort()),
      );
    }
  });

  it("marks which time belongs to the current playthrough", async () => {
    const rows = await gameDayMinuteTotalsForUser(USER, "UTC");
    const of = (id: string, from = rows) =>
      from
        .filter((r) => r.gameId === id)
        .map(({ day, minutes, current }) => ({ day, minutes, current }))
        .sort((a, b) => a.day.localeCompare(b.day) || Number(a.current) - Number(b.current));

    // The replay's anchor splits 2 March between the two playthroughs.
    expect(of("sq-d")).toEqual([
      { day: "2026-03-01", minutes: 100, current: false },
      { day: "2026-03-02", minutes: 200, current: false },
      { day: "2026-03-02", minutes: 40, current: true },
      { day: "2026-03-03", minutes: 50, current: true },
    ]);
    // No anchor: the start date decides, by calendar day in the player's
    // zone.
    expect(of("sq-f")).toEqual([
      { day: "2026-04-02", minutes: 40, current: false },
      { day: "2026-04-09", minutes: 15, current: false },
      { day: "2026-04-11", minutes: 15, current: true },
    ]);
    expect(of("sq-f", await gameDayMinuteTotalsForUser(USER, "Asia/Tokyo"))).toEqual([
      { day: "2026-04-02", minutes: 40, current: false },
      { day: "2026-04-10", minutes: 15, current: true },
      { day: "2026-04-11", minutes: 15, current: true },
    ]);
    // Neither: everything is the current pass.
    expect(of("sq-b").every((r) => r.current)).toBe(true);
  });

  it("only returns the player's own games", async () => {
    const rows = await gameDayMinuteTotalsForUser(USER, "UTC");
    expect(rows.some((r) => r.gameId === "sq-other")).toBe(false);
  });
});

describe("loadStatsInputs", () => {
  it("loads only the player's games and playthroughs, with their time played", async () => {
    const inputs = await loadStatsInputs(USER, "UTC");
    expect(inputs.games.map((g) => g.id).sort()).toEqual(games.map((g) => g.id).sort());
    expect(inputs.games.find((g) => g.id === "sq-e")).toMatchObject({
      status: "DROPPED",
      playedMinutes: 218,
      platform: "Nintendo Switch",
    });
    expect(inputs.playthroughs).toEqual([
      {
        gameId: "sq-a",
        dateStarted: null,
        dateFinished: at("2025-05-01T00:00:00Z"),
        rating: null,
        playedMinutes: 1500,
      },
    ]);
    expect(inputs.logDays.some((r) => r.gameId === "sq-other")).toBe(false);
  });

  it("dates dropped games by their latest log entry, and only those", async () => {
    const inputs = await loadStatsInputs(USER, "UTC");
    expect([...inputs.lastLogDates]).toEqual([["sq-e", at("2026-05-09T18:00:00Z")]]);
  });

  it("gives the counting each playthrough's time, on the day it ended", async () => {
    const rules: CountRules = { statsHoursPlayed: "finished", statsStoppedGames: "hours" };
    const passes = buildPasses(await loadStatsInputs(USER, "UTC"), rules, "UTC");
    // The archived playthrough: a game and its 25 h.
    expect(tally(countWindow(passes, yearWindow(2025), rules))).toMatchObject({
      games: 1,
      minutes: 1500,
    });
    // The dropped game's 3 h 38 min, on the day of its last log entry.
    const may9 = { from: "2026-05-09", to: "2026-05-09" };
    expect(tally(countWindow(passes, may9, rules))).toMatchObject({ games: 0, minutes: 218 });
  });
});
