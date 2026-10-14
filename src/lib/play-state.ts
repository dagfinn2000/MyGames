import { PlayStatus } from "@prisma/client";

/**
 * What changing a game's reading status implies for the rest of its reading
 * fields. One function, so the three ways of setting a status (the reading
 * card, the add form's shelf picker, and bulk edit) can't disagree. They
 * used to: only the reading card filled in the finish date and timesCompleted, so
 * a game added as Read, or bulk-moved to Read, counted in "Games read" but
 * not in the year it was read or toward that year's goal.
 */
export interface PlayState {
  status: PlayStatus;
  dateStarted: Date | null;
  dateFinished: Date | null;
  currentPage: number | null;
}

export function settlePlayState(
  /** The status before this change; null for a game being created. */
  prevStatus: PlayStatus | null,
  next: PlayState,
  /** Earlier passes archived in the Read table. */
  archivedPlaythroughs: number,
  now: Date = new Date(),
  opts: {
    /** A Read game with no date given stays undated instead of being
     *  finished today: the reader said they don't remember, or chose that
     *  in Preferences (New games). */
    undatedFinish?: boolean;
  } = {},
): PlayState & { timesCompleted: number } {
  const { status } = next;

  // Marking a game Read without saying when means "finished today". Without
  // a date it can't count toward any year's stats or goal, which is what an
  // undated finish asks for. A game that was already Read and is saved
  // without a date stays undated too, so a later save (a new rating, say)
  // never stamps today on a game whose date nobody remembers.
  let dateFinished = next.dateFinished;
  if (status === PlayStatus.COMPLETED && !next.dateFinished) {
    dateFinished = opts.undatedFinish || prevStatus === PlayStatus.COMPLETED ? null : now;
  }

  // Starting a game without saying when means "started today", the same
  // convenience in the other direction. Only from Want to Read (or a new
  // game): a game resumed from Did Not Finish, or one already on the go, has
  // log entries the progress bookkeeping places relative to its start date,
  // and moving that date to today would re-credit them.
  const starting = prevStatus === null || prevStatus === PlayStatus.WANT_TO_PLAY;
  const dateStarted =
    status === PlayStatus.PLAYING && !next.dateStarted && starting ? now : next.dateStarted;

  // Progress only makes sense mid-game: kept for Reading and Did Not Finish
  // ("stopped at p. 218"), cleared when finished or back on the shelf.
  const keepsProgress = status === PlayStatus.PLAYING || status === PlayStatus.DROPPED;
  const currentPage = keepsProgress ? next.currentPage || null : null;

  // Derived, never submitted: archived passes plus the current one when
  // it's finished.
  const timesCompleted = archivedPlaythroughs + (status === PlayStatus.COMPLETED ? 1 : 0);

  return { status, dateStarted, dateFinished, currentPage, timesCompleted };
}
