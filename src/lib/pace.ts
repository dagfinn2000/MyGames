import { PlayStatus } from "@prisma/client";
import { calendarDay, dayKey, keyToUtcDate, shiftDayKey } from "@/lib/dates";
import { formatDate, type FormatPrefs } from "@/lib/display";
import type { PaceFrom } from "@/lib/preferences";
import { formatPlaytime } from "@/lib/progress-units";

/**
 * Play pace and the forecast, from a game's current playthrough (its
 * 0-minute anchor first, then every logged time, sorted by date).
 *
 * "The whole playthrough" divides the time the pass gained by how long it
 * has run, as the playing card always did. "The last 7 (or 14) days"
 * counts only the time played in those days, in the player's zone, so a
 * two-week break stops dragging the forecast out once it has passed. A
 * playthrough younger than the window is divided by its own age.
 *
 * The forecast only ever counts down to a known time to beat, and only
 * while the game is short of it: past the usual time there is nothing to
 * forecast, and the game is finished when the player says so.
 */

export const DAY_MS = 86_400_000;

const WINDOW_DAYS = { "7d": 7, "14d": 14 } as const;

type Point = { minutes: number; date: Date };

function daysBetween(fromKey: string, toKey: string): number {
  return Math.round((keyToUtcDate(toKey).getTime() - keyToUtcDate(fromKey).getTime()) / DAY_MS);
}

/** Days the pass has run, first entry to last, floored to one. */
function spanDays(pass: Point[]): number {
  const span = pass[pass.length - 1].date.getTime() - pass[0].date.getTime();
  return Math.max(span / DAY_MS, 1);
}

/**
 * Minutes played a day. Null with fewer than two entries, or for the whole
 * playthrough when nothing was gained. A window can be 0: nothing played
 * in it.
 */
export function minutesPerDay(
  pass: Point[],
  from: PaceFrom,
  now: Date,
  timeZone?: string,
): number | null {
  if (pass.length < 2) return null;
  if (from === "playthrough") {
    const gained = pass[pass.length - 1].minutes - pass[0].minutes;
    return gained > 0 ? gained / spanDays(pass) : null;
  }

  const n = WINDOW_DAYS[from];
  const today = dayKey(now, timeZone);
  const start = shiftDayKey(today, -(n - 1));
  // Same crediting as the play calendar (lib/progress.ts): each increase
  // counts on the later entry's day, decreases count nothing.
  let gained = 0;
  for (let i = 1; i < pass.length; i++) {
    const delta = pass[i].minutes - pass[i - 1].minutes;
    if (delta > 0 && dayKey(pass[i].date, timeZone) >= start) gained += delta;
  }
  const firstDay = calendarDay(pass[0].date, timeZone);
  const days = firstDay > start ? Math.max(daysBetween(firstDay, today) + 1, 1) : n;
  return gained / days;
}

export interface Forecast {
  /** Whole days still to go. */
  daysLeft: number;
  /** When the time played reaches the time to beat. */
  reach: Date;
  /** More than a year out: say so rather than give a date. */
  overAYear: boolean;
}

/**
 * When the time played reaches the usual time to beat at this pace. The
 * whole-playthrough pace counts from the last entry; a recent-days pace
 * from now, since it already knows about the days since. Null without a
 * time to beat, a pace, or time left to it.
 */
export function forecast(
  playedMinutes: number,
  lengthMinutes: number | null,
  pace: number | null,
  from: PaceFrom,
  lastDate: Date,
  now: Date,
): Forecast | null {
  if (!lengthMinutes || pace == null || pace <= 0) return null;
  const remaining = lengthMinutes - playedMinutes;
  if (remaining <= 0) return null;
  const days = remaining / pace;
  const base = from === "playthrough" ? lastDate : now;
  return {
    daysLeft: Math.ceil(days),
    reach: new Date(base.getTime() + days * DAY_MS),
    overAYear: days > 366,
  };
}

/**
 * A pace in words: "about 1 h 20 min a day". Under a quarter of an hour a
 * day reads better by the week ("about 1 h 10 min a week" rather than
 * "about 10 min a day"), and never as nothing at all.
 */
export function paceAmount(minutesADay: number): string {
  if (minutesADay >= 15) return `about ${formatPlaytime(minutesADay)} a day`;
  return `about ${formatPlaytime(Math.max(minutesADay * 7, 1))} a week`;
}

function windowSuffix(from: PaceFrom): string {
  return from === "playthrough" ? "" : `, last ${WINDOW_DAYS[from]} days`;
}

function nothingPlayed(from: Exclude<PaceFrom, "playthrough">): string {
  return `Not played in the last ${WINDOW_DAYS[from]} days`;
}

interface PaceInput {
  pass: Point[];
  /** The game's time to beat, if known: the forecast's finish line. */
  lengthMinutes: number | null;
  from: PaceFrom;
  now: Date;
  prefs: FormatPrefs;
}

/**
 * The line under the playing card's sparkline. While playing: the pace,
 * and when it reaches the usual time to beat. Once completed: the pace
 * over the whole playthrough, whatever the setting, since a finished
 * playthrough has no "recent days".
 */
export function chartPaceText({
  status,
  pass,
  lengthMinutes,
  from,
  now,
  prefs,
}: PaceInput & { status: PlayStatus }): string | null {
  if (status === PlayStatus.COMPLETED) {
    const pace = minutesPerDay(pass, "playthrough", now, prefs.timeZone);
    if (!pace) return null;
    const days = Math.max(Math.round(spanDays(pass)), 1);
    return `${paceAmount(pace)} over ${days} ${days === 1 ? "day" : "days"}`;
  }
  if (status !== PlayStatus.PLAYING) return null;

  const pace = minutesPerDay(pass, from, now, prefs.timeZone);
  if (pace === null) return null;
  if (pace === 0 && from !== "playthrough") return nothingPlayed(from);
  const last = pass[pass.length - 1];
  const f = forecast(last.minutes, lengthMinutes, pace, from, last.date, now);
  let text = `${paceAmount(pace)}${windowSuffix(from)}`;
  if (f && lengthMinutes) {
    const usual = formatPlaytime(lengthMinutes);
    text += f.overAYear
      ? ` · more than a year to the usual ${usual} at this pace`
      : ` · at this pace you'll reach the usual ${usual} around ${formatDate(f.reach, prefs)}`;
  }
  return text;
}

/** The pace line on a Now playing row: "about 1 h 20 min a day, last 7
 *  days · 11 days to the usual 40 h". */
export function nowPlayingPaceText({ pass, lengthMinutes, from, now, prefs }: PaceInput): string {
  const pace = minutesPerDay(pass, from, now, prefs.timeZone);
  if (pace === null) return "No pace yet. Log a session or two.";
  if (pace === 0 && from !== "playthrough") return nothingPlayed(from);
  const last = pass[pass.length - 1];
  const f = forecast(last.minutes, lengthMinutes, pace, from, last.date, now);
  let text = `${paceAmount(pace)}${windowSuffix(from)}`;
  if (f && lengthMinutes) {
    const usual = formatPlaytime(lengthMinutes);
    text += f.overAYear
      ? ` · over a year to the usual ${usual}`
      : ` · ${f.daysLeft} ${f.daysLeft === 1 ? "day" : "days"} to the usual ${usual}`;
  }
  return text;
}
