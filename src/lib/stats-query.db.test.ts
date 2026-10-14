import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { dailyPageTotals } from "@/lib/progress";
import { dailyPageTotalsForUser } from "@/lib/progress-query";
import { gameDayPageTotalsForUser, loadStatsInputs } from "@/lib/stats-query";

/**
 * The per-game log totals behind "Pages I logged" must be the reading
 * calendar's numbers split by game: per game they equal dailyPageTotals on
 * that game's entries, and summed per day they equal dailyPageTotalsForUser.
 * If the delta rule changes in lib/progress.ts or lib/progress-query.ts and
 * not here, this fails.
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
  // Read, then read again from a page-0 anchor on the same day.
  { id: "sq-d", status: "PLAYING" as const, dateStarted: at("2026-03-02T21:00:00Z") },
  // No anchor: the current pass starts at the start date.
  { id: "sq-f", status: "PLAYING" as const, dateStarted: at("2026-04-10T00:00:00Z") },
  // Stopped.
  { id: "sq-e", status: "DROPPED" as const, dateStarted: null },
];

const entries: { gameId: string; page: number; date: Date }[] = [
  { gameId: "sq-a", page: 0, date: at("2026-03-01T09:00:00Z") },
  { gameId: "sq-a", page: 40, date: at("2026-03-01T23:30:00Z") },
  { gameId: "sq-a", page: 90, date: at("2026-03-02T03:30:00Z") },
  { gameId: "sq-a", page: 150, date: at("2026-03-03T12:00:00Z") },

  { gameId: "sq-b", page: 0, date: at("2026-03-02T10:00:00Z") },
  { gameId: "sq-b", page: 25, date: at("2026-03-02T21:00:00Z") },
  { gameId: "sq-b", page: 10, date: at("2026-03-04T12:00:00Z") },
  { gameId: "sq-b", page: 60, date: at("2026-03-05T12:00:00Z") },

  { gameId: "sq-c", page: 300, date: at("2026-03-06T12:00:00Z") },

  { gameId: "sq-d", page: 0, date: at("2026-03-01T09:00:00Z") },
  { gameId: "sq-d", page: 100, date: at("2026-03-01T20:00:00Z") },
  { gameId: "sq-d", page: 300, date: at("2026-03-02T12:00:00Z") },
  { gameId: "sq-d", page: 0, date: at("2026-03-02T21:00:00Z") },
  { gameId: "sq-d", page: 40, date: at("2026-03-02T22:00:00Z") },
  { gameId: "sq-d", page: 90, date: at("2026-03-03T12:00:00Z") },

  { gameId: "sq-f", page: 10, date: at("2026-04-01T12:00:00Z") },
  { gameId: "sq-f", page: 50, date: at("2026-04-02T12:00:00Z") },
  // The morning of 10 April in Tokyo, still 9 April in UTC.
  { gameId: "sq-f", page: 65, date: at("2026-04-09T20:00:00Z") },
  { gameId: "sq-f", page: 80, date: at("2026-04-11T12:00:00Z") },

  { gameId: "sq-e", page: 0, date: at("2026-05-01T12:00:00Z") },
  { gameId: "sq-e", page: 120, date: at("2026-05-03T12:00:00Z") },
  { gameId: "sq-e", page: 218, date: at("2026-05-09T18:00:00Z") },
];

beforeAll(async () => {
  await prisma.user.deleteMany({ where: { id: { in: [USER, OTHER] } } });
  await prisma.user.create({
    data: { id: USER, username: `statsq-${Date.now()}`, passwordHash: "x" },
  });
  await prisma.user.create({
    data: { id: OTHER, username: `statsq-other-${Date.now()}`, passwordHash: "x" },
  });
  for (const b of games) {
    await prisma.game.create({
      data: { ...b, userId: USER, title: b.id, searchText: b.id },
    });
  }
  await prisma.progressEntry.createMany({ data: entries });
  await prisma.playthrough.create({ data: { gameId: "sq-a", dateFinished: at("2025-05-01T00:00:00Z") } });

  // Someone else's reading, which must never show up.
  await prisma.game.create({
    data: { id: "sq-other", userId: OTHER, title: "theirs", searchText: "theirs", status: "DROPPED" },
  });
  await prisma.progressEntry.createMany({
    data: [
      { gameId: "sq-other", page: 0, date: at("2026-03-02T09:00:00Z") },
      { gameId: "sq-other", page: 500, date: at("2026-03-02T20:00:00Z") },
    ],
  });
  await prisma.playthrough.create({ data: { gameId: "sq-other", dateFinished: at("2025-01-01T00:00:00Z") } });
});

afterAll(async () => {
  await prisma.user.deleteMany({ where: { id: { in: [USER, OTHER] } } });
  await prisma.$disconnect();
});

describe("gameDayPageTotalsForUser", () => {
  it("matches dailyPageTotals game by game, in every zone", async () => {
    for (const zone of ZONES) {
      const rows = await gameDayPageTotalsForUser(USER, zone);
      for (const { id } of games) {
        const fromSql = new Map<string, number>();
        for (const r of rows.filter((r) => r.gameId === id)) {
          fromSql.set(r.day, (fromSql.get(r.day) ?? 0) + r.pages);
        }
        const fromJs = dailyPageTotals(
          entries.filter((e) => e.gameId === id),
          zone,
        );
        expect(Object.fromEntries([...fromSql].sort()), `${id} ${zone}`).toEqual(
          Object.fromEntries([...fromJs].sort()),
        );
      }
    }
  });

  it("sums per day to the reading calendar's totals", async () => {
    for (const zone of ZONES) {
      const rows = await gameDayPageTotalsForUser(USER, zone);
      const summed = new Map<string, number>();
      for (const r of rows) summed.set(r.day, (summed.get(r.day) ?? 0) + r.pages);
      const calendar = await dailyPageTotalsForUser(USER, zone);
      expect(Object.fromEntries([...summed].sort()), zone).toEqual(
        Object.fromEntries([...calendar].sort()),
      );
    }
  });

  it("marks which pages belong to the current pass", async () => {
    const rows = await gameDayPageTotalsForUser(USER, "UTC");
    const of = (id: string, from = rows) =>
      from
        .filter((r) => r.gameId === id)
        .map(({ day, pages, current }) => ({ day, pages, current }))
        .sort((a, b) => a.day.localeCompare(b.day) || Number(a.current) - Number(b.current));

    // The re-read's anchor splits 2 March between the two passes.
    expect(of("sq-d")).toEqual([
      { day: "2026-03-01", pages: 100, current: false },
      { day: "2026-03-02", pages: 200, current: false },
      { day: "2026-03-02", pages: 40, current: true },
      { day: "2026-03-03", pages: 50, current: true },
    ]);
    // No anchor: the start date decides, by calendar day in the reader's
    // zone.
    expect(of("sq-f")).toEqual([
      { day: "2026-04-02", pages: 40, current: false },
      { day: "2026-04-09", pages: 15, current: false },
      { day: "2026-04-11", pages: 15, current: true },
    ]);
    expect(of("sq-f", await gameDayPageTotalsForUser(USER, "Asia/Tokyo"))).toEqual([
      { day: "2026-04-02", pages: 40, current: false },
      { day: "2026-04-10", pages: 15, current: true },
      { day: "2026-04-11", pages: 15, current: true },
    ]);
    // Neither: everything is the current pass.
    expect(of("sq-b").every((r) => r.current)).toBe(true);
  });

  it("only returns the reader's own games", async () => {
    const rows = await gameDayPageTotalsForUser(USER, "UTC");
    expect(rows.some((r) => r.gameId === "sq-other")).toBe(false);
  });
});

describe("loadStatsInputs", () => {
  it("loads only the reader's games and reads", async () => {
    const inputs = await loadStatsInputs(USER, "UTC");
    expect(inputs.games.map((b) => b.id).sort()).toEqual(games.map((b) => b.id).sort());
    expect(inputs.playthroughs).toEqual([
      { gameId: "sq-a", dateStarted: null, dateFinished: at("2025-05-01T00:00:00Z"), rating: null },
    ]);
    expect(inputs.logDays.some((r) => r.gameId === "sq-other")).toBe(false);
  });

  it("dates stopped games by their latest log entry, and only those", async () => {
    const inputs = await loadStatsInputs(USER, "UTC");
    expect([...inputs.lastLogDates]).toEqual([["sq-e", at("2026-05-09T18:00:00Z")]]);
  });
});
