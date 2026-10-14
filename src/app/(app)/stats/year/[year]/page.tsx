import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  Clock,
  Repeat,
  Star,
  Trophy,
} from "lucide-react";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { getPreferences } from "@/lib/current-user";
import { dayKey } from "@/lib/dates";
import { formatDate, formatDayKey, formatNumber } from "@/lib/display";
import {
  describePace,
  doneWords,
  goalPace,
  goalProgress,
  targetWords,
  yearClock,
} from "@/lib/goals";
import { playStreaks } from "@/lib/progress";
import { dailyMinuteTotalsForUser } from "@/lib/progress-query";
import { formatHoursPlayed, formatPlaytime } from "@/lib/progress-units";
import {
  NO_PLATFORM,
  buildPasses,
  countWindow,
  gamesLabel,
  platformCounts,
  ruleNotes,
  tally,
} from "@/lib/stats-count";
import { yearWindow } from "@/lib/stats-period";
import { loadStatsInputs, type StatsGame } from "@/lib/stats-query";
import { GameCover } from "@/components/game-card";
import { GoldMedal } from "@/components/gold-medal";
import { Bar, HoursValue, StatCard, barHours } from "@/components/stat-blocks";
import { Stars } from "@/components/stars";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export const dynamic = "force-dynamic";

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

function parseYear(raw: string): number | null {
  const year = Number(raw);
  if (!Number.isInteger(year) || year < 1900 || year > 2200) return null;
  return year;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ year: string }>;
}) {
  const { year } = await params;
  // Same check as the page, so /stats/year/abc isn't titled "abc in games".
  const parsed = parseYear(year);
  return { title: parsed === null ? "Not found · MyGames" : `${parsed} in games · MyGames` };
}

/** One completed playthrough of a game, in the review year. */
interface Finish {
  game: StatsGame;
  dateStarted: Date | null;
  dateFinished: Date;
  rating: number | null;
  isReplay: boolean;
  /** The time that playthrough took, in minutes; 0 when not known. */
  minutes: number;
}

/**
 * The year's wrap-up: everything completed that year — current passes on
 * Completed games plus archived replays — and the time played, turned into
 * highlights, distributions, and a top-rated shelf. Linked from the
 * per-year bars on the stats page. What counts follows the player's "What
 * counts" preferences, as on Stats.
 */
