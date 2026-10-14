import type { GameFormat, ReadingStatus } from "@prisma/client";
import { calendarDay, dayKey } from "@/lib/dates";
import { markRereads } from "@/lib/goals";
import type { Preferences } from "@/lib/preferences";
import type { DayWindow } from "@/lib/stats-period";

/**
 * What counts toward Games read, Pages read and the reading goal: the one
 * place the "What counts" preferences are applied, so the stats cards, the
 * goal and the year in review can't disagree.
 *
 * Every time through a game is a pass. Finished passes are the archived
 * reads plus the current one on a Read game; a game you stopped reading has
 * a stopped pass; anything on the go (or back on the shelf with old log
 * entries) has an open pass, which only ever adds logged pages. A pass is
 * counted in a window of days by when it ended, or, for "Pages I logged",
 * by the days its pages were logged.
 */

export type CountRules = Pick<
  Preferences,
  "statsPagesRead" | "statsStoppedGames" | "statsAudiobooks"
>;

/** The game fields counting needs. Callers can pass more; they come back
 *  on each pass. */
export interface CountGame {
  id: string;
  status: ReadingStatus;
  format: GameFormat;
  pageCount: number | null;
  currentPage: number | null;
  dateStarted: Date | null;
  dateFinished: Date | null;
  rating: number | null;
}

/** An archived pass from the read history. */
export interface CountRead {
  gameId: string;
  dateStarted: Date | null;
  dateFinished: Date | null;
  rating: number | null;
}

/** Pages logged in one game on one day (see lib/stats-query.ts). */
export interface GameDayPages {
  gameId: string;
  /** "2026-05-12", in the reader's zone. */
  day: string;
  pages: number;
  /** Logged in the game's current pass, on or after its start, rather than
   *  in an earlier one. */
  current: boolean;
}

export interface StatsInputs<B extends CountGame = CountGame> {
  games: B[];
  /** Oldest first. */
  reads: CountRead[];
  logDays: GameDayPages[];
  /** The latest log entry of each game you stopped reading, which dates the
   *  stop when no date was given. */
  lastLogDates: ReadonlyMap<string, Date>;
}

export interface DayPages {
  day: string;
  pages: number;
}

export interface Pass<B extends CountGame = CountGame> {
  game: B;
  kind: "finished" | "stopped" | "open";
  /** When the pass ended: the finish date, or when a stopped game was put
   *  down. Null when that isn't known; such a pass counts in all time only. */
  date: Date | null;
  /** `date` as a day key in the reader's zone. */
  day: string | null;
  dateStarted: Date | null;
  /** The game had been finished before this pass. */
  isReread: boolean;
  rating: number | null;
  /** Counts toward Games read when it ends. */
  countsAsGame: boolean;
  /** Pages it adds when it ends: the whole game, or where a stopped game
   *  was put down. */
  wholePages: number;
  /** Pages logged during this pass, by day. */
  logged: DayPages[];
}

/** A pass counted in a window: what it adds there. */
export interface Counted<B extends CountGame = CountGame> {
  pass: Pass<B>;
  isReread: boolean;
  games: number;
  pages: number;
}

