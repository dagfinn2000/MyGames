import { z } from "zod";
import { calendarDay, dayKey, endOfZonedDay, keyToUtcDate, shiftDayKey } from "@/lib/dates";
import { formatDayKey, formatShortDay } from "@/lib/display";
import type { DateFormat } from "@/lib/preferences";
import { MAX_PLAYED_MINUTES } from "@/lib/validation";

/**
 * The rules for logging time on any day and fixing a log entry, shared by
 * the progress actions (lib/actions/progress.ts) and the quick-log row.
 * Pure on purpose: client components import it, so nothing here may touch
 * the database.
 *
 * The log's rules, in brief. A playthrough starts at a 0-minute anchor and
 * its times only go up, because stats credit each increase to the day of
 * the later entry (lib/progress.ts). So a new or fixed entry has to fit
 * between its neighbours: not less than the entry before it, not more than
 * the entry after it, and not before the playthrough started. Equal times
 * are fine (they credit nothing). Only the immediate neighbours are
 * checked, which on an increasing log is the same as checking every entry,
 * and still lets older logs that already contain a downward correction take
 * new entries. Nothing caps a time at the game's time to beat: playing on
 * past the usual is normal.
 */

/** A record id from the client. Anything else is "not found", never a
 *  database error. */
export const idSchema = z.string().min(1).max(64);

/** "2026-10-09", and a real date: 2026-02-30 isn't. */
export const dayKeySchema = z
  .string()
  .refine(
    (k) => /^\d{4}-\d{2}-\d{2}$/.test(k) && keyToUtcDate(k).toISOString().slice(0, 10) === k,
    "Pick a day",
  );

export const dayChoiceSchema = z.union([z.literal("today"), z.literal("yesterday"), dayKeySchema]);

/** A logged time, in minutes. 0 is never logged: it is the anchor that
 *  starts a playthrough. */
const minutesField = z.coerce
  .number()
  .int("Log whole minutes")
  .min(1, "Log at least a minute")
  .max(MAX_PLAYED_MINUTES, "That's more than 10,000 hours");

export const logTimeSchema = z.object({
  minutes: minutesField,
  day: dayChoiceSchema.default("today"),
});

export const editEntrySchema = z.object({
  minutes: minutesField,
  day: dayKeySchema,
});

export const moveTargetSchema = z.enum(["COMPLETED", "DROPPED"]);

/**
 * What the client hands back to undo Finished or Stopped. It only names the
 * move; the server works out the rest from the game. `finishedAt` is the
 * finish moment the move wrote, so an undo can't land on a game completed
 * again since. The time played needs no remembering: a move keeps it.
 */
export const undoMoveSchema = z.object({
  from: moveTargetSchema,
  finishedAt: z.string().datetime().nullable(),
});

export type UndoMove = z.infer<typeof undoMoveSchema>;

export type LogTimeResult =
  | { error: string }
  | { ok: true; message: string; minutes: number };

export interface EntryEditResult {
  error?: string;
  message?: string;
}

export type MoveResult =
  | { error: string }
  | { ok: true; finished: boolean; message: string; undo: UndoMove };

export interface LogPoint {
  id: string;
  minutes: number;
  date: Date;
}

/**
 * The day a quick log is for, and the moment its entry gets. Today's entry
 * is stamped now. An earlier day's entry goes at the last moment of that day
 * in the player's zone: "the time played by the end of that day", which
 * also sorts it after anything already logged that day.
 */
export function resolveLogDay(
  choice: string,
  now: Date,
  timeZone: string,
): { key: string; at: Date } | { error: "future" } {
  const today = dayKey(now, timeZone);
  const key = choice === "today" ? today : choice === "yesterday" ? shiftDayKey(today, -1) : choice;
  if (key > today) return { error: "future" };
  return { key, at: key === today ? now : endOfZonedDay(key, timeZone) };
}

/**
 * Where a playthrough's 0-minute anchor goes when the first entry writes
 * it: the Started date, unless the entry is earlier. A typed Started date is
 * midnight UTC, which east of UTC is still in the future on the morning of
 * that day; an anchor after its first entry would cut the entry out of the
 * pass.
 */
export function anchorMoment(dateStarted: Date | null, at: Date): Date {
  return dateStarted && dateStarted.getTime() < at.getTime() ? dateStarted : at;
}

/** The last real time in a playthrough (not its 0-minute anchor), or
 *  null. */
export function lastLogged<T extends { minutes: number }>(pass: T[]): T | null {
  const last = pass[pass.length - 1];
  return last && last.minutes > 0 ? last : null;
}

export type Placement<T> =
  | {
      ok: true;
      before: T | null;
      after: T | null;
      /** The playthrough's anchor, when the entry belongs on its first day
       *  but before the anchor's moment; the anchor moves back to it. */
      moveAnchor: T | null;
    }
  | {
      ok: false;
      reason: "beforeStart" | "below" | "above";
      /** The entry it clashes with (the anchor, for beforeStart). */
      neighbour: T;
      before: T | null;
      after: T | null;
    };

