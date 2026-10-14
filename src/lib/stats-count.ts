import type { PlayStatus } from "@prisma/client";
import { calendarDay, dayKey } from "@/lib/dates";
import { markReplays } from "@/lib/goals";
import type { Preferences } from "@/lib/preferences";
import { yearWindow, type DayWindow } from "@/lib/stats-period";

/**
 * What counts toward Games completed, Hours played and the play goal: the
 * one place the "What counts" preferences are applied, so the stats cards,
 * the goal and the year in review can't disagree.
 *
 * Every time through a game is a pass (a playthrough). Completed passes are
 * the archived playthroughs plus the current one on a Completed game; a
 * dropped game has a stopped pass; anything on the go (or back on Want to
 * Play with old log entries) has an open pass, which only ever adds logged
 * time. A pass is counted in a window of days by when it ended, or, when
 * hours played count the time logged, by the days its time was logged.
 *
 * Time is in minutes throughout; only what's shown turns it into hours.
 */

export type CountRules = Pick<Preferences, "statsHoursPlayed" | "statsStoppedGames">;

/** The game fields counting needs. Callers can pass more; they come back
 *  on each pass. */
export interface CountGame {
  id: string;
  status: PlayStatus;
  /** Time played in the current playthrough: kept when it is completed or
   *  dropped, so it is also the time that pass took. */
  playedMinutes: number | null;
  dateStarted: Date | null;
  dateFinished: Date | null;
  rating: number | null;
}

/** An archived playthrough from the play history. */
export interface CountPlaythrough {
  gameId: string;
  dateStarted: Date | null;
  dateFinished: Date | null;
  rating: number | null;
  /** The time that playthrough took, when it was tracked. */
  playedMinutes: number | null;
}

/** Minutes logged in one game on one day (see lib/stats-query.ts). */
export interface GameDayMinutes {
  gameId: string;
  /** "2026-05-12", in the player's zone. */
  day: string;
  minutes: number;
  /** Logged in the game's current pass, on or after its start, rather than
   *  in an earlier one. */
  current: boolean;
}

export interface StatsInputs<G extends CountGame = CountGame> {
  games: G[];
  /** Oldest first. */
  playthroughs: CountPlaythrough[];
  logDays: GameDayMinutes[];
  /** The latest log entry of each game you dropped, which dates the drop
   *  when no date was given. */
  lastLogDates: ReadonlyMap<string, Date>;
}

export interface DayMinutes {
  day: string;
  minutes: number;
}

export interface Pass<G extends CountGame = CountGame> {
  game: G;
  kind: "finished" | "stopped" | "open";
  /** When the pass ended: the finish date, or when a dropped game was put
   *  down. Null when that isn't known; such a pass counts in all time only. */
  date: Date | null;
  /** `date` as a day key in the player's zone. */
  day: string | null;
  dateStarted: Date | null;
  /** The game had been completed before this pass. */
  isReplay: boolean;
  rating: number | null;
  /** Counts toward Games completed when it ends. */
  countsAsGame: boolean;
  /** Minutes it adds when it ends: the time the playthrough took, or how
   *  long a dropped game was played before it was put down. */
  wholeMinutes: number;
  /** Minutes logged during this pass, by day. */
  logged: DayMinutes[];
}

/** A pass counted in a window: what it adds there. */
export interface Counted<G extends CountGame = CountGame> {
  pass: Pass<G>;
  isReplay: boolean;
  games: number;
  minutes: number;
}

interface Draft {
  kind: Pass["kind"];
  date: Date | null;
  day: string | null;
  dateStarted: Date | null;
  startDay: string | null;
  rating: number | null;
  playedMinutes: number | null;
  isReplay: boolean;
  logged: DayMinutes[];
}

function groupBy<T>(list: T[], key: (item: T) => string): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const item of list) {
    const k = key(item);
    const group = map.get(k);
    if (group) group.push(item);
    else map.set(k, [item]);
  }
  return map;
}

/**
 * The archived pass that time logged on `day` (before the current pass
 * began) belongs to: the earliest finish on or after that day whose start
 * isn't after it, else an undated pass that could hold it (the most recent),
 * else the latest finish before it. Bounding by each pass's start keeps an
 * undated pass's time from landing on a later dated one, where the undated
 * pass would then look unlogged and add its whole time a second time.
 */
function archivedPassFor(archived: Draft[], day: string): Draft | null {
  const fits = archived.filter(
    (p) => (p.startDay === null || p.startDay <= day) && (p.day === null || day <= p.day),
  );
  const dated = fits
    .filter((p) => p.day !== null)
    .sort((a, b) => (a.day! < b.day! ? -1 : a.day! > b.day! ? 1 : 0));
  if (dated.length > 0) return dated[0];
  const undated = fits.filter((p) => p.day === null);
  if (undated.length > 0) return undated[undated.length - 1];
  const earlier = archived
    .filter((p) => p.day !== null && p.day < day)
    .sort((a, b) => (a.day! < b.day! ? -1 : a.day! > b.day! ? 1 : 0));
  if (earlier.length > 0) return earlier[earlier.length - 1];
  return archived[archived.length - 1] ?? null;
}

