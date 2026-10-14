"use client";

import { useState } from "react";
import { Input } from "@/components/ui/input";

/** Splits a stored time to beat ("2400") into hour and minute box values. */
function split(initial: string | undefined): [string, string] {
  const total = Number(initial);
  if (!initial || !Number.isInteger(total) || total <= 0) return ["", ""];
  return [String(Math.floor(total / 60)), String(total % 60)];
}

/**
 * How long the game usually takes to beat, as hours and minutes, sent as
 * one hidden `lengthMinutes` value. Both boxes empty is "not known". The
 * boxes are controlled so a form reset after a failed save can't leave them
 * showing something other than what gets sent. To put a new value in from
 * outside (the catalogue's "Look up details"), remount it with a new key.
 */
export function TimeToBeatField({ initialMinutes }: { initialMinutes?: string }) {
  const [initialHours, initialMins] = split(initialMinutes);
  const [hours, setHours] = useState(initialHours);
  const [minutes, setMinutes] = useState(initialMins);

  const h = Number(hours) || 0;
  const m = Number(minutes) || 0;
  const total = Math.round(h * 60 + m);

  return (
    <fieldset>
      <legend className="mb-2 text-sm font-medium">Time to beat</legend>
      <div className="flex items-center gap-2">
        <Input
          type="number"
          inputMode="numeric"
          aria-label="Hours"
          min={0}
          max={1000}
          className="w-20"
          value={hours}
          onChange={(e) => setHours(e.target.value)}
        />
        <span className="text-sm text-muted-foreground" aria-hidden="true">
          h
        </span>
        <Input
          type="number"
          inputMode="numeric"
          aria-label="Minutes"
          min={0}
          max={59}
          className="w-16"
          value={minutes}
          onChange={(e) => setMinutes(e.target.value)}
        />
        <span className="text-sm text-muted-foreground" aria-hidden="true">
          min
        </span>
      </div>
      <input type="hidden" name="lengthMinutes" value={total > 0 ? total : ""} />
    </fieldset>
  );
}
