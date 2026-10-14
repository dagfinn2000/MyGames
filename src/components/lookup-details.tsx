"use client";

import { useId, useRef, useState } from "react";
import { Loader2, Search } from "lucide-react";
import {
  catalogueGameValues,
  diffAgainstForm,
  roundTimeToBeat,
  type CatalogueDiffRow,
  type CatalogueField,
  type CatalogueValues,
} from "@/lib/catalogue-values";
import { catalogueLink } from "@/lib/metadata/links";
import { releaseYear, titleKey } from "@/lib/metadata/match";
import type { GameDetails, GameMetadata } from "@/lib/metadata/types";
import { formatPlaytime } from "@/lib/progress-units";
import type { TagImportSettings } from "@/lib/tag-rules";
import { Button } from "@/components/ui/button";

const TOO_MANY = "Too many lookups this minute. Try again in a moment.";
const UNREACHABLE = "Couldn't reach the game catalogues.";

/** A lookup that ends with something to say instead of values. */
class LookupMessage extends Error {}

async function getJson<T>(url: string): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url);
  } catch {
    throw new LookupMessage(UNREACHABLE);
  }
  if (res.status === 429) throw new LookupMessage(TOO_MANY);
  if (!res.ok) throw new LookupMessage(UNREACHABLE);
  return (await res.json()) as T;
}

async function search(q: string): Promise<GameMetadata[]> {
  return (await getJson<{ results?: GameMetadata[] }>(`/api/metadata/search?q=${encodeURIComponent(q)}`))
    .results ?? [];
}

/**
 * What the catalogues say about the game in the form. With a catalogue
 * entry, that entry's full record; without one, a search by title in
 * which only a game with the very same title counts (the one released in
 * the year the form gives, when there are several), then its record. Each
 * request spends from the player's lookup budget, like the add page's
 * search.
 */
async function lookUpCatalogue(
  current: CatalogueValues,
  settings: TagImportSettings,
): Promise<CatalogueValues> {
  const id = current.catalogueId.trim();
  const title = current.title.trim();

  let row: GameMetadata | null = null;
  if (!id) {
    const key = titleKey(title);
    const same =
      key.length >= 3 ? (await search(title)).filter((r) => titleKey(r.title) === key) : [];
    const year = releaseYear(current.releaseDate);
    row = same.find((r) => year !== null && releaseYear(r.releaseDate) === year) ?? same[0] ?? null;
    if (!row) {
      throw new LookupMessage("Couldn't find a game with exactly this title. Check the title and try again.");
    }
  }

  const params = new URLSearchParams();
  const detailsId = id || row?.catalogueId;
  if (detailsId) params.set("id", detailsId);
  params.set("title", title || row?.title || "");
  let details: GameDetails | null = null;
  try {
    details = (await getJson<{ details: GameDetails }>(`/api/metadata/details?${params}`)).details;
  } catch (e) {
    // The search row alone is still worth offering.
    if (!row) throw e;
  }
  return catalogueGameValues(row, details, settings);
}

function shorten(s: string, max = 200): string {
  return s.length > max ? `${s.slice(0, max).trimEnd()}…` : s;
}

/** A field's value as the player reads it: a time to beat in hours rather
 *  than the minutes the form holds, a catalogue entry by its catalogue's
 *  name. */
function shown(field: CatalogueField, value: string, max?: number): string {
  if (field === "lengthMinutes") {
    const minutes = Number(value);
    return Number.isFinite(minutes) && minutes > 0
      ? `about ${formatPlaytime(roundTimeToBeat(minutes))}`
      : value;
  }
  if (field === "catalogueId") {
    const link = catalogueLink(value);
    if (link) return `${link.label} (${value.slice(value.indexOf(":") + 1)})`;
  }
  return shorten(value, max);
}

/**
 * "Look up details" on the edit page: asks the catalogues about the game
 * and offers what they know as ticked or unticked rows. Empty fields come
 * ticked; anything that would replace what the player typed comes
 * unticked. Filling puts the values into the form, which still has to be
 * saved.
 */
export function LookupDetails({
  settings,
  read,
  onFill,
}: {
  settings: TagImportSettings;
  /** The form's current values. */
  read: () => CatalogueValues;
  onFill: (rows: CatalogueDiffRow[]) => void;
}) {
  const headingId = useId();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [loading, setLoading] = useState(false);
  const [rows, setRows] = useState<CatalogueDiffRow[] | null>(null);
  const [ticked, setTicked] = useState<Set<CatalogueField>>(new Set());
  const [message, setMessage] = useState<string | null>(null);

  async function lookUp() {
    setLoading(true);
    setRows(null);
    setMessage(null);
    const current = read();
    try {
      const offered = diffAgainstForm(current, await lookUpCatalogue(current, settings));
      if (offered.length === 0) {
        setMessage("The catalogue has nothing new for this game.");
      } else {
        setRows(offered);
        setTicked(new Set(offered.filter((r) => r.checked).map((r) => r.field)));
      }
    } catch (e) {
      setMessage(e instanceof LookupMessage ? e.message : UNREACHABLE);
    } finally {
      setLoading(false);
    }
  }

  function close(said: string | null) {
    setRows(null);
    setMessage(said);
    buttonRef.current?.focus();
  }

  function fill() {
    const chosen = (rows ?? []).filter((r) => ticked.has(r.field));
    onFill(chosen);
    close(
      chosen.length === 0
        ? null
        : `Filled in ${chosen.length} field${chosen.length === 1 ? "" : "s"}. Save changes to keep them.`,
    );
  }

  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <Button ref={buttonRef} type="button" variant="outline" onClick={lookUp} disabled={loading}>
          {loading ? <Loader2 data-slot="icon" className="animate-spin" /> : <Search data-slot="icon" />}
          Look up details
        </Button>
        {/* Always in the page, so screen readers hear each new message. */}
        <p role="status" className="text-sm text-muted-foreground">
          {message}
        </p>
      </div>

      {rows && (
        <section aria-labelledby={headingId} className="grid gap-3 rounded-lg border bg-card p-3">
          <h2 id={headingId} className="text-sm font-semibold">
            From the catalogue
          </h2>
          <ul className="grid gap-3">
            {rows.map((r) => (
              <li key={r.field}>
                <label className="flex items-start gap-2">
                  <input
                    type="checkbox"
                    className="mt-0.5 size-4 shrink-0 accent-primary"
                    checked={ticked.has(r.field)}
                    onChange={(e) => {
                      const next = new Set(ticked);
                      if (e.target.checked) next.add(r.field);
                      else next.delete(r.field);
                      setTicked(next);
                    }}
                  />
                  <span className="grid min-w-0 gap-0.5 text-sm">
                    <span className="font-medium">{r.label}</span>
                    {r.field === "coverUrl" ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={r.value}
                        alt="Catalogue cover"
                        className="h-16 w-11 rounded bg-muted object-cover"
                      />
                    ) : (
                      <span className="break-words">
                        {r.field === "tags" ? `Add ${r.value}` : shown(r.field, r.value)}
                      </span>
                    )}
                    {r.field !== "coverUrl" && (
                      <span className="break-words text-xs text-muted-foreground">
                        Now: {r.current ? shown(r.field, r.current, 80) : "empty"}
                      </span>
                    )}
                  </span>
                </label>
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap gap-2">
            <Button type="button" onClick={fill}>
              Fill in ticked fields
            </Button>
            <Button type="button" variant="outline" onClick={() => close(null)}>
              Cancel
            </Button>
          </div>
        </section>
      )}
    </div>
  );
}