interface Draft {
  kind: Pass["kind"];
  date: Date | null;
  day: string | null;
  dateStarted: Date | null;
  startDay: string | null;
  rating: number | null;
  isReread: boolean;
  logged: DayPages[];
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
 * The archived pass that pages logged on `day` (before the current pass
 * began) belong to: the earliest finish on or after that day whose start
 * isn't after it, else an undated pass that could hold it (the most recent),
 * else the latest finish before it. Bounding by each pass's start keeps an
 * undated pass's pages from landing on a later dated one, where the undated
 * pass would then look unlogged and add its whole page count a second time.
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

/** Every pass through every game, with the rules applied: audiobooks left
 *  out or stripped of pages, stopped games dropped or counted as games. */
export function buildPasses<B extends CountGame>(
  { games, reads, logDays, lastLogDates }: StatsInputs<B>,
  rules: CountRules,
  timeZone: string,
): Pass<B>[] {
  const readsByGame = groupBy(reads, (r) => r.gameId);
  const logByGame = groupBy(logDays, (r) => r.gameId);
  const day = (d: Date | null) => (d ? calendarDay(d, timeZone) : null);
  const passes: Pass<B>[] = [];

  for (const game of games) {
    const audiobook = game.format === "AUDIOBOOK";
    if (audiobook && rules.statsAudiobooks === "out") continue;

    const archived: Draft[] = (readsByGame.get(game.id) ?? []).map((r) => ({
      kind: "finished",
      date: r.dateFinished,
      day: day(r.dateFinished),
      dateStarted: r.dateStarted,
      startDay: day(r.dateStarted),
      // A pass without its own rating falls back to the game's rating.
      rating: r.rating ?? game.rating,
      isReread: false,
      logged: [],
    }));

    // A stopped game is dated by its finish date when one was given, else
    // by its last log entry.
    const lastLog = game.status === "DNF" ? (lastLogDates.get(game.id) ?? null) : null;
    const current: Draft = {
      kind: game.status === "READ" ? "finished" : game.status === "DNF" ? "stopped" : "open",
      date:
        game.status === "READ" || game.status === "DNF" ? (game.dateFinished ?? lastLog) : null,
      day:
        game.status === "READ" || game.status === "DNF"
          ? (day(game.dateFinished) ?? (lastLog ? dayKey(lastLog, timeZone) : null))
          : null,
      dateStarted: game.dateStarted,
      startDay: day(game.dateStarted),
      rating: game.rating,
      isReread: false,
      logged: [],
    };

    // Re-reads: dated finishes by the existing rule (an undated past read
    // is presumed to come first). The first undated archived pass is the
    // first read; any pass after an archived one is a re-read.
    const dated = [...archived, current].filter((p) => p.kind === "finished" && p.date);
    const hasUndated = archived.some((p) => !p.date);
    for (const m of markRereads(
      dated.map((p) => ({ gameId: game.id, dateFinished: p.date!, p })),
      hasUndated ? new Set([game.id]) : new Set<string>(),
    )) {
      m.p.isReread = m.isReread;
    }
    archived
      .filter((p) => !p.date)
      .forEach((p, i) => {
        p.isReread = i > 0;
      });
    if (!current.date || current.kind !== "finished") current.isReread = archived.length > 0;

    for (const row of logByGame.get(game.id) ?? []) {
      const pass = row.current ? current : (archivedPassFor(archived, row.day) ?? current);
      pass.logged.push({ day: row.day, pages: row.pages });
    }

    const noPages = audiobook && rules.statsAudiobooks === "games";
    for (const p of [...archived, current]) {
      if (p.kind === "stopped" && rules.statsStoppedGames === "none") continue;
      let wholePages = 0;
      if (p.kind === "finished") wholePages = game.pageCount ?? 0;
      if (p.kind === "stopped") {
        const logged = p.logged.reduce((sum, l) => sum + l.pages, 0);
        wholePages = Math.min(game.currentPage ?? logged, game.pageCount ?? Infinity);
      }
      passes.push({
        game,
        kind: p.kind,
        date: p.date,
        day: p.day,
        dateStarted: p.dateStarted,
        isReread: p.isReread,
        rating: p.rating,
        countsAsGame:
          p.kind === "finished" || (p.kind === "stopped" && rules.statsStoppedGames === "game"),
        wholePages: noPages ? 0 : wholePages,
        logged: noPages ? [] : p.logged,
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
 * Pages are the whole game when it ends there, or with "Pages I logged" the
 * pages logged on days in the window, plus the whole game for a pass that
 * ends there with nothing logged (a game finished without logging still
 * adds its page count). Passes adding nothing are left out.
 */
export function countWindow<B extends CountGame>(
  passes: Pass<B>[],
  window: DayWindow,
  rules: Pick<CountRules, "statsPagesRead">,
): Counted<B>[] {
  const counted: Counted<B>[] = [];
  for (const pass of passes) {
    const endsHere = pass.kind !== "open" && inWindow(pass.day, window);
    const games = endsHere && pass.countsAsGame ? 1 : 0;
    let pages = 0;
    if (rules.statsPagesRead === "logged") {
      for (const l of pass.logged) if (inWindow(l.day, window)) pages += l.pages;
      if (endsHere && pass.logged.length === 0) pages += pass.wholePages;
    } else if (endsHere) {
      pages = pass.wholePages;
    }
    if (games > 0 || pages > 0) counted.push({ pass, isReread: pass.isReread, games, pages });
  }
  return counted;
}

/** Totals for a window's counted passes. */
export function tally(items: Counted[]): {
  games: number;
  pages: number;
  /** Finished re-reads among the games. */
  rereads: number;
  /** Stopped games counted as games. */
  putDown: number;
} {
  let games = 0;
  let pages = 0;
  let rereads = 0;
  let putDown = 0;
  for (const i of items) {
    games += i.games;
    pages += i.pages;
    if (i.games > 0 && i.pass.kind === "finished" && i.isReread) rereads++;
    if (i.games > 0 && i.pass.kind === "stopped") putDown++;
  }
  return { games, pages, rereads, putDown };
}

/** All-time Games read: games on the Read shelf (each once, however many
 *  times read), plus stopped games when they count as games. */
export function gamesReadAllTime(
  games: Pick<CountGame, "status" | "format">[],
  rules: Pick<CountRules, "statsStoppedGames" | "statsAudiobooks">,
): { games: number; putDown: number } {
  let read = 0;
  let putDown = 0;
  for (const b of games) {
    if (rules.statsAudiobooks === "out" && b.format === "AUDIOBOOK") continue;
    if (b.status === "READ") read++;
    if (b.status === "DNF" && rules.statsStoppedGames === "game") putDown++;
  }
  return { games: read + putDown, putDown };
}

/**
 * Which rules are on, for the stat cards: a suffix for the Pages read label
 * and small notes under the numbers ("includes 2 re-reads").
 */
export function ruleNotes(
  rules: CountRules,
  counts: { rereads?: number; putDown?: number } = {},
  fmt: (n: number) => string = String,
): { pagesSuffix: string; pages: string[]; games: string[] } {
  const pages: string[] = [];
  if (rules.statsPagesRead === "finished") pages.push("whole games when finished");
  if (rules.statsStoppedGames !== "none") pages.push("includes pages of games you stopped");
  if (rules.statsAudiobooks === "games") pages.push("no audiobook pages");
  if (rules.statsAudiobooks === "out") pages.push("audiobooks left out");

  const games: string[] = [];
  const { rereads = 0, putDown = 0 } = counts;
  if (rereads > 0) games.push(`includes ${fmt(rereads)} ${rereads === 1 ? "re-read" : "re-reads"}`);
  if (putDown > 0) games.push(`includes ${fmt(putDown)} put down`);
  if (rules.statsAudiobooks === "out") games.push("audiobooks left out");

  return {
    pagesSuffix: rules.statsPagesRead === "logged" ? " · as logged" : "",
    pages,
    games,
  };
}

/** The goal card's footnote on what a pages goal counts. */
export function goalRuleLine(rules: Pick<CountRules, "statsPagesRead">): string {
  return rules.statsPagesRead === "logged"
    ? "A pages goal counts the pages you log, plus whole games you finish without logging."
    : "A pages goal adds up the page counts of the games you finish.";
}
