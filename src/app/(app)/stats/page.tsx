import Link from "next/link";
import { Clock, Gamepad2, LibraryBig, Star, Trophy } from "lucide-react";
import { redirect } from "next/navigation";
import { PlayStatus } from "@prisma/client";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { getPreferences } from "@/lib/current-user";
import { dayKey } from "@/lib/dates";
import { FORMAT_LABELS, formatNumber } from "@/lib/display";
import { goalPace, goalProgress, goalTarget, splitGoals, yearClock } from "@/lib/goals";
import { dailyMinuteTotalsForUser } from "@/lib/progress-query";
import {
  NO_PLATFORM,
  buildPasses,
  countWindow,
  gamesCompletedAllTime,
  gamesLabel,
  goalRuleLine,
  perYear,
  platformCounts,
  ruleNotes,
  tally,
} from "@/lib/stats-count";
import {
  ALL_TIME,
  PERIOD_WORDS,
  parseGoalYear,
  parsePeriod,
  periodWindow,
  statsHref,
  yearWindow,
} from "@/lib/stats-period";
import { loadStatsInputs } from "@/lib/stats-query";
import { GoalCard } from "@/components/goal-card";
import { PlayHeatmap } from "@/components/play-heatmap";
import { Bar, BarPair, HoursValue, StatCard, barHours } from "@/components/stat-blocks";
import { StatsPeriodNav } from "@/components/stats-period-nav";
import { Stars } from "@/components/stars";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export const dynamic = "force-dynamic";
export const metadata = { title: "Stats · MyGames" };