/** Every pass through every game, with the rules applied: dropped games
 *  left out, or counted by their time or as games. */
export function buildPasses<G extends CountGame>(
  { games, playthroughs, logDays, lastLogDates }: StatsInputs<G>,
  rules: Pick<CountRules, "statsStoppedGames">,
  timeZone: string,
): Pass<G>[] {
  const playthroughsByGame = groupBy(playthroughs, (r) => r.gameId);
  const logByGame = groupBy(logDays, (r) => r.gameId);
  const day = (d: Date | null) => (d ? calendarDay(d, timeZone) : null);
  const passes: Pass<G>[] = [];

  for (const game of games) {
    const archived: Draft[] = (playthroughsByGame.get(game.id) ?? []).map((r) => ({
      kind: "finished",
      date: r.dateFinished,
      day: day(r.dateFinished),
      dateStarted: r.dateStarted,
      startDay: day(r.dateStarted),
      // A pass without its own rating falls back to the game's rating.
      rating: r.rating ?? game.rating,
      playedMinutes: r.playedMinutes,
      isReplay: false,
      logged: [],
    }));

    // A dropped game is dated by its finish date when one was given, else
    // by its last log entry.
    const ended = game.status === "COMPLETED" || game.status === "DROPPED";
    const lastLog = game.status === "DROPPED" ? (lastLogDates.get(game.id) ?? null) : null;
    const current: Draft = {
      kind: game.status === "COMPLETED" ? "finished" : game.status === "DROPPED" ? "stopped" : "open",
      date: ended ? (game.dateFinished ?? lastLog) : null,
      day: ended ? (day(game.dateFinished) ?? (lastLog ? dayKey(lastLog, timeZone) : null)) : null,
      dateStarted: game.dateStarted,
      startDay: day(game.dateStarted),
      rating: game.rating,
      playedMinutes: game.playedMinutes,
      isReplay: false,
      logged: [],
    };

    // Replays: dated finishes by the existing rule (an undated past
    // playthrough is presumed to come first). The first undated archived
    // pass is the first time through; any pass after an archived one is a
    // replay.
    const dated = [...archived, current].filter((p) => p.kind === "finished" && p.date);
    const hasUndated = archived.some((p) => !p.date);
    for (const m of markReplays(
      dated.map((p) => ({ gameId: game.id, dateFinished: p.date!, p })),
      hasUndated ? new Set([game.id]) : new Set<string>(),
    )) {
      m.p.isReplay = m.isReplay;
    }
    archived
      .filter((p) => !p.date)
      .forEach((p, i) => {
        p.isReplay = i > 0;
      });
    if (!current.date || current.kind !== "finished") current.isReplay = archived.length > 0;

    for (const row of logByGame.get(game.id) ?? []) {
      const pass = row.current ? current : (archivedPassFor(archived, row.day) ?? current);
      pass.logged.push({ day: row.day, minutes: row.minutes });
    }

    for (const p of [...archived, current]) {
      if (p.kind === "stopped" && rules.statsStoppedGames === "none") continue;
      // The time a pass took is what was recorded for it, else what was
      // logged during it. Never capped at the time to beat: a long
      // playthrough is all played time.
      const wholeMinutes =
        p.kind === "open" ? 0 : (p.playedMinutes ?? p.logged.reduce((sum, l) => sum + l.minutes, 0));
      passes.push({
        game,
        kind: p.kind,
        date: p.date,
        day: p.day,
        dateStarted: p.dateStarted,
        isReplay: p.isReplay,
        rating: p.rating,
        countsAsGame:
          p.kind === "finished" || (p.kind === "stopped" && rules.statsStoppedGames === "game"),
        wholeMinutes,
        logged: p.logged,
      });
    }
  }
  return passes;
}

/** Whether a day falls in a window. An unknown day is in all time only. */
export function inWindow(day: string | null, window: DayWindow): boolean {
  if (day === null) return window.from === null && window.to === null;
  return (window.from === null || day >= window.from) && (window.to === null || day <= window.to);
}

/**
 * What each pass adds in a window. A pass adds a game when it ends there.
 * Time is the whole playthrough when it ends there; or, when hours count
 * the time logged, the minutes logged on days in the window, plus the
 * whole playthrough for a pass that ends there with nothing logged (a game
 * completed without logging still adds the time it took, when that was
 * given). Passes adding nothing are left out.
 */
export function countWindow<G extends CountGame>(
  passes: Pass<G>[],
  window: DayWindow,
  rules: Pick<CountRules, "statsHoursPlayed">,
): Counted<G>[] {
  const counted: Counted<G>[] = [];
  for (const pass of passes) {
    const endsHere = pass.kind !== "open" && inWindow(pass.day, window);
    const games = endsHere && pass.countsAsGame ? 1 : 0;
    let minutes = 0;
    if (rules.statsHoursPlayed === "logged") {
      for (const l of pass.logged) if (inWindow(l.day, window)) minutes += l.minutes;
      if (endsHere && pass.logged.length === 0) minutes += pass.wholeMinutes;
    } else if (endsHere) {
      minutes = pass.wholeMinutes;
    }
    if (games > 0 || minutes > 0) counted.push({ pass, isReplay: pass.isReplay, games, minutes });
  }
  return counted;
}

