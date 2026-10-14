import { PlayStatus } from "@prisma/client";
import { isDoneInSeries, nextInSeries, seriesKey, type SeriesMember } from "@/lib/series";

export interface UpNextGame extends SeriesMember {
  seriesName: string | null;
}

/**
 * The Want to Play games for the "Up next" strip on Now playing, at most
 * `limit`. The next game of a series already under way comes first, then
 * the rest in the order given (newest first). A numbered game that isn't
 * its series' next one (an earlier number is still unplayed, or another copy
 * of the same number is completed) is left out.
 *
 * Games being played count as under way here: while you're playing #2, #3
 * is what comes next. That's the one difference from the series rule in
 * lib/series.ts, which treats a game being played as the next one itself.
 */
export function upNext<T extends UpNextGame>(
  wantToPlay: T[],
  /** Every game in the library with a series name. */
  seriesGames: UpNextGame[],
  limit: number,
): T[] {
  const bySeries = new Map<string, UpNextGame[]>();
  for (const g of seriesGames) {
    if (!g.seriesName) continue;
    const key = seriesKey(g.seriesName);
    const member = g.status === PlayStatus.PLAYING ? { ...g, status: PlayStatus.COMPLETED } : g;
    const list = bySeries.get(key);
    if (list) list.push(member);
    else bySeries.set(key, [member]);
  }

  const underway: T[] = [];
  const rest: T[] = [];
  for (const game of wantToPlay) {
    if (game.seriesName == null || game.seriesNumber === null) {
      rest.push(game);
      continue;
    }
    const series = bySeries.get(seriesKey(game.seriesName)) ?? [];
    if (nextInSeries([...series, game])?.seriesNumber !== game.seriesNumber) continue;
    if (series.some(isDoneInSeries)) underway.push(game);
    else rest.push(game);
  }
  return [...underway, ...rest].slice(0, limit);
}
