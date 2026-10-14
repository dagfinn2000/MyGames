import { describe, expect, it } from "vitest";
import type { GoalUnit } from "@prisma/client";
import { formatNumber } from "@/lib/display";
import {
  describePace,
  doneWords,
  goalAmount,
  goalPace,
  goalProgress,
  goalTarget,
  markReplays,
  splitGoals,
  targetWords,
  yearClock,
} from "@/lib/goals";

const finish = (gameId: string, date: string) => ({ gameId, dateFinished: new Date(date) });

describe("markReplays", () => {
  it("marks later completions of the same game", () => {
    const marked = markReplays(
      [finish("a", "2026-03-01"), finish("a", "2025-06-01"), finish("b", "2026-01-01")],
      new Set(),
    );
    expect(marked.map((f) => f.isReplay)).toEqual([true, false, false]);
  });

  it("counts an undated earlier playthrough as coming first", () => {
    const marked = markReplays([finish("a", "2026-03-01")], new Set(["a"]));
    expect(marked[0].isReplay).toBe(true);
  });
});

describe("goalProgress", () => {
  // What countWindow gives for a year: a first playthrough of 40 h, a 20 h
  // replay, a game completed with no time given, and an hour and a half
  // logged in a game still being played.
  const year = [
    { isReplay: false, games: 1, minutes: 2400 },
    { isReplay: true, games: 1, minutes: 1200 },
    { isReplay: false, games: 1, minutes: 0 },
    { isReplay: false, games: 0, minutes: 90 },
  ];

  it("counts games, replays included by default", () => {
    expect(goalProgress(year, { unit: "GAMES", countReplays: true })).toBe(3);
    expect(goalProgress(year, { unit: "GAMES", countReplays: false })).toBe(2);
  });

  it("adds up minutes for an hours goal, skipping the replay when replays are left out", () => {
    expect(goalProgress(year, { unit: "HOURS", countReplays: true })).toBe(3690);
    expect(goalProgress(year, { unit: "HOURS", countReplays: false })).toBe(2490);
  });
});

