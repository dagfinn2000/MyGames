import type { LucideIcon } from "lucide-react";
import { formatNumber, type FormatPrefs } from "@/lib/display";
import { Card, CardContent } from "@/components/ui/card";

/** The filled part of a bar, `value` against `max`; at least a sliver
 *  whenever there is a max, so every row reads as a bar. */
function Track({ value, max, pale = false }: { value: number; max: number; pale?: boolean }) {
  const pct = max > 0 ? Math.max((value / max) * 100, 2) : 0;
  return (
    <div className={pale ? "h-1.5 rounded-full bg-muted" : "h-2.5 rounded-full bg-muted"}>
      <div
        className={`bar-grow h-full rounded-full bg-linear-to-r ${pale ? "from-primary/35 to-primary/55" : "from-primary/70 to-primary"}`}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

/**
 * Simple horizontal CSS bar — no chart library needed at this scale.
 * `display` replaces the plain number at the end when the value needs a
 * unit ("42 h"); the column is a little wider then to fit it. `hours` adds
 * a column after the number for the time played on the row's games, as
 * the breakdown cards show it (headed by BarHeader).
 */
export function Bar({
  label,
  value,
  max,
  display,
  hours,
  wide = false,
}: {
  label: string;
  value: number;
  max: number;
  display?: string;
  hours?: string;
  /** A wider label, for game titles rather than short names. */
  wide?: boolean;
}) {
  const columns = wide
    ? "grid-cols-[minmax(0,11rem)_1fr_4rem]"
    : hours !== undefined
      ? "grid-cols-[7rem_1fr_2.5rem_3.5rem]"
      : display === undefined
        ? "grid-cols-[7rem_1fr_2.5rem]"
        : "grid-cols-[7rem_1fr_4rem]";
  return (
    <div className={`grid items-center gap-2 text-sm ${columns}`}>
      <span className="truncate text-muted-foreground">{label}</span>
      <Track value={value} max={max} />
      <span className="text-right tabular-nums">{display ?? value}</span>
      {hours !== undefined && (
        <span className="text-right text-muted-foreground tabular-nums">{hours}</span>
      )}
    </div>
  );
}

/** Column headings over bars that carry an Hours column: what the number
 *  counts, and the hours. */
export function BarHeader({ count }: { count: string }) {
  return (
    <div
      className="grid grid-cols-[7rem_1fr_2.5rem_3.5rem] gap-2 text-xs text-muted-foreground"
      aria-hidden="true"
    >
      <span className="col-start-3 text-right">{count}</span>
      <span className="text-right">Hours</span>
    </div>
  );
}

/**
 * Two bars under one label, the second thinner and paler: a year's games
 * completed above its hours played. Each bar has its own max, so both
 * scales use the full width.
 */
export function BarPair({
  label,
  first,
  second,
}: {
  label: string;
  first: { value: number; max: number; display: string };
  second: { value: number; max: number; display: string };
}) {
  return (
    <div className="grid grid-cols-[7rem_1fr_4rem] items-center gap-x-2 gap-y-1 text-sm">
      <span className="row-span-2 truncate text-muted-foreground">{label}</span>
      <Track value={first.value} max={first.max} />
      <span className="text-right tabular-nums">{first.display}</span>
      <Track value={second.value} max={second.max} pale />
      <span className="text-right text-xs text-muted-foreground tabular-nums">{second.display}</span>
    </div>
  );
}

/** Time played at the end of a bar, where space is short: "42 h", "1,204 h",
 *  or "45 min" for less than an hour. */
export function barHours(minutes: number, prefs?: FormatPrefs): string {
  return minutes < 60
    ? `${Math.max(Math.round(minutes), 0)} min`
    : `${formatNumber(Math.round(minutes / 60), prefs)} h`;
}

export function StatCard({
  label,
  icon: Icon,
  note,
  children,
}: {
  label: string;
  /** A small picture of what is counted, in a tinted circle by the label. */
  icon?: LucideIcon;
  /** A small line under the number: which rule is on, what it includes. */
  note?: string;
  children: React.ReactNode;
}) {
  return (
    <Card>
      <CardContent className="pt-0">
        <div className="flex items-start justify-between gap-2">
          <p className="text-sm text-muted-foreground">{label}</p>
          {Icon && (
            <span className="grid size-7 shrink-0 place-items-center rounded-full bg-primary/10 text-primary">
              <Icon className="size-3.5" aria-hidden="true" />
            </span>
          )}
        </div>
        <div className="mt-1 font-heading text-3xl font-semibold tracking-tight tabular-nums">
          {children}
        </div>
        {note && <p className="mt-1 text-xs text-muted-foreground">{note}</p>}
      </CardContent>
    </Card>
  );
}

/**
 * A total of time played as a stat card's big number, with the numbers
 * large and the units small so it fits a narrow card: "312 hours", or
 * "3 h 20 min" and "45 min" while it's short. The same rule as
 * formatHoursPlayed in lib/progress-units.ts.
 */
export function HoursValue({ minutes, prefs }: { minutes: number; prefs?: FormatPrefs }) {
  const total = Math.max(Math.round(minutes), 0);
  const parts: [string, string][] =
    total >= 10 * 60
      ? [[formatNumber(Math.round(total / 60), prefs), "hours"]]
      : total >= 60
        ? [
            [String(Math.floor(total / 60)), "h"],
            ...(total % 60 > 0 ? [[String(total % 60), "min"] as [string, string]] : []),
          ]
        : [[String(total), "min"]];
  return (
    <>
      {parts.map(([n, unit], i) => (
        <span key={unit}>
          {i > 0 && " "}
          {n}
          <span className="text-base font-normal text-muted-foreground"> {unit}</span>
        </span>
      ))}
    </>
  );
}
