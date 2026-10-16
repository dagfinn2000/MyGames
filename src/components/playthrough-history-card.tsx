"use client";

import { useActionState, useEffect, useId, useRef, useState, useTransition } from "react";
import type { Game, Playthrough } from "@prisma/client";
import { PlayStatus } from "@prisma/client";
import { Pencil, Repeat, Trash2, X } from "lucide-react";
import {
  addPastPlaythrough,
  deletePastPlaythrough,
  playAgain,
  updatePastPlaythrough,
} from "@/lib/actions/playthroughs";
import { formatDate, toDateInputValue, type FormatPrefs } from "@/lib/display";
import { boxText, formatPlaytime } from "@/lib/progress-units";
import { submitKeepingInput } from "@/lib/submit-form";
import { usePreferences } from "@/components/preferences-provider";
import { Stars } from "@/components/stars";
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

/** "12 May 2024 – 3 Jun 2024", partial-date variants, or "Undated
 *  playthrough", with the time it took when that's known. */
function playthroughLabel(
  pass: Pick<Playthrough, "dateStarted" | "dateFinished" | "playedMinutes">,
  prefs: FormatPrefs,
): string {
  const start = formatDate(pass.dateStarted, prefs);
  const finish = formatDate(pass.dateFinished, prefs);
  const dates =
    start && finish
      ? `${start} – ${finish}`
      : finish
        ? `Completed ${finish}`
        : start
          ? `Started ${start}`
          : "Undated playthrough";
  return pass.playedMinutes ? `${dates} · ${formatPlaytime(pass.playedMinutes)}` : dates;
}

/**
 * Play history on the game detail page: every past playthrough of the
 * game (dates, the time it took, and what you rated it that time), a "Play
 * it again" button that archives the current playthrough and restarts the
 * game, and a form for recording playthroughs from before the app. The
 * Game row itself always holds the latest playthrough — that's the
 * "latest" row here and the editable "My playthrough" card.
 */
export function PlaythroughHistoryCard({
  game,
  playthroughs,
}: {
  game: Pick<
    Game,
    "id" | "status" | "dateStarted" | "dateFinished" | "rating" | "playedMinutes"
  >;
  playthroughs: Playthrough[];
}) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const prefs = usePreferences();
  const finished = game.status === PlayStatus.COMPLETED;

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <CardTitle>Play history</CardTitle>
        {finished && <PlayAgainButton gameId={game.id} />}
      </CardHeader>
      {/* grid-cols-1 clamps the tracks so a long unbroken token in a note
          (a pasted URL, say) wraps via break-words instead of stretching
          the card. */}
      <CardContent className="grid grid-cols-1 gap-4">
        {(playthroughs.length > 0 || finished) && (
          <ul className="grid grid-cols-1 gap-2">
            {playthroughs.map((pass) => (
              <li key={pass.id} className="grid grid-cols-1 gap-1">
                {editingId === pass.id ? (
                  <PastPlaythroughForm
                    playthrough={pass}
                    onDone={() => setEditingId(null)}
                  />
                ) : (
                  <>
                    <div className="flex min-h-7 flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                      <span className="text-muted-foreground">
                        {playthroughLabel(pass, prefs)}
                      </span>
                      {pass.rating != null && <Stars value={pass.rating} />}
                      <span className="ml-auto flex items-center gap-1">
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          aria-label="Edit playthrough"
                          onClick={() => setEditingId(pass.id)}
                        >
                          <Pencil className="size-3.5" />
                        </Button>
                        <DeletePlaythroughButton playthroughId={pass.id} />
                      </span>
                    </div>
                    {pass.note && (
                      <p className="long-text whitespace-pre-line break-words text-sm text-muted-foreground">
                        {pass.note}
                      </p>
                    )}
                  </>
                )}
              </li>
            ))}
            {finished && (
              <li className="flex min-h-7 flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                <span>
                  {playthroughLabel(game, prefs)}
                  <span className="ml-2 text-xs text-muted-foreground">
                    latest · edit it in My playthrough
                  </span>
                </span>
                {game.rating != null && <Stars value={game.rating} />}
              </li>
            )}
          </ul>
        )}
        <details className="group">
          <summary className="cursor-pointer text-sm text-muted-foreground hover:text-foreground">
            Played this before? Record a past playthrough
          </summary>
          <div className="pt-3">
            <PastPlaythroughForm gameId={game.id} />
          </div>
        </details>
      </CardContent>
    </Card>
  );
}

/** Add form (pass `gameId`) or inline edit form (pass `playthrough` +
 *  `onDone`). */
