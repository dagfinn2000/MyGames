"use server";

import { PlayStatus } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireUserId } from "@/lib/actions/helpers";
import { getPreferences } from "@/lib/current-user";
import { parseFilters } from "@/lib/library-filters";
import { resolveGameWhere } from "@/lib/library-where";
import { chooseRandom, pickPool, tabStatus, type PickResult, type SeriesRow } from "@/lib/pick";

/** Above this many series names, fetch every numbered series game instead
 *  of naming them all in the query. */
const MAX_SERIES_NAMES = 200;

/**
 * Picks a random game from the current view: the tab and filters on screen,
 * narrowed by the Pick for me switches in Preferences (lib/pick.ts has the
 * rule). Only the All tab prefers Want to Read; on a status tab the pick
 * stays on that tab. Returns why when nothing could be picked, so the page
 * can say so instead of doing nothing.
 *
 * It runs here rather than in the browser because the page no longer ships
 * the entire library to the client. Choosing from the loaded slice would
 * quietly turn "anything on my to-read shelf" into "anything in the first
 * couple of hundred", which is exactly the sort of silent narrowing a
 * shuffle button must not have.
 */
export async function pickRandomGame(
  searchParams: Record<string, string>,
): Promise<PickResult> {
  const userId = await requireUserId();
  const parsed = z.record(z.string(), z.string()).safeParse(searchParams);
  const filters = parseFilters(parsed.success ? parsed.data : {});
  const prefs = await getPreferences();
  const where = await resolveGameWhere(userId, filters, prefs);

  const games = await prisma.game.findMany({
    where,
    select: {
      id: true,
      status: true,
      ownership: true,
      seriesName: true,
      seriesNumber: true,
      timesCompleted: true,
    },
  });
  if (games.length === 0) return { reason: "none" };

  // Lent-out games only matter to "Only games I have". Open loans are few,
  // so this is cheaper than asking about every game in the view.
  const lentIds = new Set(
    prefs.pickOnlyHave
      ? (
          await prisma.loan.findMany({
            where: { returnedAt: null, game: { userId } },
            select: { gameId: true },
          })
        ).map((l) => l.gameId)
      : [],
  );
  const rows = games.map((b) => ({ ...b, lent: lentIds.has(b.id) }));

  // Earlier games of a series may be anywhere in the library (Want to Read
  // has no read #1 on it), so the series are fetched whole, unfiltered.
  let series: SeriesRow[] = [];
  if (prefs.pickNextInSeries) {
    const names = [
      ...new Set(
        rows.flatMap((b) =>
          b.status === PlayStatus.WANT_TO_PLAY && b.seriesName && b.seriesNumber !== null
            ? [b.seriesName]
            : [],
        ),
      ),
    ];
    if (names.length > 0) {
      series = await prisma.game.findMany({
        where: {
          userId,
          seriesNumber: { not: null },
          ...(names.length <= MAX_SERIES_NAMES
            ? {
                OR: names.map((n) => ({
                  seriesName: { equals: n, mode: "insensitive" as const },
                })),
              }
            : { seriesName: { not: null } }),
        },
        select: { seriesName: true, seriesNumber: true, status: true, timesCompleted: true },
      });
    }
  }

  const pool = pickPool(
    rows,
    {
      tab: tabStatus(filters.shelf),
      onlyHave: prefs.pickOnlyHave,
      nextInSeries: prefs.pickNextInSeries,
    },
    series,
  );
  const pick = chooseRandom(pool);
  return pick ? { id: pick.id } : { reason: "settings" };
}
