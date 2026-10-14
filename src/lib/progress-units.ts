import { formatNumber, type FormatPrefs } from "@/lib/display";
import type { QuickLogSteps } from "@/lib/preferences";

/**
 * Time played, the one unit progress has. A position is the minutes played
 * so far in the current playthrough (Game.playedMinutes,
 * ProgressEntry.minutes), so the play log, stats and goals all count the
 * same thing. Input boxes show it clock style ("12:30"); running text
 * spells it out ("12 h 30 min").
 *
 * A game's time to beat (Game.lengthMinutes) is only ever a yardstick:
 * time played can run past it, and nothing here refuses or clamps a time
 * for being longer than the usual.
 */

/**
 * Time typed by a player, in minutes, or null when it isn't a time.
 *
 * - "12:30" is clock style, and "12:30:45" too, as many save screens show
 *   play time to the second (the seconds round to the nearest minute).
 * - "12.30" and "12,30" also work, so a phone's decimal keypad is enough,
 *   but only with two minute digits: "5.5" would otherwise mean 5:05 to us
 *   and five and a half hours to the player.
 * - Hours with an "h" may be decimal: "1.5h" and "1,5 h" are 1:30.
 * - "12h 30m", "12h30", "12 hours", "45m", "45 min" and a bare "90"
 *   (minutes) work as well.
 */
export function parseDuration(text: string): number | null {
  const s = text.trim().toLowerCase();
  let m: RegExpExecArray | null;
  if ((m = /^(\d{1,5}):([0-5]?\d)(?::([0-5]\d))?$/.exec(s))) {
    return Number(m[1]) * 60 + Number(m[2]) + Math.round(Number(m[3] ?? 0) / 60);
  }
  if ((m = /^(\d{1,5})[.,]([0-5]\d)$/.exec(s))) {
    return Number(m[1]) * 60 + Number(m[2]);
  }
  if ((m = /^(\d{1,5})[.,](\d{1,2})\s*h(?:ours?|rs?)?$/.exec(s))) {
    return Math.round(Number(`${m[1]}.${m[2]}`) * 60);
  }
  if ((m = /^(\d{1,5})\s*h(?:ours?|rs?)?(?:\s*([0-5]?\d)\s*(?:m(?:in(?:ute)?s?)?)?)?$/.exec(s))) {
    return Number(m[1]) * 60 + Number(m[2] ?? 0);
  }
  if ((m = /^(\d{1,6})\s*m(?:in(?:ute)?s?)?$/.exec(s)) || (m = /^(\d{1,6})$/.exec(s))) {
    return Number(m[1]);
  }
  return null;
}

/** A time as an input box shows it: 750 → "12:30", 5 → "0:05". */
export function formatDuration(minutes: number): string {
  const m = Math.max(Math.round(minutes), 0);
  return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")}`;
}

/** A time in running text: "12 h 30 min", "45 min", "3 h". */
export function formatPlaytime(minutes: number): string {
  const total = Math.max(Math.round(minutes), 0);
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (h === 0) return `${m} min`;
  return m === 0 ? `${h} h` : `${h} h ${m} min`;
}

/**
 * A total of time played, for a summary: exact while it is short ("45 min",
 * "3 h 20 min"), whole hours once there are enough of them that the
 * minutes stop mattering ("312 hours", "1,204 hours").
 */
export function formatHoursPlayed(minutes: number, prefs?: FormatPrefs): string {
  if (minutes < 10 * 60) return formatPlaytime(minutes);
  return `${formatNumber(Math.round(minutes / 60), prefs)} hours`;
}

/** A time to beat in running text: "about 40 h". */
export function aboutLength(lengthMinutes: number): string {
  return `about ${formatPlaytime(lengthMinutes)}`;
}

/**
 * How far through the usual time to beat a game is, for a progress bar:
 * 0–100, or null when the time to beat isn't known. Never 100 before the
 * time is reached and never 0 once anything is played, so a bar always
 * says "started" and "not quite"; past the time to beat it stays full.
 */
export function progressPercent(playedMinutes: number, lengthMinutes: number | null): number | null {
  if (!lengthMinutes) return null;
  if (playedMinutes >= lengthMinutes) return 100;
  if (playedMinutes <= 0) return 0;
  return Math.min(Math.max(Math.round((playedMinutes / lengthMinutes) * 100), 1), 99);
}

/**
 * The line under a progress bar: "12 h 30 min of about 40 h · 31%",
 * "45 h 10 min · past the usual 40 h", or "12 h 30 min played" when the
 * time to beat isn't known.
 */
export function progressFigure(playedMinutes: number, lengthMinutes: number | null): string {
  const played = formatPlaytime(playedMinutes);
  if (!lengthMinutes) return `${played} played`;
  if (playedMinutes > lengthMinutes) return `${played} · past the usual ${formatPlaytime(lengthMinutes)}`;
  return `${played} of ${aboutLength(lengthMinutes)} · ${progressPercent(playedMinutes, lengthMinutes)}%`;
}

/** The same line once the playthrough is completed, where a share of the
 *  usual time means little: "Completed in 42 h", with the usual time beside
 *  it when it's known ("Completed in 35 h · usually about 40 h"). */
export function completedFigure(playedMinutes: number, lengthMinutes: number | null): string {
  const took = `Completed in ${formatPlaytime(playedMinutes)}`;
  return lengthMinutes ? `${took} · usually ${aboutLength(lengthMinutes)}` : took;
}

/** What a time box holds for a stored time: "12:30", or empty for none. */
export function boxText(minutes: number | null): string {
  return minutes == null ? "" : formatDuration(minutes);
}

export type ParsedTime = { minutes: number } | { error: string };

/** The hint after a time that can't be read, shared with the forms. */
export const TIME_EXAMPLE = "Type a time, like 12:30, 12h 30m or 45m.";

/** What's typed in a time box, in minutes, or why it can't be saved. Null
 *  when the box is empty. */
export function parseTimeText(text: string): ParsedTime | null {
  const s = text.trim();
  if (!s) return null;
  const minutes = parseDuration(s);
  return minutes === null ? { error: TIME_EXAMPLE } : { minutes };
}

export interface LogStep {
  /** Minutes to add. */
  amount: number;
  label: string;
  ariaLabel: string;
}

const STEP_MINUTES: Record<QuickLogSteps, [number, number]> = {
  "30m-1h": [30, 60],
  "1h-2h": [60, 120],
  "15m-30m": [15, 30],
};

function stepAria(minutes: number): string {
  if (minutes === 60) return "Add an hour";
  if (minutes % 60 === 0) return `Add ${minutes / 60} hours`;
  return `Add ${minutes} minutes`;
}

/** The two step buttons next to the time box (Preferences > Quick log):
 *  "+30 min" and "+1 h", say. */
export function stepsFor(choice: QuickLogSteps): LogStep[] {
  const amounts = STEP_MINUTES[choice] ?? STEP_MINUTES["30m-1h"];
  return amounts.map((amount) => ({
    amount,
    label: `+${formatPlaytime(amount)}`,
    ariaLabel: stepAria(amount),
  }));
}

/** The box's text after a step button: the step added to what's typed, or
 *  to the time played so far when nothing valid is. */
export function addStep(text: string, step: number, playedMinutes: number | null): string {
  const typed = parseTimeText(text);
  const base = typed && "minutes" in typed ? typed.minutes : (playedMinutes ?? 0);
  return formatDuration(base + step);
}