function PastPlaythroughForm({
  gameId,
  playthrough,
  onDone,
}: {
  gameId?: string;
  playthrough?: Playthrough;
  onDone?: () => void;
}) {
  const action = playthrough
    ? updatePastPlaythrough.bind(null, playthrough.id)
    : addPastPlaythrough;
  const [state, formAction, pending] = useActionState(action, {});
  const { timeZone } = usePreferences();
  const startId = useId();
  const finishId = useId();
  const timeId = useId();
  const timeHintId = useId();
  const noteId = useId();

  const formRef = useRef<HTMLFormElement>(null);

  // Once a save lands, editing closes the form and adding empties it for
  // the next one. A failed save leaves what was typed (submitKeepingInput).
  useEffect(() => {
    if (!state.success) return;
    if (playthrough) onDone?.();
    else formRef.current?.reset();
  }, [state, playthrough, onDone]);

  return (
    <form
      ref={formRef}
      action={formAction}
      onSubmit={submitKeepingInput(formAction)}
      className="grid gap-2"
    >
      {!playthrough && gameId && <input type="hidden" name="gameId" value={gameId} />}
      <div className="flex flex-wrap items-end gap-3">
        <div className="grid gap-1">
          <Label htmlFor={startId} className="text-xs text-muted-foreground">
            Started
          </Label>
          <Input
            id={startId}
            name="dateStarted"
            type="date"
            className="w-40"
            defaultValue={toDateInputValue(playthrough?.dateStarted, timeZone)}
          />
        </div>
        <div className="grid gap-1">
          <Label htmlFor={finishId} className="text-xs text-muted-foreground">
            Completed
          </Label>
          <Input
            id={finishId}
            name="dateFinished"
            type="date"
            className="w-40"
            defaultValue={toDateInputValue(playthrough?.dateFinished, timeZone)}
          />
        </div>
        <div className="grid gap-1">
          <Label htmlFor={timeId} className="text-xs text-muted-foreground">
            Time played
          </Label>
          {/* Sent as typed; the server reads "42:00" or "42h" the same way
              the play form does. */}
          <Input
            id={timeId}
            name="playedMinutes"
            type="text"
            inputMode="decimal"
            placeholder="h:mm"
            autoComplete="off"
            className="w-24"
            aria-describedby={timeHintId}
            defaultValue={boxText(playthrough?.playedMinutes ?? null)}
          />
        </div>
        <div className="grid gap-1">
          <Label className="text-xs text-muted-foreground">
            Rating that time
          </Label>
          <StarRatingInput name="rating" defaultValue={playthrough?.rating ?? 0} />
        </div>
      </div>
      {/* Under the row, not the box, so the row's boxes stay level. */}
      <p id={timeHintId} className="text-xs text-muted-foreground">
        Time played like 42:00, 42h or 45m. A plain number is minutes.
      </p>
      <div className="grid gap-1">
        <Label htmlFor={noteId} className="text-xs text-muted-foreground">
          Note
        </Label>
        <Textarea
          id={noteId}
          name="note"
          rows={2}
          maxLength={2000}
          placeholder="Optional. For example, 100% on hard, or co-op with my sister"
          defaultValue={playthrough?.note ?? ""}
          className="long-text"
        />
      </div>
      <p className="text-xs text-muted-foreground">
        Everything is optional. An undated playthrough still counts in your totals.
      </p>
      <div className="flex items-center gap-2">
        <Button type="submit" variant="outline" size="sm" disabled={pending}>
          {playthrough
            ? pending
              ? "Saving…"
              : "Save"
            : pending
              ? "Adding…"
              : "Add playthrough"}
        </Button>
        {playthrough && (
          <Button type="button" variant="ghost" size="sm" onClick={onDone}>
            Cancel
          </Button>
        )}
      </div>
      {state.error && <p className="text-sm text-destructive">{state.error}</p>}
    </form>
  );
}

/** Archives the current playthrough and restarts the game; inline confirm
 *  since it changes status, dates and time played in one click. */
function PlayAgainButton({ gameId }: { gameId: string }) {
  const [confirming, setConfirming] = useState(false);
  const [pending, startTransition] = useTransition();

  if (!confirming) {
    return (
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => setConfirming(true)}
      >
        <Repeat data-slot="icon" />
        Play it again
      </Button>
    );
  }
  return (
    <span className="flex items-center gap-1">
      <Button
        type="button"
        size="sm"
        disabled={pending}
        onClick={() => startTransition(() => playAgain(gameId))}
      >
        {pending ? "Starting…" : "Start a new playthrough"}
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-label="Cancel playing again"
        disabled={pending}
        onClick={() => setConfirming(false)}
      >
        <X className="size-3.5" />
      </Button>
    </span>
  );
}

/** Trash icon that expands to an inline confirm — no dialog for something
 *  this small, but still not a single misclick away from data loss. */
function DeletePlaythroughButton({ playthroughId }: { playthroughId: string }) {
  const [confirming, setConfirming] = useState(false);
  const [pending, startTransition] = useTransition();

  if (!confirming) {
    return (
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-label="Delete playthrough"
        onClick={() => setConfirming(true)}
      >
        <Trash2 className="size-3.5" />
      </Button>
    );
  }
  return (
    <span className="flex items-center gap-1">
      <Button
        type="button"
        variant="destructive"
        size="sm"
        disabled={pending}
        onClick={() => startTransition(() => deletePastPlaythrough(playthroughId))}
      >
        {pending ? "Deleting…" : "Delete playthrough"}
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-label="Cancel delete"
        disabled={pending}
        onClick={() => setConfirming(false)}
      >
        <X className="size-3.5" />
      </Button>
    </span>
  );
}
