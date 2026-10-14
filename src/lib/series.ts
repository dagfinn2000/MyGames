import { PlayStatus } from "@prisma/client";

/**
 * Which game of a series comes next. Shared by the library's series
 * headings and Pick for me, so "next #4" and the pick never disagree.
 */

export interface SeriesMember {
  seriesNumber: number | null;
  status: PlayStatus;
  /** Finished passes before the current one (see play-state.ts). */
  timesCompleted: number;
}

/** Series names compared the way the series filter does: case-insensitive,
 *  ignoring stray spaces. */
export function seriesKey(name: string): string {
  return name.normalize("NFC").trim().toLowerCase();
}

/** Completed at least once, or dropped. Either way, not what's next. */
export function isDoneInSeries(b: Pick<SeriesMember, "status" | "timesCompleted">): boolean {
  return b.status === PlayStatus.COMPLETED || b.status === PlayStatus.DROPPED || b.timesCompleted > 0;
}

/**
 * The next game in one series: the lowest-numbered one not done yet, whether
 * it's being played or waiting on Want to Play. A number counts as done when
 * any copy of it is done (#1 on two platforms, one completed). Games without
 * a number are never "next". Null when every numbered game is done.
 */
export function nextInSeries<T extends SeriesMember>(games: T[]): T | null {
  const done = new Set(
    games.filter((b) => b.seriesNumber !== null && isDoneInSeries(b)).map((b) => b.seriesNumber),
  );
  let next: T | null = null;
  for (const b of games) {
    if (b.seriesNumber === null || done.has(b.seriesNumber) || isDoneInSeries(b)) continue;
    if (next === null || b.seriesNumber < next.seriesNumber!) next = b;
  }
  return next;
}

/**
 * Whether `game` may be picked when only the next game in a series counts:
 * true unless an earlier number in the same series isn't done yet. `series`
 * is every game of its series (it may include `game` itself).
 */
export function isNextInSeries<T extends SeriesMember>(game: T, series: T[]): boolean {
  if (game.seriesNumber === null || isDoneInSeries(game)) return true;
  const next = nextInSeries([...series, game]);
  return next === null || next.seriesNumber! >= game.seriesNumber;
}
