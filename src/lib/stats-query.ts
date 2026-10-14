import { PlayStatus, type Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { GameDayMinutes, StatsInputs } from "@/lib/stats-count";

/** The game fields the stats page and the year in review use. */
export const statsGameSelect = {
  id: true,
  title: true,
  developers: true,
  coverUrl: true,
  tags: true,
  platform: true,
  format: true,
  status: true,
  rating: true,
  dateStarted: true,
  dateFinished: true,
  playedMinutes: true,
} as const satisfies Prisma.GameSelect;

export type StatsGame = Prisma.GameGetPayload<{ select: typeof statsGameSelect }>;

/**
 * Minutes played per game per day, computed in the database, and whether
 * each day's minutes belong to the game's current playthrough.
 *
 * The deltas are exactly those of `dailyMinuteTotalsForUser` in
 * lib/progress-query.ts (rises between consecutive entries of a game,
 * ordered by date then minutes, bucketed in the player's zone), only not
 * summed across games: summed per day they give the play calendar's
 * totals, which stats-query.db.test.ts checks. If the delta rule there
 * changes, this must change with it.
 *
 * The current pass starts at the latest 0-minute anchor, else on the game's
 * start date (that calendar day in the player's zone, or later), else at
 * the first entry: the rule currentPassEntries in lib/progress.ts uses.
 * Earlier time belongs to archived playthroughs, which is what keeps a
 * replay's hours off the playthrough before it.
 */
export async function gameDayMinuteTotalsForUser(
  userId: string,
  /** The player's zone (Preferences). */
  timeZone: string,
): Promise<GameDayMinutes[]> {
  const rows = await prisma.$queryRaw<
    { gameId: string; day: string; current: boolean; minutes: number }[]
  >`
    SELECT
      t."gameId",
      to_char(
        (t."date" AT TIME ZONE 'UTC') AT TIME ZONE ${timeZone},
        'YYYY-MM-DD'
      ) AS day,
      (CASE
        WHEN t."anchor" IS NOT NULL THEN t."date" >= t."anchor"
        WHEN t."dateStarted" IS NULL THEN true
        ELSE t."date" >= t."dateStarted"
          OR to_char((t."date" AT TIME ZONE 'UTC') AT TIME ZONE ${timeZone}, 'YYYY-MM-DD') >= t."startDay"
      END) AS "current",
      SUM(t.delta)::int AS minutes
    FROM (
      SELECT
        pe."gameId",
        pe."date",
        pe."minutes" - LAG(pe."minutes") OVER (
          PARTITION BY pe."gameId"
          ORDER BY pe."date" ASC, pe."minutes" ASC
        ) AS delta,
        MAX(pe."date") FILTER (WHERE pe."minutes" = 0) OVER (PARTITION BY pe."gameId") AS "anchor",
        g."dateStarted",
        -- calendarDay: a typed date (midnight UTC) is that day anywhere.
        CASE
          WHEN g."dateStarted" = date_trunc('day', g."dateStarted")
            THEN to_char(g."dateStarted", 'YYYY-MM-DD')
          ELSE to_char((g."dateStarted" AT TIME ZONE 'UTC') AT TIME ZONE ${timeZone}, 'YYYY-MM-DD')
        END AS "startDay"
      FROM "ProgressEntry" pe
      JOIN "Game" g ON g."id" = pe."gameId"
      WHERE g."userId" = ${userId}
    ) t
    WHERE t.delta > 0
    GROUP BY 1, 2, 3
  `;
  return rows.map((r) => ({ gameId: r.gameId, day: r.day, minutes: r.minutes, current: r.current }));
}

/** Everything lib/stats-count.ts needs for one player, scoped to them. */
export async function loadStatsInputs(
  userId: string,
  timeZone: string,
): Promise<StatsInputs<StatsGame>> {
  const [games, playthroughs, logDays, lastLogs] = await Promise.all([
    prisma.game.findMany({ where: { userId }, select: statsGameSelect }),
    // Archived passes from the play history: replays and playthroughs from
    // before the app.
    prisma.playthrough.findMany({
      where: { game: { userId } },
      select: {
        gameId: true,
        dateStarted: true,
        dateFinished: true,
        rating: true,
        playedMinutes: true,
      },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    }),
    gameDayMinuteTotalsForUser(userId, timeZone),
    prisma.progressEntry.groupBy({
      by: ["gameId"],
      where: { game: { userId, status: PlayStatus.DROPPED } },
      _max: { date: true },
    }),
  ]);

  const lastLogDates = new Map<string, Date>();
  for (const row of lastLogs) {
    if (row._max.date) lastLogDates.set(row.gameId, row._max.date);
  }
  return { games, playthroughs, logDays, lastLogDates };
}
