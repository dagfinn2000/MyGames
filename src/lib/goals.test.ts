import { describe, expect, it } from "vitest";
import { formatNumber } from "@/lib/display";
import {
  describePace,
  goalPace,
  goalProgress,
  markReplays,
  splitGoals,
  yearClock,
} from "@/lib/goals";

const finish = (gameId: string, date: string, pageCount: number | null = 300) => ({
  gameId,
  dateFinished: new Date(date),
  pageCount,
});

describe("markReplays", () => {
  it("marks later finishes of the same game", () => {
    const marked = markReplays(
      [finish("a", "2026-03-01"), finish("a", "2025-06-01"), finish("b", "2026-01-01")],
      new Set(),
    );
    expect(marked.map((f) => f.isReplay)).toEqual([true, false, false]);
  });

  it("counts an undated earlier read as coming first", () => {
    const marked = markReplays([finish("a", "2026-03-01")], new Set(["a"]));
    expect(marked[0].isReplay).toBe(true);
  });
});

describe("goalProgress", () => {
  // What countWindow gives for a year: a first read, a re-read, a game with
  // no page count, and pages logged in a game not finished yet.
  const year = [
    { isReplay: false, games: 1, pages: 300 },
    { isReplay: true, games: 1, pages: 200 },
    { isReplay: false, games: 1, pages: 0 },
    { isReplay: false, games: 0, pages: 120 },
  ];

  it("counts games, re-reads included by default", () => {
    expect(goalProgress(year, { unit: "GAMES", countReplays: true })).toBe(3);
    expect(goalProgress(year, { unit: "GAMES", countReplays: false })).toBe(2);
  });

  it("adds up pages, skipping the re-read when re-reads are left out", () => {
    expect(goalProgress(year, { unit: "PAGES", countReplays: true })).toBe(620);
    expect(goalProgress(year, { unit: "PAGES", countReplays: false })).toBe(420);
  });
});

describe("yearClock", () => {
  it("counts today as gone and as left", () => {
    expect(yearClock("2026-10-12", 2026)).toEqual({
      when: "current",
      elapsed: 285,
      total: 365,
      daysLeft: 81,
      fraction: 285 / 365,
    });
  });

  it("starts on day 1 and ends on the last day of a leap year", () => {
    expect(yearClock("2026-01-01", 2026)).toMatchObject({ elapsed: 1, daysLeft: 365 });
    expect(yearClock("2028-12-31", 2028)).toMatchObject({
      elapsed: 366,
      total: 366,
      daysLeft: 1,
      fraction: 1,
    });
  });

  it("is full for a past year and empty for a future one", () => {
    expect(yearClock("2026-10-12", 2025)).toMatchObject({ when: "past", fraction: 1, daysLeft: 0 });
    expect(yearClock("2026-10-12", 2027)).toMatchObject({
      when: "future",
      fraction: 0,
      daysLeft: 365,
    });
  });
});

describe("goalPace and describePace", () => {
  const oct12 = yearClock("2026-10-12", 2026);
  const fmt = (n: number) => formatNumber(n);
  const say = (done: number, target: number, unit: "GAMES" | "PAGES", clock = oct12) =>
    describePace(goalPace(done, target, unit, clock), unit, fmt, "1 Jan 2027");

  it("is on schedule within half a game of an even pace", () => {
    // 24 × 285/365 = 18.7 expected by 12 October.
    expect(goalPace(19, 24, "GAMES", oct12)).toEqual({ kind: "on-schedule" });
    expect(say(19, 24, "GAMES")).toBe("Right on schedule.");
    // Everyone is on schedule on 1 January.
    expect(say(0, 24, "GAMES", yearClock("2026-01-01", 2026))).toBe("Right on schedule.");
  });

  it("rounds how far ahead", () => {
    expect(goalPace(21, 24, "GAMES", oct12)).toEqual({ kind: "ahead", by: 2 });
    expect(say(21, 24, "GAMES")).toBe("2 games ahead of schedule.");
    expect(say(20, 24, "GAMES")).toBe("1 game ahead of schedule.");
  });

  it("says how often a game gets a reader back on track", () => {
    // 8 to go in 81 days: one every 10 days.
    expect(goalPace(16, 24, "GAMES", oct12)).toEqual({ kind: "behind", by: 3, everyDays: 10 });
    expect(say(16, 24, "GAMES")).toBe("3 games behind. About 1 game every 10 days gets you there.");
  });

  it("never says 'every 1 days'", () => {
    // 50 to go in 81 days.
    expect(say(50, 100, "GAMES")).toBe("28 games behind. About 1 game a day gets you there.");
  });

  it("asks for several games a day when there are more games than days left", () => {
    const dec31 = yearClock("2026-12-31", 2026);
    expect(goalPace(20, 24, "GAMES", dec31)).toEqual({ kind: "behind", by: 4, perDay: 4 });
    expect(say(20, 24, "GAMES", dec31)).toBe("4 games behind. About 4 games a day gets you there.");
  });

  it("puts a pages goal in pages a day, on schedule within half a percent", () => {
    // 8,000 × 285/365 = 6,246.6 expected; 3,000 to go in 81 days.
    expect(say(5000, 8000, "PAGES")).toBe(
      "1,247 pages behind. About 38 pages a day gets you there.",
    );
    expect(say(6220, 8000, "PAGES")).toBe("Right on schedule.");
    expect(say(6300, 8000, "PAGES")).toBe("53 pages ahead of schedule.");
  });

  it("celebrates a reached goal, with any overshoot", () => {
    expect(say(26, 24, "GAMES")).toBe("Goal reached. 2 games more than you planned.");
    expect(say(24, 24, "GAMES")).toBe("Goal reached.");
    expect(say(8001, 8000, "PAGES")).toBe("Goal reached. 1 page more than you planned.");
  });

  it("closes a past year and waits for a future one", () => {
    const past = yearClock("2026-10-12", 2025);
    expect(goalPace(17, 20, "GAMES", past)).toEqual({ kind: "missed", short: 3 });
    expect(say(17, 20, "GAMES", past)).toBe("Ended 3 games short.");
    expect(say(799, 800, "PAGES", past)).toBe("Ended 1 page short.");
    expect(say(22, 20, "GAMES", past)).toBe("Goal reached. 2 games more than you planned.");
    expect(say(0, 26, "GAMES", yearClock("2026-10-12", 2027))).toBe(
      "Starts counting on 1 Jan 2027.",
    );
  });
});

describe("splitGoals", () => {
  it("keeps next year's goal out of the past, newest past first", () => {
    const goals = [{ year: 2024 }, { year: 2027 }, { year: 2026 }, { year: 2025 }];
    expect(splitGoals(goals, 2026)).toEqual({
      current: { year: 2026 },
      upcoming: [{ year: 2027 }],
      past: [{ year: 2025 }, { year: 2024 }],
    });
    expect(splitGoals([{ year: 2025 }], 2026).current).toBeNull();
  });
});