describe("goal units in words", () => {
  it("counts an hours goal's target in minutes, like its progress", () => {
    expect(goalTarget({ target: 300, unit: "HOURS" })).toBe(18_000);
    expect(goalTarget({ target: 12, unit: "GAMES" })).toBe(12);
  });

  it("says a target as it was typed", () => {
    expect(targetWords(12, "GAMES")).toBe("12 games");
    expect(targetWords(1, "GAMES")).toBe("1 game");
    expect(targetWords(300, "HOURS")).toBe("300 hours");
    expect(targetWords(1, "HOURS")).toBe("1 hour");
    expect(targetWords(1500, "HOURS")).toBe("1,500 hours");
  });

  it("says an amount of time exactly while it's short, in hours after", () => {
    expect(goalAmount(3, "GAMES")).toBe("3 games");
    expect(goalAmount(45, "HOURS")).toBe("45 min");
    expect(goalAmount(200, "HOURS")).toBe("3 h 20 min");
    expect(goalAmount(18_740, "HOURS")).toBe("312 hours");
  });

  it("rounds the headline hours down, so a goal never looks reached too soon", () => {
    expect(doneWords(9, "GAMES")).toBe("9");
    expect(doneWords(200, "HOURS")).toBe("3 h 20 min");
    expect(doneWords(8_570, "HOURS")).toBe("142");
    expect(doneWords(17_999, "HOURS")).toBe("299");
    expect(doneWords(72_000, "HOURS")).toBe("1,200");
    const spaced = { numberFormat: "space" } as const;
    expect(doneWords(72_000, "HOURS", spaced)).toBe(formatNumber(1200, spaced));
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
  const pace = (done: number, target: number, unit: GoalUnit, clock = oct12) =>
    goalPace(done, { target, unit }, clock);
  const say = (done: number, target: number, unit: GoalUnit, clock = oct12) =>
    describePace(pace(done, target, unit, clock), unit, undefined, "1 Jan 2027");

  it("is on schedule within half a game of an even pace", () => {
    // 24 × 285/365 = 18.7 expected by 12 October.
    expect(pace(19, 24, "GAMES")).toEqual({ kind: "on-schedule" });
    expect(say(19, 24, "GAMES")).toBe("Right on schedule.");
    // Everyone is on schedule on 1 January.
    expect(say(0, 24, "GAMES", yearClock("2026-01-01", 2026))).toBe("Right on schedule.");
  });

  it("rounds how far ahead", () => {
    expect(pace(21, 24, "GAMES")).toEqual({ kind: "ahead", by: 2 });
    expect(say(21, 24, "GAMES")).toBe("2 games ahead of schedule.");
    expect(say(20, 24, "GAMES")).toBe("1 game ahead of schedule.");
  });

  it("says how often a game gets a player back on track", () => {
    // 8 to go in 81 days: one every 10 days.
    expect(pace(16, 24, "GAMES")).toEqual({ kind: "behind", by: 3, everyDays: 10 });
    expect(say(16, 24, "GAMES")).toBe("3 games behind. About 1 game every 10 days gets you there.");
  });

  it("never says 'every 1 days'", () => {
    // 50 to go in 81 days.
    expect(say(50, 100, "GAMES")).toBe("28 games behind. About 1 game a day gets you there.");
  });

  it("asks for several games a day when there are more games than days left", () => {
    const dec31 = yearClock("2026-12-31", 2026);
    expect(pace(20, 24, "GAMES", dec31)).toEqual({ kind: "behind", by: 4, perDay: 4 });
    expect(say(20, 24, "GAMES", dec31)).toBe("4 games behind. About 4 games a day gets you there.");
  });

  it("counts an hours goal in minutes, on schedule within half a percent", () => {
    // 300 h = 18,000 min; 18,000 × 285/365 = 14,054.8 expected by 12
    // October, give or take 90 minutes.
    expect(pace(14_000, 300, "HOURS")).toEqual({ kind: "on-schedule" });
    expect(say(14_100, 300, "HOURS")).toBe("Right on schedule.");
    expect(pace(15_000, 300, "HOURS")).toEqual({ kind: "ahead", by: 945 });
    expect(say(15_000, 300, "HOURS")).toBe("16 hours ahead of schedule.");
    // A small goal still allows half an hour either way: 10 h × 285/365
    // is 468 minutes.
    expect(say(450, 10, "HOURS")).toBe("Right on schedule.");
    expect(say(510, 10, "HOURS")).toBe("42 min ahead of schedule.");
  });

  it("puts catching up on an hours goal as time a day, rounded up to 5 minutes", () => {
    // 9,000 minutes to go in 81 days: 111 a day, so about 1 h 55 min.
    expect(pace(9_000, 300, "HOURS")).toEqual({ kind: "behind", by: 5055, perDay: 115 });
    expect(say(9_000, 300, "HOURS")).toBe(
      "84 hours behind. About 1 h 55 min a day gets you there.",
    );
    // The last day of the year asks for all of it.
    const dec31 = yearClock("2026-12-31", 2026);
    expect(say(5_700, 100, "HOURS", dec31)).toBe("5 h behind. About 5 h a day gets you there.");
  });

  it("puts a little a day as time a week instead", () => {
    // 6,000 minutes in 334 days is 18 a day; a week is about 2 h 10 min.
    const feb1 = yearClock("2026-02-01", 2026);
    expect(pace(0, 100, "HOURS", feb1)).toEqual({ kind: "behind", by: 526, perWeek: 130 });
    expect(say(0, 100, "HOURS", feb1)).toBe(
      "8 h 46 min behind. About 2 h 10 min a week gets you there.",
    );
    // Under a week left: a day it is, however little.
    const dec26 = yearClock("2026-12-26", 2026);
    expect(pace(5_885, 100, "HOURS", dec26)).toEqual({ kind: "behind", by: 33, perDay: 20 });
  });

  it("celebrates a reached goal, with any overshoot", () => {
    expect(say(26, 24, "GAMES")).toBe("Goal reached. 2 games more than you planned.");
    expect(say(24, 24, "GAMES")).toBe("Goal reached.");
    expect(say(18_000, 300, "HOURS")).toBe("Goal reached.");
    expect(say(18_045, 300, "HOURS")).toBe("Goal reached. 45 min more than you planned.");
    // 299 h 59 min is not 300 hours.
    expect(pace(17_999, 300, "HOURS").kind).not.toBe("reached");
  });

  it("closes a past year and waits for a future one", () => {
    const past = yearClock("2026-10-12", 2025);
    expect(pace(17, 20, "GAMES", past)).toEqual({ kind: "missed", short: 3 });
    expect(say(17, 20, "GAMES", past)).toBe("Ended 3 games short.");
    expect(say(17_400, 300, "HOURS", past)).toBe("Ended 10 hours short.");
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
