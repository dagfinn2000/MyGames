"use client";

import { useEffect, useId, useRef, useState, useTransition } from "react";
import { logTime, moveFromPlaying } from "@/lib/actions/progress";
import { celebrate } from "@/lib/confetti";
import { calendarDay, dayKey, shiftDayKey } from "@/lib/dates";
import { addStep, boxText, parseTimeText, stepsFor } from "@/lib/progress-units";
import { recentDays, type MoveResult } from "@/lib/play-log";
import { cn } from "@/lib/utils";
import { usePreferences } from "@/components/preferences-provider";
import { TimeField, TimeNotes } from "@/components/progress-input";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export interface QuickLogGame {
  id: string;
  title: string;
  playedMinutes: number | null;
  dateStarted: Date | null;
}

export type MovedResult = Extract<MoveResult, { ok: true }>;

/**
 * The quick-log row for a game being played: the time played so far, two
 * step buttons that add a session's worth to it, which day, and Log. On
 * Now playing it also has Finished and Stopped.
 *
 * Reaching the game's usual time to beat asks nothing: plenty of players
 * play on past it, and Finished is right there when they're done.
 *
 * Its own form, outside the playing card's, so Enter in the box logs and
 * none of these buttons can submit the play form.
 */
export function QuickLog({
  game,
  showMoveButtons = false,
  onMoved,
  autoFocus = false,
}: {
  game: QuickLogGame;
  /** Finished and Stopped, for Now playing. */
  showMoveButtons?: boolean;
  onMoved?: (result: MovedResult) => void;
  /** Focus the box on mount (a row brought back by Undo). */
  autoFocus?: boolean;
}) {
  const prefs = usePreferences();
  const steps = stepsFor(prefs.quickLogSteps);
  const id = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  // Null while the box just shows the time played so far; text once typed in.
  const [draft, setDraft] = useState<string | null>(null);
  const [day, setDay] = useState("today");
  const [otherDay, setOtherDay] = useState("");
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);
  const [pending, startTransition] = useTransition();

  const text = draft ?? boxText(game.playedMinutes);
  const today = dayKey(new Date(), prefs.timeZone);
  const startKey = game.dateStarted ? calendarDay(game.dateStarted, prefs.timeZone) : null;
  const { days, more } = recentDays(today, startKey, prefs.dateFormat);

  useEffect(() => {
    if (autoFocus) inputRef.current?.focus();
  }, [autoFocus]);

  function fail(text: string) {
    setMessage({ text, error: true });
  }

  function log() {
    const parsed = parseTimeText(text);
    if (!parsed) return fail("Type how long you've played first.");
    if ("error" in parsed) return fail(parsed.error);
    if (parsed.minutes < 1) return fail("Log at least a minute.");
    const when = day === "other" ? otherDay : day;
    if (!when) return fail("Pick a day.");

    startTransition(async () => {
      const result = await logTime(game.id, { minutes: parsed.minutes, day: when });
      if ("error" in result) return fail(result.error);
      setDraft(null);
      setDay("today");
      setMessage({ text: result.message, error: false });
    });
  }

  function move(to: "COMPLETED" | "DROPPED", origin: HTMLElement) {
    setMessage(null);
    startTransition(async () => {
      const result = await moveFromPlaying(game.id, to);
      if ("error" in result) return fail(result.error);
      // Before the row goes away with the move.
      if (result.finished) celebrate(origin);
      onMoved?.(result);
    });
  }

  return (
    <div>
      <div className="grid gap-2">
        <form
          noValidate
          aria-label={`Log time for ${game.title}`}
          onSubmit={(e) => {
            e.preventDefault();
            log();
          }}
          className="flex flex-wrap items-center gap-2"
        >
          <Label htmlFor={id}>Time played</Label>
          <TimeField id={id} text={text} onTextChange={setDraft} inputRef={inputRef} compact />
          {steps.map((s) => (
            <Button
              key={s.label}
              type="button"
              variant="outline"
              aria-label={s.ariaLabel}
              onClick={() => setDraft(addStep(text, s.amount, game.playedMinutes))}
            >
              {s.label}
            </Button>
          ))}
          {days.length > 1 && (
            <Select
              value={day}
              onValueChange={(v) => {
                setDay(v);
                if (v === "other" && !otherDay) setOtherDay(shiftDayKey(today, -4));
              }}
            >
              <SelectTrigger aria-label="Which day">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {days.map((d) => (
                  <SelectItem key={d.value} value={d.value}>
                    {d.label}
                  </SelectItem>
                ))}
                {more && <SelectItem value="other">Another day…</SelectItem>}
              </SelectContent>
            </Select>
          )}
          {day === "other" && (
            <Input
              type="date"
              aria-label="Day"
              className="w-40"
              min={startKey ?? undefined}
              max={today}
              value={otherDay}
              onChange={(e) => setOtherDay(e.target.value)}
            />
          )}
          <Button type="submit" disabled={pending}>
            {pending ? "Logging…" : "Log"}
          </Button>
          {showMoveButtons && (
            <span className="ml-auto flex gap-1">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={pending}
                onClick={(e) => move("COMPLETED", e.currentTarget)}
              >
                Finished
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={pending}
                onClick={(e) => move("DROPPED", e.currentTarget)}
              >
                Stopped
              </Button>
            </span>
          )}
        </form>
        <TimeNotes id={id} text={text} />
      </div>
      {/* Outside the grid so it takes no room while empty, and always
          there, so a new message is announced. */}
      <p
        aria-live="polite"
        className={cn(
          "text-sm not-empty:mt-2",
          message?.error ? "text-destructive" : "text-muted-foreground",
        )}
      >
        {message?.text}
      </p>
    </div>
  );
}
