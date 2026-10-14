import type { HeatmapScale } from "@/lib/preferences";
import { formatPlaytime } from "@/lib/progress-units";

/**
 * Colour steps for the play calendar, in minutes played: a day with at
 * least t[0] gets the second shade, t[1] the third, t[2] the darkest. Any
 * play at all gets the first shade.
 */
export type Thresholds = [number, number, number];

/** The named scales, also what Preferences describes them with. */
export const HEATMAP_STEPS: Record<Exclude<HeatmapScale, "auto">, Thresholds> = {
  standard: [30, 60, 120],
  gentle: [15, 30, 60],
  heavy: [60, 120, 240],
};

/** To the nearest 5 minutes, at least 5: steps a legend can say plainly. */
function roundStep(minutes: number): number {
  return Math.max(5, Math.round(minutes / 5) * 5);
}

/**
 * The steps for a scale. "auto" centres them on the player's own typical
 * day — the median of the days they played at all — so a calendar that is
 * almost all one shade on a fixed scale shows its variation again: half the
 * typical day, the typical day, twice the typical day.
 */
export function heatmapThresholds(
  scale: HeatmapScale,
  dayTotals: Iterable<number>,
): Thresholds {
  if (scale !== "auto") return HEATMAP_STEPS[scale] ?? HEATMAP_STEPS.standard;
  const days = [...dayTotals].filter((m) => m > 0).sort((a, b) => a - b);
  if (days.length === 0) return HEATMAP_STEPS.standard;
  const median = days[Math.floor(days.length / 2)];
  const half = roundStep(median / 2);
  const typical = Math.max(half + 5, roundStep(median));
  return [half, typical, Math.max(typical + 5, roundStep(median * 2))];
}

/** 0 = not played that day, 1–4 = the shades. */
export function heatmapLevel(minutes: number, t: Thresholds): number {
  if (minutes <= 0) return 0;
  if (minutes < t[0]) return 1;
  if (minutes < t[1]) return 2;
  if (minutes < t[2]) return 3;
  return 4;
}

/** Tooltip for each legend shade, lightest first. */
export function heatmapLegend(t: Thresholds): string[] {
  const [a, b, c] = t.map(formatPlaytime);
  return ["Not played", `Under ${a}`, `${a} to ${b}`, `${b} to ${c}`, `${c} or more`];
}
