"use client";

import { useActionState, useEffect, useEffectEvent, useId, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import { GameFormat, GameOwnership, PlayStatus } from "@prisma/client";
import { Gamepad2 } from "lucide-react";
import type { ActionState } from "@/lib/actions/helpers";
import type { CatalogueDiffRow, CatalogueValues } from "@/lib/catalogue-values";
import { FORMAT_LABELS, OWNERSHIP_LABELS, STATUS_LABELS, toDateInputValue } from "@/lib/display";
import { COMMON_PLATFORMS } from "@/lib/platforms";
import type { AfterAdd } from "@/lib/preferences";
import type { TagImportSettings } from "@/lib/tag-rules";
import { submitKeepingInput } from "@/lib/submit-form";
import { CoverPicker } from "@/components/cover-picker";
import { FinishedDateField } from "@/components/finished-date-field";
import { LookupDetails } from "@/components/lookup-details";
import { usePreferences } from "@/components/preferences-provider";
import { StarRatingInput } from "@/components/star-rating-input";
import { TimeToBeatField } from "@/components/time-to-beat-field";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

/** String-typed initial values — everything a game form can prefill. */
export interface GameFormValues {
  title?: string;
  developers?: string; // comma-separated
  publisher?: string;
  platform?: string;
  description?: string;
  coverUrl?: string;
  lengthMinutes?: string; // time to beat, whole minutes
  releaseDate?: string;
  tags?: string; // comma-separated
  seriesName?: string;
  seriesNumber?: string;
  format?: GameFormat;
  ownership?: GameOwnership;
  status?: PlayStatus;
  catalogueId?: string;
}

/** The add form's submit buttons, by where each goes afterwards. */
const ADD_BUTTON_LABELS: Record<AfterAdd, string> = {
  open: "Add game",
  another: "Add and add another",
  library: "Add and go to the library",
};

/**
 * The platform field's suggestions: the catalogue's platforms for this game
 * first, then the common ones, each once whatever its case.
 */
function platformSuggestions(fromCatalogue: string[]): string[] {
  const seen = new Set<string>();
  return [...fromCatalogue, ...COMMON_PLATFORMS].filter((name) => {
    const key = name.trim().toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Shared add/edit game form. The caller supplies the server action —
 * `createGame` for the add flow, a bound `updateGame` for editing.
 * `showStatus` is on for creation only; after that, status is managed from
 * the playing card on the detail page. It also brings each status's own
 * fields (a finish date and rating for Completed, a start date and time
 * played for Playing, the time played for Dropped) and the add buttons
 * that follow "After adding a game" in Preferences.
 */
export function GameForm({
  action,
  initial = {},
  submitLabel = "Save changes",
  showStatus = false,
  seriesNames = [],
  platformOptions = [],
  onAdded,
  autoFocusTitle = false,
  lookup,
}: {
  action: (prev: ActionState, formData: FormData) => Promise<ActionState>;
  initial?: GameFormValues;
  /** The edit form's button. The add form's buttons follow Preferences. */
  submitLabel?: string;
  showStatus?: boolean;
  /** Existing series names, offered as autocomplete suggestions. */
  seriesNames?: string[];
  /** Platforms to suggest before the common ones: the catalogue's for the
   *  game being added, or the library's own on the edit page. */
  platformOptions?: string[];
  /** Called with the new game after "Add and add another". */
  onAdded?: (game: { id: string; title: string }) => void;
  autoFocusTitle?: boolean;
  /** Offers "Look up details" (the edit page), with the player's settings
   *  for catalogue genres. */
  lookup?: TagImportSettings;
}) {
  const [state, formAction, pending] = useActionState(action, {});
  const formRef = useRef<HTMLFormElement>(null);
  // Controlled so the cover picker and upload can set it programmatically.
  const [coverUrl, setCoverUrl] = useState(initial.coverUrl ?? "");
  // Format, ownership and status are controlled, each with a plain hidden
  // input carrying it: the Radix Select's own hidden select reverts to its
  // mount-time value whenever the form is reset (see playing-card.tsx),
  // while the trigger keeps showing the player's choice. The status also
  // decides which play fields show.
  const [format, setFormat] = useState<GameFormat>(
    initial.format ?? GameFormat.PHYSICAL,
  );
  const [ownership, setOwnership] = useState<GameOwnership>(
    initial.ownership ?? GameOwnership.OWNED,
  );

  // Kept on every save, and filled in by Look up details when the catalogue
  // knows the game.
  const [catalogueId, setCatalogueId] = useState(initial.catalogueId ?? "");
  const [status, setStatus] = useState<PlayStatus>(initial.status ?? PlayStatus.WANT_TO_PLAY);
  // The time to beat as Look up details last set it. Its boxes keep their
  // own state, so a new value remounts them (the key) rather than being
  // written into the hidden field they control.
  const [timeToBeat, setTimeToBeat] = useState({
    minutes: initial.lengthMinutes ?? "",
    key: 0,
  });
  const platforms = platformSuggestions(platformOptions);

  // Each save returns a new state object, so this runs once per game added.
  const reportAdded = useEffectEvent((game: { id: string; title: string }) => onAdded?.(game));
  useEffect(() => {
    if (state.added) reportAdded(state.added);
  }, [state]);

  /** The form's fields as the catalogue lookup compares them. */
  function readForm(): CatalogueValues {
    const form = formRef.current;
    const value = (name: string) => {
      const el = form?.elements.namedItem(name);
      return el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement ? el.value : "";
    };
    return {
      title: value("title"),
      developers: value("developers"),
      publisher: value("publisher"),
      platform: value("platform"),
      description: value("description"),
      coverUrl,
      lengthMinutes: value("lengthMinutes"),
      releaseDate: value("releaseDate"),
      tags: value("tags"),
      seriesName: value("seriesName"),
      catalogueId,
    };
  }

  /** Puts ticked catalogue values into the form. The text fields are
   *  uncontrolled, so this sets them directly; saving reads whatever is in
   *  them then, edits after filling included. Tags are added to the
   *  player's own, never replace them. */
  function fillFields(rows: CatalogueDiffRow[]) {
    const form = formRef.current;
    for (const { field, value } of rows) {
      if (field === "coverUrl") setCoverUrl(value);
      else if (field === "catalogueId") setCatalogueId(value);
      else if (field === "lengthMinutes") setTimeToBeat((t) => ({ minutes: value, key: t.key + 1 }));
      else {
        const el = form?.elements.namedItem(field);
        if (!(el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement)) continue;
        el.value = field === "tags" && el.value.trim() ? `${el.value.trim()}, ${value}` : value;
      }
    }
  }

  return (
    <form
      ref={formRef}
      action={formAction}
      onSubmit={submitKeepingInput(formAction)}
      className="grid gap-6 md:grid-cols-[200px_1fr]"
    >
      {/* Cover preview + URL + picker */}
      <div className="grid content-start gap-2">
        {/* Capped below md so the stacked mobile layout doesn't blow the
            preview up to full width (and ~1.5x screen height). */}
        <div className="mx-auto aspect-[2/3] w-full max-w-52 overflow-hidden rounded-md border bg-muted md:mx-0 md:max-w-none">
          {coverUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={coverUrl}
              alt="Cover preview"
              className="h-full w-full object-cover"
            />
          ) : (
            <div className="flex h-full items-center justify-center">
              <Gamepad2 className="size-10 text-muted-foreground/40" />
            </div>
          )}
        </div>
        <Label htmlFor="coverUrl">Cover image URL</Label>
        <Input
          id="coverUrl"
          name="coverUrl"
          placeholder="https://…"
          value={coverUrl}
          onChange={(e) => setCoverUrl(e.target.value)}
        />
        <p className="text-xs text-muted-foreground">
          Remote images are downloaded and cached locally on save.
        </p>
        <CoverPicker selected={coverUrl} onSelect={setCoverUrl} />
      </div>

      {/* The game's own details */}
      <div className="grid content-start gap-4">
        {lookup && <LookupDetails settings={lookup} read={readForm} onFill={fillFields} />}
        <div className="grid gap-2">
          <Label htmlFor="title">Title *</Label>
          <Input
            id="title"
            name="title"
            required
            defaultValue={initial.title ?? ""}
            autoFocus={autoFocusTitle}
          />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="developers">Developer(s)</Label>
          <Input
            id="developers"
            name="developers"
            placeholder="Comma-separated"
            defaultValue={initial.developers ?? ""}
          />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="grid gap-2">
            <Label htmlFor="publisher">Publisher</Label>
            <Input
              id="publisher"
              name="publisher"
              maxLength={200}
              defaultValue={initial.publisher ?? ""}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="platform">Platform</Label>
            <Input
              id="platform"
              name="platform"
              placeholder="e.g. Nintendo Switch"
              maxLength={100}
              defaultValue={initial.platform ?? ""}
              list="platform-suggestions"
            />
            <datalist id="platform-suggestions">
              {platforms.map((p) => (
                <option key={p} value={p} />
              ))}
            </datalist>
          </div>
        </div>
        <div className="flex flex-wrap items-end gap-4">
          <div className="grid gap-2">
            <Label htmlFor="releaseDate">Released</Label>
            <Input
              id="releaseDate"
              name="releaseDate"
              placeholder="2017"
              className="w-32"
              maxLength={20}
              defaultValue={initial.releaseDate ?? ""}
            />
          </div>
          <TimeToBeatField key={timeToBeat.key} initialMinutes={timeToBeat.minutes} />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="tags">Genres / tags</Label>
          <Input
            id="tags"
            name="tags"
            placeholder="metroidvania, co-op, …"
            defaultValue={initial.tags ?? ""}
          />
        </div>
        <div className="grid grid-cols-[1fr_7rem] gap-4">
          <div className="grid gap-2">
            <Label htmlFor="seriesName">Series</Label>
            <Input
              id="seriesName"
              name="seriesName"
              placeholder="e.g. The Legend of Zelda"
              defaultValue={initial.seriesName ?? ""}
              list="series-suggestions"
            />
            {seriesNames.length > 0 && (
              <datalist id="series-suggestions">
                {seriesNames.map((s) => (
                  <option key={s} value={s} />
                ))}
              </datalist>
            )}
          </div>
          <div className="grid gap-2">
            <Label htmlFor="seriesNumber">No. in series</Label>
            <Input
              id="seriesNumber"
              name="seriesNumber"
              type="number"
              step="0.1"
              min={0}
              placeholder="1"
              defaultValue={initial.seriesNumber ?? ""}
            />
          </div>
        </div>
        <div className="grid gap-2">
          <Label htmlFor="description">Description</Label>
          <Textarea
            id="description"
            name="description"
            rows={5}
            defaultValue={initial.description ?? ""}
          />
        </div>
        <div className="flex flex-wrap items-end gap-4">
          <div className="grid gap-2">
            <Label htmlFor="format">Format</Label>
            <input type="hidden" name="format" value={format} />
            <Select value={format} onValueChange={(v) => setFormat(v as GameFormat)}>
              <SelectTrigger id="format" className="w-36">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.values(GameFormat).map((f) => (
                  <SelectItem key={f} value={f}>
                    {FORMAT_LABELS[f]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {showStatus && (
            <div className="grid gap-2">
              <Label htmlFor="status">Status</Label>
              <input type="hidden" name="status" value={status} />
              <Select value={status} onValueChange={(v) => setStatus(v as PlayStatus)}>
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
          )}
          <div className="grid gap-2">
            <Label htmlFor="ownership">Ownership</Label>
            <input type="hidden" name="ownership" value={ownership} />
            <Select value={ownership} onValueChange={(v) => setOwnership(v as GameOwnership)}>
              <SelectTrigger id="ownership">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.values(GameOwnership).map((o) => (
                  <SelectItem key={o} value={o}>
                    {OWNERSHIP_LABELS[o]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Keyed on the status, so switching status starts its fields
            afresh. */}
        {showStatus && <StatusFields key={status} status={status} />}

        <input type="hidden" name="catalogueId" value={catalogueId} />

        {state.error && (
          <p role="alert" className="text-sm text-destructive">
            {state.error}
          </p>
        )}
        {showStatus ? (
          <AddButtons />
        ) : (
          <div>
            <Button type="submit" disabled={pending}>
              {pending ? "Saving…" : submitLabel}
            </Button>
          </div>
        )}
      </div>
    </form>
  );
}

/**
 * What a new game with this status brings with it. Completed: when it was
 * finished (or "Don't remember") and a rating. Playing: when it was started
 * and the time played so far. Dropped: the time played before stopping.
 * Want to Play needs nothing more.
 */
function StatusFields({ status }: { status: PlayStatus }) {
  const { addedAsCompletedFinished, ratingStyle, timeZone } = usePreferences();
  const [today] = useState(() => toDateInputValue(new Date(), timeZone));

  if (status === PlayStatus.COMPLETED) {
    return (
      <div className="flex flex-wrap items-end gap-4">
        <FinishedDateField
          defaultDate={addedAsCompletedFinished === "today" ? today : ""}
          defaultUnknown={addedAsCompletedFinished === "undated"}
        />
        {ratingStyle !== "off" && (
          <div className="grid gap-2">
            <Label>Rating</Label>
            <StarRatingInput name="rating" defaultValue={0} />
          </div>
        )}
      </div>
    );
  }
  if (status === PlayStatus.PLAYING || status === PlayStatus.DROPPED) {
    return (
      <div className="flex flex-wrap items-end gap-4">
        {status === PlayStatus.PLAYING && (
          <div className="grid gap-2">
            <Label htmlFor="dateStarted">Started</Label>
            <Input
              id="dateStarted"
              name="dateStarted"
              type="date"
              className="w-40"
              defaultValue={today}
            />
          </div>
        )}
        <PlayedSoFarField />
      </div>
    );
  }
  return null;
}

/**
 * Time played so far, typed the way the playing card takes it: "12:30",
 * "12h 30m" or "45m". A phone's decimal keypad is enough ("12.30"). The
 * server reads it and says so if it isn't a time.
 */
function PlayedSoFarField() {
  const hintId = useId();
  return (
    <div className="grid gap-2">
      <Label htmlFor="playedMinutes">Time played so far</Label>
      <Input
        id="playedMinutes"
        name="playedMinutes"
        inputMode="decimal"
        autoComplete="off"
        className="w-28"
        placeholder="0:00"
        aria-describedby={hintId}
      />
      <p id={hintId} className="sr-only">
        Hours and minutes, like 12:30
      </p>
    </div>
  );
}

/**
 * The add form's buttons. The first does what "After adding a game" says
 * (so Enter in a field does that too); the second offers adding another,
 * or opening the game when adding another is already the first. The
 * pressed button's name and value travel with the form data.
 */
function AddButtons() {
  const { afterAdd } = usePreferences();
  const { pending, data } = useFormStatus();
  const second: AfterAdd = afterAdd === "another" ? "open" : "another";
  const pressed = pending ? data?.get("afterAdd") : null;

  return (
    <div className="flex flex-wrap gap-2">
      <Button type="submit" name="afterAdd" value={afterAdd} disabled={pending}>
        {pressed === afterAdd ? "Adding…" : ADD_BUTTON_LABELS[afterAdd]}
      </Button>
      <Button type="submit" name="afterAdd" value={second} variant="outline" disabled={pending}>
        {pressed === second ? "Adding…" : second === "open" ? "Add and open it" : ADD_BUTTON_LABELS.another}
      </Button>
    </div>
  );
}