export default async function YearInReviewPage({
  params,
}: {
  params: Promise<{ year: string }>;
}) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login"); // revoked session (see auth.ts)
  const userId = session.user.id;

  const { year: rawYear } = await params;
  const year = parseYear(rawYear);
  if (year === null) notFound();
  const prefs = await getPreferences();
  const ratings = prefs.ratingStyle !== "off";
  const fmt = (n: number) => formatNumber(n, prefs);

  // Fetch everything and slice by year in JS, with the same counting the
  // stats page uses (lib/stats-count.ts), so the numbers always agree.
  const [inputs, goal, minuteTotals] = await Promise.all([
    loadStatsInputs(userId, prefs.timeZone),
    prisma.playGoal.findUnique({
      where: { userId_year: { userId, year } },
    }),
    // Minutes per day, as the play calendar counts them. No date bound:
    // deltas need each entry's predecessor, so the year slice comes after.
    dailyMinuteTotalsForUser(userId, prefs.timeZone),
  ]);

  // Every pass that counts in this year: dated completions (replays
  // tagged, see markReplays), plus dropped games and logged time when the
  // "What counts" preferences say so.
  const passes = buildPasses(inputs, prefs, prefs.timeZone);
  const counted = countWindow(passes, yearWindow(year), prefs);
  const totals = tally(counted);
  const notes = ruleNotes(prefs, { dropped: totals.dropped }, fmt);
  const completedLabel = gamesLabel(prefs);
  /** Passes that add a game this year: completions, and dropped games when
   *  they count as games. */
  const gameItems = counted.filter((i) => i.games > 0);

  const finishes: Finish[] = gameItems
    .filter((i) => i.pass.kind === "finished")
    .map((i) => ({
      game: i.pass.game,
      dateStarted: i.pass.dateStarted,
      dateFinished: i.pass.date!,
      rating: i.pass.rating,
      isReplay: i.isReplay,
      minutes: i.pass.wholeMinutes,
    }));
  finishes.sort((a, b) => a.dateFinished.getTime() - b.dateFinished.getTime());

  // Games dropped this year, dated by their finish date or last log entry.
  const dropped = counted
    .filter((i) => i.pass.kind === "stopped" && i.pass.day?.startsWith(`${year}-`))
    .sort((a, b) => (a.pass.day! < b.pass.day! ? -1 : a.pass.day! > b.pass.day! ? 1 : 0));

  // The play-log rhythm for this year. Day keys are "YYYY-MM-DD", so
  // slicing by prefix matches the same local-time bucketing the heatmap uses.
  const yearDays = [...minuteTotals]
    .filter(([key]) => key.startsWith(`${year}-`))
    .sort((a, b) => (a[0] < b[0] ? -1 : 1));

  // The goal, with the pace while the year is under way.
  const goalDone = goal ? goalProgress(counted, goal) : 0;
  const clock = yearClock(dayKey(new Date(), prefs.timeZone), year);
  const pace = goal ? goalPace(goalDone, goal, clock) : null;
  const goalMet = pace?.kind === "reached";
  const goalLine = goal && pace && (
    <Card>
      <CardContent className="flex flex-wrap items-center gap-4 pt-0">
        {goalMet && <GoldMedal animate className="h-14 w-[42px] shrink-0" />}
        <p className="text-sm">
          <span className="font-semibold tabular-nums">
            {doneWords(goalDone, goal.unit, prefs)} of {targetWords(goal.target, goal.unit, prefs)}
          </span>{" "}
          toward the {year} goal
          {!goal.countReplays && " (first playthroughs only)"}.{" "}
          {describePace(pace, goal.unit, prefs, formatDayKey(`${year}-01-01`, prefs.dateFormat))}
          {goalMet && " 🎉"}
        </p>
      </CardContent>
    </Card>
  );

  const header = (
    <div className="flex flex-wrap items-center gap-3">
      <Button asChild variant="ghost" size="sm">
        <Link href="/stats">
          <ArrowLeft data-slot="icon" />
          Stats
        </Link>
      </Button>
      <h1 className="text-2xl font-semibold tracking-tight">
        {year} in games
      </h1>
      <span className="ml-auto flex items-center gap-1">
        <Button asChild variant="ghost" size="icon-sm" title={`${year - 1} in games`}>
          <Link href={`/stats/year/${year - 1}`}>
            <ChevronLeft className="size-4" />
          </Link>
        </Button>
        <Button asChild variant="ghost" size="icon-sm" title={`${year + 1} in games`}>
          <Link href={`/stats/year/${year + 1}`}>
            <ChevronRight className="size-4" />
          </Link>
        </Button>
      </span>
    </div>
  );

  if (counted.length === 0 && yearDays.length === 0) {
    return (
      <div className="grid gap-6">
        {header}
        <p className="text-sm text-muted-foreground">
          No games completed and no time logged in {year}.
        </p>
        {goalLine}
      </div>
    );
  }

  // Headline numbers.
  const rated = finishes.filter((f) => f.rating != null);
  const avgRating =
    rated.length > 0
      ? rated.reduce((sum, f) => sum + f.rating!, 0) / rated.length / 2
      : null;

  // Highlights. Most played goes by the time counted this year, in any
  // pass; longest and shortest by how long each completed playthrough took.
  const minutesByGame = new Map<string, { game: StatsGame; minutes: number }>();
  for (const i of counted) {
    const entry = minutesByGame.get(i.pass.game.id) ?? { game: i.pass.game, minutes: 0 };
    entry.minutes += i.minutes;
    minutesByGame.set(i.pass.game.id, entry);
  }
  const mostPlayed = [...minutesByGame.values()].reduce<{ game: StatsGame; minutes: number } | null>(
    (best, e) => (e.minutes > 0 && (best === null || e.minutes > best.minutes) ? e : best),
    null,
  );
  const timedFinishes = finishes.filter((f) => f.minutes > 0);
  const longest = timedFinishes.length
    ? timedFinishes.reduce((a, b) => (b.minutes > a.minutes ? b : a))
    : null;
  const shortest = timedFinishes.length
    ? timedFinishes.reduce((a, b) => (b.minutes < a.minutes ? b : a))
    : null;
  const timed = finishes
    .map((f) => ({
      finish: f,
      days:
        f.dateStarted && f.dateStarted <= f.dateFinished
          ? Math.max(
              1,
              Math.round(
                (f.dateFinished.getTime() - f.dateStarted.getTime()) / 86_400_000,
              ),
            )
          : null,
    }))
    .filter((t): t is { finish: Finish; days: number } => t.days !== null);
  const quickest = timed.length
    ? timed.reduce((a, b) => (b.days < a.days ? b : a))
    : null;
  const first = finishes[0] ?? null;
  const last = finishes[finishes.length - 1] ?? null;

  // Top rated: best pass per game, once per game, top 6.
  const bestByGame = new Map<string, Finish>();
  for (const f of rated) {
    const prev = bestByGame.get(f.game.id);
    if (!prev || f.rating! > prev.rating!) bestByGame.set(f.game.id, f);
  }
  const topRated = [...bestByGame.values()]
    .sort((a, b) => b.rating! - a.rating!)
    .slice(0, 6);

  // Distributions.
  const perMonth = Array.from({ length: 12 }, () => 0);
  for (const i of gameItems) perMonth[Number(i.pass.day!.slice(5, 7)) - 1] += i.games;
  const maxMonth = Math.max(...perMonth);

  const ratingCounts = new Map<number, number>();
  for (const f of rated) {
    ratingCounts.set(f.rating!, (ratingCounts.get(f.rating!) ?? 0) + 1);
  }
  const ratingRows = [...ratingCounts.entries()].sort((a, b) => b[0] - a[0]);
  const maxRatingCount = ratingRows[0]
    ? Math.max(...ratingRows.map(([, c]) => c))
    : 0;

  const tagCounts = new Map<string, number>();
  for (const i of gameItems) {
    for (const t of i.pass.game.tags) tagCounts.set(t, (tagCounts.get(t) ?? 0) + 1);
  }
  const topTags = [...tagCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
  const maxTag = topTags[0]?.[1] ?? 0;

  // Platforms of the games completed this year, a replay counting again
  // like a tag does.
  const platforms = platformCounts(gameItems.map((i) => i.pass.game), 8);
  const maxPlatform = Math.max(...platforms.map(([, n]) => n), 0);
  const topPlatform = platforms.find(([name]) => name !== NO_PLATFORM) ?? null;

  // Play-log rhythm for this year: time per day/month, biggest day, and
  // the longest streak.
  const playDays = yearDays.length;
  const minutesLogged = yearDays.reduce((sum, [, minutes]) => sum + minutes, 0);
  const minutesPerMonth = Array.from({ length: 12 }, () => 0);
  for (const [key, minutes] of yearDays) {
    minutesPerMonth[Number(key.slice(5, 7)) - 1] += minutes;
  }
  const maxMinutesMonth = Math.max(...minutesPerMonth);
  const biggestDay = yearDays.reduce<[string, number] | null>(
    (best, day) => (best === null || day[1] > best[1] ? day : best),
    null,
  );
  const { longest: longestStreak } = playStreaks(
    new Set(yearDays.map(([key]) => key)),
    new Date(),
    prefs.timeZone,
  );
  const biggestDayDate = biggestDay
    ? formatDate(new Date(`${biggestDay[0]}T00:00:00Z`), prefs)
    : null;
  const hasHighlights =
    first !== null || dropped.length > 0 || mostPlayed !== null || topPlatform !== null;

  return (
    <div className="grid gap-6">
      {header}

      <div className={`grid grid-cols-2 gap-4 max-lg:[&>:last-child:nth-child(odd)]:col-span-2 ${ratings ? "lg:grid-cols-4" : "lg:grid-cols-3"}`}>
        <StatCard label={completedLabel} icon={Trophy} note={notes.games.join(" · ")}>
          {fmt(totals.games)}
        </StatCard>
        <StatCard
          label={`Hours played${notes.hoursSuffix}`}
          icon={Clock}
          note={notes.hours.join(" · ")}
        >
          <HoursValue minutes={totals.minutes} prefs={prefs} />
        </StatCard>
        <StatCard label="Replays" icon={Repeat}>{fmt(totals.replays)}</StatCard>
        {ratings && (
          <StatCard label="Average rating" icon={Star}>
            {avgRating == null ? (
              "–"
            ) : prefs.ratingStyle === "ten" ? (
              `${(avgRating * 2).toFixed(1)}/10`
            ) : (
              <span className="flex items-center gap-2">
                {avgRating.toFixed(1)}
                <Stars value={Math.round(avgRating * 2)} />
              </span>
            )}
          </StatCard>
        )}
      </div>

      {goalLine}

      {ratings && topRated.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Best of {year}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-4">
              {topRated.map((f) => (
                <Link
                  key={f.game.id}
                  href={`/games/${f.game.id}`}
                  className="group w-24"
                  title={f.game.title}
                >
                  <GameCover game={f.game} className="aspect-[2/3] w-24" />
                  <Stars value={f.rating!} className="mt-1.5" />
                  <p className="mt-1 line-clamp-2 text-xs leading-tight text-muted-foreground group-hover:text-foreground">
                    {f.game.title}
                  </p>
                </Link>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {hasHighlights && (
        <Card>
          <CardHeader>
            <CardTitle>Highlights</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-2 text-sm">
            {mostPlayed && (
              <Highlight label="Most played">
                <GameLink game={mostPlayed.game} /> ·{" "}
                {formatHoursPlayed(mostPlayed.minutes, prefs)}
              </Highlight>
            )}
            {longest && (
              <Highlight label="Longest game">
                <GameLink game={longest.game} /> · completed in {formatPlaytime(longest.minutes)}
              </Highlight>
            )}
            {shortest && shortest.game.id !== longest?.game.id && (
              <Highlight label="Shortest game">
                <GameLink game={shortest.game} /> · completed in {formatPlaytime(shortest.minutes)}
              </Highlight>
            )}
            {quickest && (
              <Highlight label="Quickest finish">
                <GameLink game={quickest.finish.game} /> · {quickest.days}{" "}
                {quickest.days === 1 ? "day" : "days"}
              </Highlight>
            )}
            {topPlatform && (
              <Highlight label="Top platform">
                {topPlatform[0]} · {fmt(topPlatform[1])} of {fmt(gameItems.length)}{" "}
                {gameItems.length === 1 ? "game" : "games"}
              </Highlight>
            )}
            {first && (
              <Highlight label="First completed">
                <GameLink game={first.game} /> · {formatDate(first.dateFinished, prefs)}
              </Highlight>
            )}
            {first && last && last.game.id !== first.game.id && (
              <Highlight label="Last completed">
                <GameLink game={last.game} /> · {formatDate(last.dateFinished, prefs)}
              </Highlight>
            )}
            {dropped.length > 0 && (
              <Highlight label="Dropped">
                {dropped.slice(0, 5).map((i, n) => (
                  <span key={i.pass.game.id}>
                    {n > 0 && ", "}
                    <GameLink game={i.pass.game} />
                    {i.pass.game.playedMinutes != null &&
                      ` (stopped at ${formatPlaytime(i.pass.game.playedMinutes)})`}
                  </span>
                ))}
                {dropped.length > 5 && ` and ${fmt(dropped.length - 5)} more`}
              </Highlight>
            )}
          </CardContent>
        </Card>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="grid content-start gap-6">
          <Card>
            <CardHeader>
              <CardTitle>{completedLabel} by month</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-2">
              {perMonth.map((count, i) => (
                <Bar key={MONTHS[i]} label={MONTHS[i]} value={count} max={maxMonth} />
              ))}
            </CardContent>
          </Card>

          {playDays > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Play days</CardTitle>
              </CardHeader>
              <CardContent className="grid gap-4">
                <div className="grid gap-2 text-sm">
                  <Highlight label="Days played">
                    <span className="tabular-nums">{fmt(playDays)}</span> ·{" "}
                    {formatHoursPlayed(minutesLogged, prefs)} logged
                  </Highlight>
                  {biggestDay && (
                    <Highlight label="Biggest day">
                      <span className="tabular-nums">{formatPlaytime(biggestDay[1])}</span>
                      {" "}· {biggestDayDate}
                    </Highlight>
                  )}
                  {longestStreak > 1 && (
                    <Highlight label="Longest streak">
                      <span className="tabular-nums">{longestStreak}</span> days
                      in a row
                    </Highlight>
                  )}
                </div>
                <div className="grid gap-2">
                  <p className="text-xs text-muted-foreground">Hours per month</p>
                  {minutesPerMonth.map((minutes, i) => (
                    <Bar
                      key={MONTHS[i]}
                      label={MONTHS[i]}
                      value={minutes}
                      max={maxMinutesMonth}
                      display={barHours(minutes, prefs)}
                    />
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </div>

        <div className="grid content-start gap-6">
          {ratings && ratingRows.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Ratings</CardTitle>
              </CardHeader>
              <CardContent className="grid gap-2">
                {ratingRows.map(([value, count]) => (
                  <Bar
                    key={value}
                    label={prefs.ratingStyle === "ten" ? `${value}/10` : `${value / 2} ★`}
                    value={count}
                    max={maxRatingCount}
                  />
                ))}
              </CardContent>
            </Card>
          )}

          {topTags.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Genres &amp; tags</CardTitle>
              </CardHeader>
              <CardContent className="grid gap-2">
                {topTags.map(([tag, count]) => (
                  <Bar key={tag} label={tag} value={count} max={maxTag} />
                ))}
              </CardContent>
            </Card>
          )}

          {platforms.length > 1 && (
            <Card>
              <CardHeader>
                <CardTitle>Platforms</CardTitle>
              </CardHeader>
              <CardContent className="grid gap-2">
                {platforms.map(([platform, count]) => (
                  <Bar key={platform} label={platform} value={count} max={maxPlatform} />
                ))}
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}

function Highlight({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="grid grid-cols-[8rem_1fr] items-baseline gap-2">
      <span className="text-muted-foreground">{label}</span>
      <span>{children}</span>
    </div>
  );
}

function GameLink({ game }: { game: Pick<StatsGame, "id" | "title"> }) {
  return (
    <Link
      href={`/games/${game.id}`}
      className="font-medium hover:underline"
    >
      {game.title}
    </Link>
  );
}