/** Totals for a window's counted passes. */
export function tally(items: Counted[]): {
  games: number;
  minutes: number;
  /** Completed replays among the games. */
  replays: number;
  /** Dropped games counted as games. */
  dropped: number;
} {
  let games = 0;
  let minutes = 0;
  let replays = 0;
  let dropped = 0;
  for (const i of items) {
    games += i.games;
    minutes += i.minutes;
    if (i.games > 0 && i.pass.kind === "finished" && i.isReplay) replays++;
    if (i.games > 0 && i.pass.kind === "stopped") dropped++;
  }
  return { games, minutes, replays, dropped };
}

/**
 * Games completed and hours played in each year that has any, oldest year
 * first: the per-year chart on the stats page. Each year is counted exactly
 * as the goal and the year in review count it (countWindow over the
 * calendar year), so the three always agree. Replays are included: a 2026
 * replay of an old favourite shows up in 2026.
 */
export function perYear<G extends CountGame>(
  passes: Pass<G>[],
  rules: Pick<CountRules, "statsHoursPlayed">,
): { year: number; games: number; minutes: number }[] {
  const years = new Set<number>();
  for (const p of passes) {
    if (p.kind !== "open" && p.day) years.add(Number(p.day.slice(0, 4)));
    if (rules.statsHoursPlayed === "logged") {
      for (const l of p.logged) years.add(Number(l.day.slice(0, 4)));
    }
  }
  return [...years]
    .sort((a, b) => a - b)
    .map((year) => {
      const { games, minutes } = tally(countWindow(passes, yearWindow(year), rules));
      return { year, games, minutes };
    })
    .filter((y) => y.games > 0 || y.minutes > 0);
}

/** All-time Games completed: games on the Completed shelf (each once,
 *  however many times completed), plus dropped games when they count as
 *  games. */
export function gamesCompletedAllTime(
  games: Pick<CountGame, "status">[],
  rules: Pick<CountRules, "statsStoppedGames">,
): { games: number; dropped: number } {
  let completed = 0;
  let dropped = 0;
  for (const g of games) {
    if (g.status === "COMPLETED") completed++;
    if (g.status === "DROPPED" && rules.statsStoppedGames === "game") dropped++;
  }
  return { games: completed + dropped, dropped };
}

/** The Games completed label: "Games finished" when dropped games count as
 *  games too, since they were finished with rather than completed. */
export function gamesLabel(rules: Pick<CountRules, "statsStoppedGames">): string {
  return rules.statsStoppedGames === "game" ? "Games finished" : "Games completed";
}

/**
 * Which rules are on, for the stat cards: a suffix for the Hours played
 * label and small notes under the numbers ("includes 2 replays").
 */
export function ruleNotes(
  rules: CountRules,
  counts: { replays?: number; dropped?: number } = {},
  fmt: (n: number) => string = String,
): { hoursSuffix: string; hours: string[]; games: string[] } {
  const hours: string[] = [];
  if (rules.statsHoursPlayed === "finished") hours.push("whole playthroughs when completed");
  if (rules.statsStoppedGames !== "none") hours.push("includes time in games you dropped");

  const games: string[] = [];
  const { replays = 0, dropped = 0 } = counts;
  if (replays > 0) games.push(`includes ${fmt(replays)} ${replays === 1 ? "replay" : "replays"}`);
  if (dropped > 0) games.push(`includes ${fmt(dropped)} dropped`);

  return {
    hoursSuffix: rules.statsHoursPlayed === "logged" ? " · as logged" : "",
    hours,
    games,
  };
}

/** The goal card's footnote on what an hours goal counts. */
export function goalRuleLine(rules: Pick<CountRules, "statsHoursPlayed">): string {
  return rules.statsHoursPlayed === "logged"
    ? "An hours goal counts the time you log, plus the time played on games you complete without logging."
    : "An hours goal adds up the whole time played on each game you complete.";
}

/** The breakdown shown for a game with no platform. */
export const NO_PLATFORM = "No platform";

/**
 * Games per platform for the Platforms card, most first (ties by name),
 * top `limit`. Games without a platform are one "No platform" bucket, kept
 * at the end so the real platforms lead. Platforms are matched as written,
 * like the library's platform filter, so a bar's count is what that filter
 * finds.
 */
export function platformCounts(
  games: { platform: string | null }[],
  limit = 10,
): [string, number][] {
  const counts = new Map<string, number>();
  let none = 0;
  for (const g of games) {
    const platform = g.platform?.trim();
    if (platform) counts.set(platform, (counts.get(platform) ?? 0) + 1);
    else none++;
  }
  const top = [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit);
  return none > 0 ? [...top, [NO_PLATFORM, none]] : top;
}