export default async function StatsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login"); // revoked session (see auth.ts)

  const userId = session.user.id;
  const sp = await searchParams;
  const prefs = await getPreferences();
  const hidden = new Set(prefs.hiddenStats);
  const ratings = prefs.ratingStyle !== "off";
  const fmt = (n: number) => formatNumber(n, prefs);

  // Today, and the period the buttons (or Preferences) chose, in the
  // player's zone.
  const todayKey = dayKey(new Date(), prefs.timeZone);
  const currentYear = Number(todayKey.slice(0, 4));
  const period = parsePeriod(sp.period, prefs.statsPeriod);
  const words = PERIOD_WORDS[period];

  const [inputs, goals, minuteTotals] = await Promise.all([
    // Games, past playthroughs and the log by game and day: what
    // lib/stats-count.ts turns into passes, by the "What counts"
    // preferences.
    loadStatsInputs(userId, prefs.timeZone),
    prisma.playGoal.findMany({
      where: { userId },
      orderBy: { year: "desc" },
    }),
    // Minutes per day for the heatmap, aggregated in SQL — one row per play
    // day rather than every log entry ever written. See
    // lib/progress-query.ts for why this is not simply a date-bounded
    // findMany.
    dailyMinuteTotalsForUser(userId, prefs.timeZone),
  ]);

  const { games } = inputs;
  const playing = games.filter((g) => g.status === PlayStatus.PLAYING);

  // Every pass through every game, counted all time and in the period.
  const passes = buildPasses(inputs, prefs, prefs.timeZone);
  const allTime = countWindow(passes, ALL_TIME, prefs);
  const counted =
    period === "all" ? allTime : countWindow(passes, periodWindow(period, todayKey), prefs);
  const totals = tally(counted);

  // Games completed: all time it's the games on the Completed shelf, each
  // once. In a period it's completions, replays included, which the note
  // under the number says.
  const completedAllTime = gamesCompletedAllTime(games, prefs);
  const notes = ruleNotes(
    prefs,
    period === "all"
      ? { dropped: completedAllTime.dropped }
      : { replays: totals.replays, dropped: totals.dropped },
    fmt,
  );
  const completedLabel = gamesLabel(prefs);

  // Average rating: all time, every rated game (any status); in a period,
  // the rated completions in it.
  const ratingValues =
    period === "all"
      ? games.flatMap((g) => (g.rating != null ? [g.rating] : []))
      : counted.flatMap((i) =>
          i.games > 0 && i.pass.kind === "finished" && i.pass.rating != null
            ? [i.pass.rating]
            : [],
        );
  const avgRating =
    ratingValues.length > 0
      ? ratingValues.reduce((sum, r) => sum + r, 0) / ratingValues.length / 2
      : null;

  // Games and hours per year, each year counted as its goal counts it.
  const years = perYear(passes, prefs);
  const maxGames = Math.max(...years.map((y) => y.games), 0);
  const maxMinutes = Math.max(...years.map((y) => y.minutes), 0);

  // Play goals: one year at a time (this year unless the address picks
  // next year or a past one), with progress by the goal's own rule and the
  // same counting as the cards.
  const { upcoming, past } = splitGoals(goals, currentYear);
  const goalYear = parseGoalYear(sp.goalYear, currentYear, new Set(past.map((g) => g.year)));
  const shownYear = goalYear ?? currentYear;
  const shownGoal = goals.find((g) => g.year === shownYear) ?? null;
  const progressFor = (g: (typeof goals)[number]) =>
    goalProgress(countWindow(passes, yearWindow(g.year), prefs), g);
  const clock = yearClock(todayKey, shownYear);
  const goalDone = shownGoal ? progressFor(shownGoal) : 0;
  const nextGoal = upcoming.find((g) => g.year === currentYear + 1) ?? null;

  // Genres, platforms and formats: every game in the library, or
  // (Preferences) the games completed in the period, each once however
  // many times it was played through.
  const byPeriod = prefs.statsBreakdown === "period";
  const breakdownGames = byPeriod
    ? [
        ...new Map(
          counted.filter((i) => i.games > 0).map((i) => [i.pass.game.id, i.pass.game]),
        ).values(),
      ]
    : games;
  const breakdownNote = byPeriod
    ? `${completedLabel.toLowerCase()} · ${words}`
    : period === "all"
      ? null
      : "every game in the library";
  const nothingCompleted =
    period === "all" ? "Nothing completed yet." : "Nothing in this period.";

  // Genre/tag breakdown, top 10.
  const tagCounts = new Map<string, number>();
  for (const g of breakdownGames) {
    for (const t of g.tags) tagCounts.set(t, (tagCounts.get(t) ?? 0) + 1);
  }
  const topTags = [...tagCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10);
  const maxTag = topTags[0]?.[1] ?? 0;

  // Platform breakdown, top 10, then the games with no platform.
  const platforms = platformCounts(breakdownGames);
  const maxPlatform = Math.max(...platforms.map(([, n]) => n), 0);
  const noPlatformsYet = platforms.length === 1 && platforms[0][0] === NO_PLATFORM;

  // Format breakdown.
  const formatCounts = new Map<string, number>();
  for (const g of breakdownGames) {
    const label = FORMAT_LABELS[g.format];
    formatCounts.set(label, (formatCounts.get(label) ?? 0) + 1);
  }
  const maxFormat = Math.max(...formatCounts.values(), 0);

  /** The card title's note on what the breakdowns count. */
  const breakdownSuffix = breakdownNote && (
    <span className="font-normal text-muted-foreground"> · {breakdownNote}</span>
  );

  return (
    <div className="grid gap-6">
      <div className="grid gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">Stats</h1>
        <StatsPeriodNav period={period} goalYear={goalYear} />
      </div>

      <div className="grid gap-3">
        <div className={`grid grid-cols-2 gap-4 max-lg:[&>:last-child:nth-child(odd)]:col-span-2 ${ratings ? "lg:grid-cols-5" : "lg:grid-cols-4"}`}>
          <StatCard label="Games in library" icon={LibraryBig}>{fmt(games.length)}</StatCard>
          <StatCard label={`${completedLabel} · ${words}`} icon={Trophy} note={notes.games.join(" · ")}>
            {fmt(period === "all" ? completedAllTime.games : totals.games)}
          </StatCard>
          <StatCard label="Playing now" icon={Gamepad2}>{fmt(playing.length)}</StatCard>
          <StatCard
            label={`Hours played · ${words}${notes.hoursSuffix}`}
            icon={Clock}
            note={notes.hours.join(" · ")}
          >
            <HoursValue minutes={totals.minutes} prefs={prefs} />
          </StatCard>
          {ratings && (
            <StatCard
              label={`Average rating · ${words}`}
              icon={Star}
              note={`${fmt(ratingValues.length)} rated`}
            >
              {avgRating != null ? (
                <AverageRating stars={avgRating} style={prefs.ratingStyle} />
              ) : (
                "–"
              )}
            </StatCard>
          )}
        </div>
        {period === "year" && (
          <p className="text-sm">
            <Link
              href={`/stats/year/${currentYear}`}
              className="text-muted-foreground hover:text-foreground hover:underline"
            >
              See {currentYear} in review
            </Link>
          </p>
        )}
      </div>

      {!hidden.has("goal") && (
        <GoalCard
          year={shownYear}
          currentYear={currentYear}
          goal={shownGoal}
          done={goalDone}
          pace={shownGoal ? goalPace(goalDone, shownGoal, clock) : null}
          clock={clock}
          nextYear={
            nextGoal && { ...nextGoal, href: statsHref({ period, goalYear: nextGoal.year }) }
          }
          past={past.map((g) => {
            const done = progressFor(g);
            return {
              year: g.year,
              target: g.target,
              unit: g.unit,
              done,
              met: done >= goalTarget(g),
              editHref: statsHref({ period, goalYear: g.year, hash: "goal" }),
            };
          })}
          yearOptions={[...new Set([currentYear, currentYear + 1, shownYear])]
            .sort((a, b) => a - b)
            .map((y) => ({
              year: y,
              href: statsHref({ period, goalYear: y === currentYear ? null : y }),
            }))}
          ruleLine={goalRuleLine(prefs)}
          prefs={prefs}
        />
      )}

      {!hidden.has("heatmap") && (
        <Card>
          <CardHeader>
            <CardTitle>
              Play days
              {/* The calendar is always the last 12 months. */}
              {(period === "year" || period === "30d") && (
                <span className="font-normal text-muted-foreground"> · last 12 months</span>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <PlayHeatmap totals={minuteTotals} prefs={prefs} />
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {!hidden.has("perYear") && (
          <Card>
            <CardHeader>
              <CardTitle>
                {maxMinutes > 0 ? "Games and hours per year" : `${completedLabel} per year`}
              </CardTitle>
            </CardHeader>
            <CardContent className="grid gap-2">
              {years.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  Complete a game (with a finished date) or log some time, and the year shows up
                  here.
                </p>
              ) : (
                <>
                  {years.map(({ year, games: count, minutes }) => (
                    <Link
                      key={year}
                      href={`/stats/year/${year}`}
                      className="-mx-1.5 rounded px-1.5 py-0.5 transition-colors hover:bg-accent/50"
                      title={`${year} in review`}
                    >
                      {maxMinutes > 0 ? (
                        <BarPair
                          label={String(year)}
                          first={{ value: count, max: maxGames, display: fmt(count) }}
                          second={{ value: minutes, max: maxMinutes, display: barHours(minutes, prefs) }}
                        />
                      ) : (
                        <Bar label={String(year)} value={count} max={maxGames} />
                      )}
                    </Link>
                  ))}
                  <p className="pt-1 text-xs text-muted-foreground">
                    {maxMinutes > 0 && `${completedLabel} above, hours played below. `}
                    Click a year for its full wrap-up.
                  </p>
                </>
              )}
            </CardContent>
          </Card>
        )}

        {!hidden.has("tags") && (
          <Card>
            <CardHeader>
              <CardTitle>
                Genres &amp; tags
                {breakdownSuffix}
              </CardTitle>
            </CardHeader>
            <CardContent className="grid gap-2">
              {topTags.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  {byPeriod && breakdownGames.length === 0
                    ? nothingCompleted
                    : "Tag your games to see the breakdown."}
                </p>
              ) : (
                topTags.map(([tag, count]) => (
                  <Bar key={tag} label={tag} value={count} max={maxTag} />
                ))
              )}
            </CardContent>
          </Card>
        )}

        {!hidden.has("platforms") && (
          <Card>
            <CardHeader>
              <CardTitle>
                Platforms
                {breakdownSuffix}
              </CardTitle>
            </CardHeader>
            <CardContent className="grid gap-2">
              {platforms.map(([platform, count]) => (
                <Bar key={platform} label={platform} value={count} max={maxPlatform} />
              ))}
              {platforms.length === 0 && (
                <p className="text-sm text-muted-foreground">
                  {byPeriod ? nothingCompleted : "No games yet."}
                </p>
              )}
              {noPlatformsYet && (
                <p className="text-sm text-muted-foreground">
                  Add the platform you play each game on to see the breakdown.
                </p>
              )}
            </CardContent>
          </Card>
        )}

        {!hidden.has("formats") && (
          <Card>
            <CardHeader>
              <CardTitle>
                Formats
                {breakdownSuffix}
              </CardTitle>
            </CardHeader>
            <CardContent className="grid gap-2">
              {[...formatCounts.entries()].map(([label, count]) => (
                <Bar key={label} label={label} value={count} max={maxFormat} />
              ))}
              {formatCounts.size === 0 && (
                <p className="text-sm text-muted-foreground">
                  {byPeriod ? nothingCompleted : "No games yet."}
                </p>
              )}
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}

/** The average rating in the player's rating style: "3.6" with stars, or
 *  "7.2/10". */
function AverageRating({ stars, style }: { stars: number; style: string }) {
  if (style === "ten") return <>{(stars * 2).toFixed(1)}/10</>;
  return (
    <span className="flex items-center gap-2">
      {stars.toFixed(1)}
      <Stars value={Math.round(stars * 2)} />
    </span>
  );
}