/**
 * Whether a time fits a playthrough at that moment (see the rules at the
 * top). `pass` is sorted by date then minutes, like the log everywhere
 * else, and `skipId` leaves out the entry being edited. A candidate on the
 * playthrough's first day but before its anchor's moment fits, and the
 * anchor moves back to it, unless that would pull it over `previous`, the
 * last entry of the playthrough before.
 */
export function placeInLog<T extends LogPoint>(
  pass: T[],
  candidate: { minutes: number; date: Date },
  opts: { timeZone: string; skipId?: string; previous?: T | null },
): Placement<T> {
  const list = opts.skipId ? pass.filter((e) => e.id !== opts.skipId) : pass;
  const anchor = list[0]?.minutes === 0 ? list[0] : null;
  const at = candidate.date.getTime();

  let moveAnchor: T | null = null;
  if (anchor && at < anchor.date.getTime()) {
    const startDay = calendarDay(anchor.date, opts.timeZone);
    const overPrevious = opts.previous != null && at <= opts.previous.date.getTime();
    if (dayKey(candidate.date, opts.timeZone) < startDay || overPrevious) {
      return { ok: false, reason: "beforeStart", neighbour: anchor, before: null, after: null };
    }
    moveAnchor = anchor;
  }

  // Entries sorting at or before the candidate form a prefix of the list.
  let before: T | null = null;
  let after: T | null = null;
  for (const e of list) {
    const t = e.date.getTime();
    if (e === moveAnchor || t < at || (t === at && e.minutes <= candidate.minutes)) before = e;
    else if (!after) after = e;
  }

  if (before && candidate.minutes < before.minutes) {
    return { ok: false, reason: "below", neighbour: before, before, after };
  }
  if (after && candidate.minutes > after.minutes) {
    return { ok: false, reason: "above", neighbour: after, before, after };
  }
  return { ok: true, before, after, moveAnchor };
}

/**
 * The playthrough an entry belongs to: from the latest 0-minute anchor at
 * or before it up to the next anchor. `previous` is the entry just before
 * the playthrough; `isCurrent` is true for the latest one, the one the
 * game's time played follows.
 */
export function passAround<T extends LogPoint>(
  entries: T[], // sorted by date, then minutes
  entryId: string,
): { pass: T[]; previous: T | null; nextAnchor: T | null; isCurrent: boolean } | null {
  const i = entries.findIndex((e) => e.id === entryId);
  if (i < 0) return null;
  let start = 0;
  for (let j = i; j >= 0; j--) {
    if (entries[j].minutes === 0) {
      start = j;
      break;
    }
  }
  let end = entries.length;
  for (let j = i + 1; j < entries.length; j++) {
    if (entries[j].minutes === 0) {
      end = j;
      break;
    }
  }
  const nextAnchor = entries[end] ?? null;
  return {
    pass: entries.slice(start, end),
    previous: entries[start - 1] ?? null,
    nextAnchor,
    isCurrent: nextAnchor === null,
  };
}

/** A day in a sentence: "today", "yesterday" or "9 Oct 2026". */
export function describeDay(key: string, todayKey: string, format?: DateFormat): string {
  if (key === todayKey) return "today";
  if (key === shiftDayKey(todayKey, -1)) return "yesterday";
  return formatDayKey(key, format);
}

/** The same at the start of a sentence: "Today", "Yesterday", "9 Oct 2026". */
export function subjectDay(key: string, todayKey: string, format?: DateFormat): string {
  const day = describeDay(key, todayKey, format);
  return day.charAt(0).toUpperCase() + day.slice(1);
}

/** "which you logged today", "… yesterday", "… for 9 Oct 2026". */
export function loggedWhen(key: string, todayKey: string, format?: DateFormat): string {
  const day = describeDay(key, todayKey, format);
  return key === todayKey || key === shiftDayKey(todayKey, -1) ? day : `for ${day}`;
}

/**
 * The days the quick-log menu offers by name: Today, Yesterday and the two
 * days before, none before the playthrough started. `more` says whether earlier
 * days are left for "Another day…".
 */
export function recentDays(
  todayKey: string,
  startKey: string | null,
  format?: DateFormat,
): { days: { value: string; label: string }[]; more: boolean } {
  const days: { value: string; label: string }[] = [];
  for (let back = 0; back < 4; back++) {
    const key = shiftDayKey(todayKey, -back);
    if (startKey && key < startKey) return { days, more: false };
    days.push({
      value: back === 0 ? "today" : back === 1 ? "yesterday" : key,
      label: back === 0 ? "Today" : back === 1 ? "Yesterday" : formatShortDay(key, format),
    });
  }
  return { days, more: !startKey || startKey < shiftDayKey(todayKey, -3) };
}
