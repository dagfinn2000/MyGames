import type { ProgressEntry } from "@prisma/client";
import { calendarDay, dayKey, shiftDayKey } from "@/lib/dates";

export { dayKey };

type LogPoint = Pick<ProgressEntry, "gameId" | "minutes" | "date">;

/**
 * The slice of a game's log belonging to the current playthrough:
 * everything from the latest 0-minute anchor onward. 0-minute entries only
 * ever come from playthrough anchors — the play form treats no time as
 * "cleared" and never logs it — so the latest one marks the pass start
 * exactly, even when playing again begins on a day that already has
 * entries (the started-date form field only keeps day precision). Logs
 * without an anchor (games added part-way through) fall back to the
 * started-date window, by calendar day in the player's zone: a typed
 * Started date is midnight UTC, which east of UTC is still ahead of that
 * morning's entries. lib/stats-query.ts applies the same rule in SQL.
 */
export function currentPassEntries<T extends Pick<ProgressEntry, "minutes" | "date">>(
  entries: T[], // sorted by date ascending
  dateStarted: Date | null,
  /** The player's zone; default the server's. */
  timeZone?: string,
): T[] {
  for (let i = entries.length - 1; i >= 0; i--) {
    if (entries[i].minutes === 0) return entries.slice(i);
  }
  if (!dateStarted) return entries;
  const startDay = calendarDay(dateStarted, timeZone);
  return entries.filter(
    (e) => e.date.getTime() >= dateStarted.getTime() || dayKey(e.date, timeZone) >= startDay,
  );
}

/**
 * Minutes played per calendar day, summed across games. Each game's log is
 * walked in date order and every *increase* between consecutive entries is
 * credited to the later entry's day. A first entry has no predecessor and
 * credits nothing — that's what keeps the time a game was added with and
 * the playthrough-start anchors inert — and decreases (corrections, a new
 * playthrough's reset) credit nothing but move the baseline.
 */
export function dailyMinuteTotals(
  entries: LogPoint[],
  /** The player's zone; default the server's. */
  timeZone?: string,
): Map<string, number> {
  const byGame = new Map<string, LogPoint[]>();
  for (const e of entries) {
    const log = byGame.get(e.gameId);
    if (log) log.push(e);
    else byGame.set(e.gameId, [e]);
  }

  const totals = new Map<string, number>();
  for (const log of byGame.values()) {
    log.sort((a, b) => a.date.getTime() - b.date.getTime() || a.minutes - b.minutes);
    for (let i = 1; i < log.length; i++) {
      const delta = log[i].minutes - log[i - 1].minutes;
      if (delta <= 0) continue;
      const key = dayKey(log[i].date, timeZone);
      totals.set(key, (totals.get(key) ?? 0) + delta);
    }
  }
  return totals;
}

/**
 * Current streak and longest-ever run of consecutive play days. Today
 * counts toward the current streak when logged, but an unlogged today
 * doesn't break yesterday's streak — the day isn't over yet.
 */
export function playStreaks(
  days: ReadonlySet<string>,
  today: Date = new Date(),
  /** The player's zone, which decides what "today" is; default the server's. */
  timeZone?: string,
): { current: number; longest: number } {
  let longest = 0;
  let run = 0;
  let prev: string | null = null;
  for (const key of [...days].sort()) {
    run = prev !== null && key === shiftDayKey(prev, 1) ? run + 1 : 1;
    if (run > longest) longest = run;
    prev = key;
  }

  let cursor = dayKey(today, timeZone);
  if (!days.has(cursor)) cursor = shiftDayKey(cursor, -1);
  let current = 0;
  while (days.has(cursor)) {
    current++;
    cursor = shiftDayKey(cursor, -1);
  }
  return { current, longest };
}
