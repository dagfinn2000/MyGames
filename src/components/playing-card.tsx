"use client";

import { useActionState, useEffect, useRef } from "react";
import type { Game, ProgressEntry } from "@prisma/client";
import { PlayStatus } from "@prisma/client";
import { updatePlay } from "@/lib/actions/games";
import { celebrate } from "@/lib/confetti";
import { STATUS_LABELS, toDateInputValue } from "@/lib/display";
import { usePreferences } from "@/components/preferences-provider";
import { currentPassEntries } from "@/lib/progress";
import { completedFigure, progressFigure, progressPercent } from "@/lib/progress-units";
import { submitKeepingInput } from "@/lib/submit-form";
import { ProgressChart, ProgressLog } from "@/components/progress-log";
import { FinishedDateField } from "@/components/finished-date-field";
import { PlayedTimeField } from "@/components/progress-input";
import { QuickLog } from "@/components/quick-log";
import { StarRatingInput } from "@/components/star-rating-input";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

/**
 * "My playthrough", the game's own panel on the detail page. On top,
 * progress: the time played (as a share of the usual time to beat when
 * that's known), the quick-log row while the game is being played, and the
 * sparkline and pace drawn from the automatic play log. Then the form for
 * status, star rating, dates and the personal review, which saves through
 * the updatePlay server action, and the log itself.
 *
 * While the game is Playing, time is logged only through the quick row
 * (its own form, outside this one), and the play form sends no time at
 * all, so the server keeps the time it has (updatePlay) and saving a
 * review never moves progress. Any other status keeps a time box in the
 * form: how long a completed playthrough took, or where a dropped one
 * stopped.
 */
export function PlayingCard({
  game,
  progress,
}: {
  /** Without the folded search copies, which have no business in the page. */
  game: Omit<Game, "searchText" | "reviewSearchText">;
  progress: ProgressEntry[];
}) {
  const action = updatePlay.bind(null, game.id);
  const [state, formAction, pending] = useActionState(action, {});
  const prefs = usePreferences();
  const saveButton = useRef<HTMLButtonElement>(null);
  const playing = game.status === PlayStatus.PLAYING;
  const completed = game.status === PlayStatus.COMPLETED;

  // Finishing a game gets a burst of confetti from the save button. Each
  // save returns a new state object, so this runs once per save.
  useEffect(() => {
    if (state.finished) celebrate(saveButton.current);
  }, [state]);

  // Remount the form whenever the server-side play data changes. A save
  // leaves the fields as they were sent (submitKeepingInput), so a failed
  // one keeps the review being typed; but the server may have saved
  // something else (Completed fills in today's finish date), and a fresh
  // mount re-reads every default from the just-saved game. It also keeps
  // the Radix Select honest: its hidden native select reverts to its
  // *mount-time* value whenever the form is reset, behind React's back.
  // When nothing changed the key is stable and the form stays put. A quick
  // log changes the time played of a game being played without touching
  // the form, so then the time is left out: logging must not remount the
  // form and throw away a review being typed.
  const formKey = [
    game.status,
    game.rating ?? 0,
    game.dateStarted?.getTime() ?? 0,
    game.dateFinished?.getTime() ?? 0,
    playing ? "playing" : (game.playedMinutes ?? 0),
    game.review ?? "",
  ].join("|");

  // The sparkline shows the current playthrough; entries from earlier ones
  // still feed the stats heatmap and stay in the log below.
  const passEntries = currentPassEntries(progress, game.dateStarted, prefs.timeZone);
  const played = game.playedMinutes;
  // A bar only against a known time to beat (full once past it), and not
  // for a completed playthrough, which took what it took.
  const pct = played != null && !completed ? progressPercent(played, game.lengthMinutes) : null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>My playthrough</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-4">
        {(played != null || playing || passEntries.length >= 2) && (
          <div className="grid gap-3">
            {played != null && (
              <div className="grid max-w-sm gap-1">
                {pct !== null && (
                  <div className="h-2 rounded-full bg-muted">
                    <div
                      className="bar-grow h-full rounded-full bg-primary/80"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                )}
                <p className="text-xs text-muted-foreground tabular-nums">
                  {completed
                    ? completedFigure(played, game.lengthMinutes)
                    : progressFigure(played, game.lengthMinutes)}
                </p>
              </div>
            )}
            {playing && <QuickLog game={game} />}
            <ProgressChart
              entries={passEntries}
              status={game.status}
              lengthMinutes={game.lengthMinutes}
            />
          </div>
        )}

        <form
          key={formKey}
          action={formAction}
          onSubmit={submitKeepingInput(formAction)}
          className="grid gap-4"
        >
          <div className="flex flex-wrap items-end gap-4">
            <div className="grid gap-2">
              <Label htmlFor="status">Status</Label>
              <Select name="status" defaultValue={game.status}>
                <SelectTrigger id="status" className="w-44">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.values(PlayStatus).map((s) => (
                    <SelectItem key={s} value={s}>
                      {STATUS_LABELS[s]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label>Rating</Label>
              <StarRatingInput name="rating" defaultValue={game.rating ?? 0} />
            </div>
          </div>

          <div className="flex flex-wrap gap-4">
            <div className="grid gap-2">
              <Label htmlFor="dateStarted">Started</Label>
              <Input
                id="dateStarted"
                name="dateStarted"
                type="date"
                className="w-40"
                defaultValue={toDateInputValue(game.dateStarted, prefs.timeZone)}
              />
            </div>
            <FinishedDateField
              defaultDate={toDateInputValue(game.dateFinished, prefs.timeZone)}
              defaultUnknown={game.status === PlayStatus.COMPLETED && !game.dateFinished}
            />
            {/* Left out while Playing: a form with no time keeps the
                time the server has, whatever another tab logged since. */}
            {!playing && (
              <PlayedTimeField
                initialMinutes={game.playedMinutes}
                lengthMinutes={game.lengthMinutes}
              />
            )}
          </div>

          <div className="grid gap-2">
            <Label htmlFor="review">Review / notes</Label>
            <Textarea
              id="review"
              name="review"
              rows={5}
              className="long-text"
              placeholder="What did you think?"
              defaultValue={game.review ?? ""}
            />
          </div>

          {state.error && <p className="text-sm text-destructive">{state.error}</p>}
          <div className="flex items-center gap-3">
            <Button ref={saveButton} type="submit" disabled={pending}>
              {pending ? "Saving…" : "Save"}
            </Button>
            {state.success && (
              <span className="text-sm text-muted-foreground">Saved ✓</span>
            )}
          </div>
        </form>

        {progress.length > 0 && (
          <div className="border-t pt-3">
            <ProgressLog entries={progress} game={game} />
          </div>
        )}
      </CardContent>
    </Card>
  );
}
