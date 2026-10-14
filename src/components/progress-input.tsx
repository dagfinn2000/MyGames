"use client";

import { useEffect, useRef, useState } from "react";
import {
  aboutLength,
  boxText,
  parseTimeText,
  progressPercent,
} from "@/lib/progress-units";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/**
 * The time box: time played so far, typed clock style ("12:30") or any way
 * parseDuration reads ("12h 30m", "45 min", "1.5h"). Controlled: the
 * caller keeps the text, so the step buttons and a reset after logging are
 * plain state changes, and the box never remounts under a keyboard user.
 *
 * Split in two so the quick-log row can keep the box inline and put the
 * note (why the text can't be saved) under the whole row: TimeField is the
 * box and its suffix, TimeNotes the line under it. Both take the same `id`.
 */

/** "of about 40 h · 31%" after the box, when the time to beat is known. */
function suffixText(minutes: number | null, lengthMinutes: number | null): string | null {
  if (!lengthMinutes) return null;
  const pct = minutes != null ? ` · ${progressPercent(minutes, lengthMinutes)}%` : "";
  return `of ${aboutLength(lengthMinutes)}${pct}`;
}

export function TimeField({
  id,
  text,
  onTextChange,
  lengthMinutes = null,
  inputRef,
  compact = false,
  name,
  ariaLabel,
}: {
  id: string;
  text: string;
  onTextChange: (text: string) => void;
  /** The game's time to beat, for "of about 40 h · 31%". */
  lengthMinutes?: number | null;
  inputRef?: React.RefObject<HTMLInputElement | null>;
  /** The quick row: no "of about 40 h" (the figure above says it). */
  compact?: boolean;
  /** For a box inside a form, which then sends the text as typed. */
  name?: string;
  /** For a box without a visible label. */
  ariaLabel?: string;
}) {
  const ownRef = useRef<HTMLInputElement>(null);
  const ref = inputRef ?? ownRef;
  const parsed = parseTimeText(text);
  const error = parsed && "error" in parsed ? parsed.error : null;
  const minutes = parsed && "minutes" in parsed ? parsed.minutes : null;
  const suffix = compact ? null : suffixText(minutes, lengthMinutes);

  // An invalid box blocks the play form's Save rather than letting the
  // server refuse the whole form over it.
  useEffect(() => {
    ref.current?.setCustomValidity(error ?? "");
  }, [ref, error]);

  const describedBy = [suffix && `${id}-of`, `${id}-notes`].filter(Boolean).join(" ");

  return (
    <span className="inline-flex items-center gap-1.5">
      <Input
        id={id}
        ref={ref}
        name={name}
        value={text}
        onChange={(e) => onTextChange(e.target.value)}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        aria-label={ariaLabel}
        autoComplete="off"
        type="text"
        // A phone's decimal keypad is enough: "12.30" reads as 12:30.
        inputMode="decimal"
        placeholder="h:mm"
        className="w-24"
      />
      {suffix && (
        <span id={`${id}-of`} className="text-sm text-muted-foreground tabular-nums">
          {suffix}
        </span>
      )}
    </span>
  );
}

/** The line under a time box: why the text can't be saved. Always there
 *  (and empty takes no room), so the box can point at it. */
export function TimeNotes({
  id,
  text,
  className,
}: {
  id: string;
  text: string;
  className?: string;
}) {
  const parsed = parseTimeText(text);
  return (
    <div id={`${id}-notes`} className={cn("grid gap-0.5 text-xs empty:hidden", className)}>
      {parsed && "error" in parsed && <p className="text-destructive">{parsed.error}</p>}
    </div>
  );
}

/**
 * The play form's time field, for any status but Playing (which logs
 * through the quick row instead): how long this playthrough took, or how
 * far you got before stopping. Sent as typed; the server reads it the same
 * way (lib/validation.ts), and an empty box clears the time.
 */
export function PlayedTimeField({
  initialMinutes,
  lengthMinutes,
}: {
  initialMinutes: number | null;
  lengthMinutes: number | null;
}) {
  const [text, setText] = useState(() => boxText(initialMinutes));
  return (
    <div className="grid content-start gap-2">
      <Label htmlFor="playedMinutes">Time played</Label>
      <TimeField
        id="playedMinutes"
        name="playedMinutes"
        text={text}
        onTextChange={setText}
        lengthMinutes={lengthMinutes}
      />
      <TimeNotes id="playedMinutes" text={text} className="max-w-56" />
    </div>
  );
}
