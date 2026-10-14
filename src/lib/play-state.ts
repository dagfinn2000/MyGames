import { PlayStatus } from "@prisma/client";

/**
 * What changing a game's play status implies for the rest of its play
 * fields. One function, so the three ways of setting a status (the playing
 * card, the add form, and bulk edit) can't disagree. They used to: only the
 * playing card filled in the finish date and timesCompleted, so a game added
 * as Completed, or bulk-moved to Completed, counted in "Games completed" but
 * not in the year it was completed or toward that year's goal.
 */
export interface PlayState {
  status: PlayStatus;
  dateStarted: Date | null;
  dateFinished: Date | null;
  /** Time played in this playthrough, in minutes. */
  playedMinutes: number | null;
}

export function settlePlayState(
  /** The status before this change; null for a game being created. */
  prevStatus: PlayStatus | null,
  next: PlayState,
  /** Earlier passes archived in the Playthrough table. */
  archivedPlaythroughs: number,
  now: Date = new Date(),
  opts: {
    /** A Completed game with no date given stays undated instead of
     *  being finished today: the player said they don't remember, or chose
     *  that in Preferences (New games). */
    undatedFinish?: boolean;
  } = {},
): PlayState & { timesCompleted: number } {
  const { status } = next;

  // Marking a game Completed without saying when means "finished today".
  // Without a date it can't count toward any year's stats or goal, which is
  // what an undated finish asks for. A game that was already Completed and
  // is saved without a date stays undated too, so a later save (a new
  // rating, say) never stamps today on a game whose date nobody remembers.
  let dateFinished = next.dateFinished;
  if (status === PlayStatus.COMPLETED && !next.dateFinished) {
    dateFinished = opts.undatedFinish || prevStatus === PlayStatus.COMPLETED ? null : now;
  }

  // Starting a game without saying when means "started today", the same
  // convenience in the other direction. Only from Want to Play (or a new
  // game): a game picked up again from Dropped, or one already on the go,
  // has log entries the progress bookkeeping places relative to its start
  // date, and moving that date to today would re-credit them.
  const starting = prevStatus === null || prevStatus === PlayStatus.WANT_TO_PLAY;
  const dateStarted =
    status === PlayStatus.PLAYING && !next.dateStarted && starting ? now : next.dateStarted;

  // The time played belongs to the playthrough, finished or not: kept while
  // Playing, when Completed ("completed in 42 h") and when Dropped ("stopped
  // at 12 h"). Only back on Want to Play is there no playthrough for it to
  // belong to. No time (0) is stored as none.
  const playedMinutes = status === PlayStatus.WANT_TO_PLAY ? null : next.playedMinutes || null;

  // Derived, never submitted: archived passes plus the current one when
  // it's finished.
  const timesCompleted = archivedPlaythroughs + (status === PlayStatus.COMPLETED ? 1 : 0);

  return { status, dateStarted, dateFinished, playedMinutes, timesCompleted };
}
