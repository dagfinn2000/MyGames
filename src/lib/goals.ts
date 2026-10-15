import type { GoalUnit } from "@prisma/client";
import { keyToUtcDate } from "@/lib/dates";
import { formatNumber, type FormatPrefs } from "@/lib/display";
import { formatHoursPlayed, formatPlaytime } from "@/lib/progress-units";

/**
 * Completed playthroughs and what they count toward, and how a goal is
 * going. Shared by the stats page and the year in review, so a goal shows
 * the same progress on both. What each pass adds (games, minutes) comes
 * from lib/stats-count.ts, which applies the "What counts" preferences.
 *
 * A goal's target is stored as the player typed it, games or whole hours,
 * but an hours goal's progress is counted in minutes so that the odd
 * half-hour session still moves the bar: compare it with goalTarget, never
 * with `target` itself.
 */

/** One completed pass through a game: the current one on a Completed game,
 *  or an archived replay or playthrough from before the app. */
export interface Finish {
  gameId: string;
  dateFinished: Date;
  /** True when the game had been completed before this pass. */
  isReplay: boolean;
}

/**
 * Marks which finishes are replays. A finish is a replay when the same
 * game has an earlier dated finish, or any undated past playthrough —
 * "played it before" placeholders are presumed to come first.
 */
export function markReplays<T extends { gameId: string; dateFinished: Date }>(
  finishes: T[],
  undatedCompletedGameIds: ReadonlySet<string>,
): (T & { isReplay: boolean })[] {
  const byGame = new Map<string, Date[]>();
  for (const f of finishes) {
    const list = byGame.get(f.gameId) ?? [];
    list.push(f.dateFinished);
    byGame.set(f.gameId, list);
  }
  return finishes.map((f) => ({
    ...f,
    isReplay:
      undatedCompletedGameIds.has(f.gameId) ||
      (byGame.get(f.gameId) ?? []).some((d) => d < f.dateFinished),
  }));
}

export interface GoalRule {
  unit: GoalUnit;
  countReplays: boolean;
}

/** The finishes that count toward a goal — all of them, or first
 *  playthroughs only when replays are left out. */
export function countedFinishes<T extends Pick<Finish, "isReplay">>(
  finishes: T[],
  rule: Pick<GoalRule, "countReplays">,
): T[] {
  return rule.countReplays ? finishes : finishes.filter((f) => !f.isReplay);
}

/** Progress toward a goal from what the year's passes add (countWindow in
 *  lib/stats-count.ts): their games, or for an hours goal their minutes. */
export function goalProgress(
  yearItems: { isReplay: boolean; games: number; minutes: number }[],
  rule: GoalRule,
): number {
  return countedFinishes(yearItems, rule).reduce(
    (sum, i) => sum + (rule.unit === "HOURS" ? i.minutes : i.games),
    0,
  );
}

/** A goal's target in the unit its progress counts: games, or minutes for
 *  an hours goal (target × 60). */
export function goalTarget(goal: { target: number; unit: GoalUnit }): number {
  return goal.unit === "HOURS" ? goal.target * 60 : goal.target;
}

/** "game" or "games", "hour" or "hours": the words for a target. */
export function unitWord(unit: GoalUnit, n: number): string {
  if (unit === "HOURS") return n === 1 ? "hour" : "hours";
  return n === 1 ? "game" : "games";
}

/** A target as typed: "12 games", "300 hours", "1 hour". */
export function targetWords(target: number, unit: GoalUnit, prefs?: FormatPrefs): string {
  return `${formatNumber(target, prefs)} ${unitWord(unit, target)}`;
}

/**
 * An amount of progress in words, in the goal's counting unit: "3 games",
 * "1 game"; for an hours goal (minutes) "45 min", "3 h 20 min" while short
 * and "312 hours" after.
 */
export function goalAmount(n: number, unit: GoalUnit, prefs?: FormatPrefs): string {
  if (unit === "HOURS") return formatHoursPlayed(n, prefs);
  return `${formatNumber(n, prefs)} ${unitWord(unit, n)}`;
}

/**
 * Progress as the goal's headline number shows it, ahead of "of 12 games"
 * or "of 300 hours": the games ("9"), or the time played, exact while it's
 * short ("3 h 20 min of 300 hours") and in whole hours after ("142 of 300
 * hours"). Hours are rounded down, so a goal never reads as reached before
 * it is.
 */
export function doneWords(done: number, unit: GoalUnit, prefs?: FormatPrefs): string {
  if (unit === "GAMES") return formatNumber(done, prefs);
  if (done < 10 * 60) return formatPlaytime(done);
  return formatNumber(Math.floor(done / 60), prefs);
}

/** The same with its unit, for progress shown on its own ("played 142
 *  hours", "completed 9 games"): still rounded down. */
export function doneAmount(done: number, unit: GoalUnit, prefs?: FormatPrefs): string {
  if (unit === "HOURS" && done < 10 * 60) return formatPlaytime(done);
  const n = unit === "HOURS" ? Math.floor(done / 60) : done;
  return `${doneWords(done, unit, prefs)} ${unitWord(unit, n)}`;
}

/** How far through a goal's year today is. Today counts as gone and as
 *  left: 12 Oct 2026 is day 285 of 365, with 81 days to go. */
export interface YearClock {
  when: "past" | "current" | "future";
  elapsed: number;
  total: number;
  daysLeft: number;
  /** elapsed / total: where the "today" tick sits on the goal bar. */
  fraction: number;
}

export function yearClock(todayKey: string, year: number): YearClock {
  const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  const total = leap ? 366 : 365;
  const thisYear = Number(todayKey.slice(0, 4));
  if (year < thisYear) return { when: "past", elapsed: total, total, daysLeft: 0, fraction: 1 };
  if (year > thisYear) return { when: "future", elapsed: 0, total, daysLeft: total, fraction: 0 };
  const elapsed =
    Math.round((keyToUtcDate(todayKey).getTime() - Date.UTC(year, 0, 1)) / 86_400_000) + 1;
  return {
    when: "current",
    elapsed,
    total,
    daysLeft: total - elapsed + 1,
    fraction: elapsed / total,
  };
}

export type GoalPace =
  | { kind: "reached"; over: number }
  | { kind: "upcoming" }
  | { kind: "missed"; short: number }
  | { kind: "on-schedule" }
  | { kind: "ahead"; by: number }
  /** Behind, and what catching up takes: a game every few days, so many
   *  games a day, or so much time a day or a week. */
  | { kind: "behind"; by: number; everyDays?: number; perDay?: number; perWeek?: number };

/** Minutes rounded up to a whole 5, at least 5: "about 1 h 55 min a day"
 *  reads better than 1 h 51 min, and rounding up still gets you there. */
function roundUpToFive(minutes: number): number {
  return Math.max(5, Math.ceil(minutes / 5) * 5);
}

/**
 * Where a goal stands against the calendar, in the goal's counting unit
 * (games, or minutes for an hours goal). "On schedule" is within half a
 * game, or within half a percent of an hours goal (at least half an hour),
 * of an even pace through the year.
 *
 * Catching up on an hours goal is put as time a day, or as time a week
 * when a day's share would be under 20 minutes: "1 h 20 min a week" is a
 * plan, "12 min a day" isn't much of a session.
 */
export function goalPace(
  done: number,
  goal: { target: number; unit: GoalUnit },
  clock: YearClock,
): GoalPace {
  const target = goalTarget(goal);
  if (clock.when === "future") return { kind: "upcoming" };
  if (done >= target) return { kind: "reached", over: done - target };
  if (clock.when === "past") return { kind: "missed", short: target - done };

  const diff = done - target * clock.fraction;
  const tolerance = goal.unit === "HOURS" ? Math.max(30, target / 200) : 0.5;
  if (Math.abs(diff) < tolerance) return { kind: "on-schedule" };
  const by = Math.round(Math.abs(diff));
  if (diff > 0) return { kind: "ahead", by };

  const remaining = target - done;
  if (goal.unit === "HOURS") {
    const perDay = remaining / clock.daysLeft;
    return perDay < 20 && clock.daysLeft >= 7
      ? { kind: "behind", by, perWeek: roundUpToFive(perDay * 7) }
      : { kind: "behind", by, perDay: roundUpToFive(perDay) };
  }
  if (remaining <= clock.daysLeft) {
    return { kind: "behind", by, everyDays: Math.floor(clock.daysLeft / remaining) };
  }
  return { kind: "behind", by, perDay: Math.ceil(remaining / clock.daysLeft) };
}

/** The pace as a sentence: "3 games behind. About 1 game every 10 days
 *  gets you there.", "12 hours behind. About 1 h 20 min a day gets you
 *  there." `startsOn` is 1 January of the goal's year, formatted. */
export function describePace(
  pace: GoalPace,
  unit: GoalUnit,
  prefs?: FormatPrefs,
  startsOn = "1 January",
): string {
  const amount = (n: number) => goalAmount(n, unit, prefs);
  switch (pace.kind) {
    case "reached":
      return pace.over > 0
        ? `Goal reached. ${amount(pace.over)} more than you planned.`
        : "Goal reached.";
    case "upcoming":
      return `Starts counting on ${startsOn}.`;
    case "missed":
      return `Ended ${amount(pace.short)} short.`;
    case "on-schedule":
      return "Right on schedule.";
    case "ahead":
      return `${amount(pace.by)} ahead of schedule.`;
    case "behind": {
      const needed =
        pace.perWeek !== undefined
          ? `About ${formatPlaytime(pace.perWeek)} a week`
          : pace.everyDays === undefined
            ? unit === "HOURS"
              ? `About ${formatPlaytime(pace.perDay ?? 0)} a day`
              : `About ${amount(pace.perDay ?? 0)} a day`
            : pace.everyDays === 1
              ? "About 1 game a day"
              : `About 1 game every ${formatNumber(pace.everyDays, prefs)} days`;
      return `${amount(pace.by)} behind. ${needed} gets you there.`;
    }
  }
}

/** This year's goal, the ones set ahead (soonest first) and past ones
 *  (newest first). Next year's goal is never a past one. */
export function splitGoals<G extends { year: number }>(
  goals: G[],
  currentYear: number,
): { current: G | null; upcoming: G[]; past: G[] } {
  return {
    current: goals.find((g) => g.year === currentYear) ?? null,
    upcoming: goals.filter((g) => g.year > currentYear).sort((a, b) => a.year - b.year),
    past: goals.filter((g) => g.year < currentYear).sort((a, b) => b.year - a.year),
  };
}
