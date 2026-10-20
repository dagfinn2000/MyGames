"use client";

import { Fragment, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Gamepad2, LibraryBig, Loader2 } from "lucide-react";
import { catalogueGameValues, cataloguePlatforms, roundTimeToBeat } from "@/lib/catalogue-values";
import { copyLabels, type LibraryCandidate, type LibraryGame } from "@/lib/library-match";
import { SOURCE_LABELS, type GameDetails, type GameMetadata } from "@/lib/metadata/types";
import { formatPlaytime } from "@/lib/progress-units";
import type { TagImportSettings } from "@/lib/tag-rules";
import type { GameFormValues } from "@/components/game-form";
import { Input } from "@/components/ui/input";

/** Shortest query worth sending: one or two letters match most of a
 *  catalogue, and every search fans out to three of them. Mirrored by the
 *  route (app/api/metadata/search). */
const MIN_QUERY_LENGTH = 3;

/** Pause in typing before searching. Raised from 400ms for the same reason —
 *  each distinct prefix is a fresh cache miss against free services. */
const DEBOUNCE_MS = 700;

/** Platforms named on a result before the rest are counted ("+3"). */
const PLATFORMS_SHOWN = 4;

/** Everything copied, no tag rules: for a caller with no settings. */
const IMPORT_ALL_TAGS: TagImportSettings = {
  mode: "all",
  rules: { renames: [], skips: [] },
  knownTags: [],
};

/** A smaller copy of an IGDB cover for the result list: the full one is
 *  sized for the cover preview, and a list of ten would load them all. */
function thumbnail(url: string): string {
  return url.replace("/t_cover_big_2x/", "/t_cover_small_2x/");
}

/** "PC, Nintendo Switch, PlayStation 4, Xbox One +3". */
function platformList(platforms: string[]): string {
  const shown = platforms.slice(0, PLATFORMS_SHOWN).join(", ");
  const more = platforms.length - PLATFORMS_SHOWN;
  return more > 0 ? `${shown} +${more}` : shown;
}

/** For a caller that doesn't pass the library: nothing is in it. */
const NOT_IN_LIBRARY = (): LibraryGame[] => [];

/**
 * "In your library · Nintendo Switch" under a result the player already
 * has, linking to their copy; with copies on several platforms, each
 * platform links to its own. It sits under the result's button rather
 * than in it, since a link can't go inside a button.
 *
 * It wraps rather than being cut short: on a phone, three platforms don't
 * fit on one line, and a link cut off can be neither seen nor tapped.
 */
function InLibraryNote({ copies }: { copies: LibraryGame[] }) {
  const link = "font-medium text-foreground underline-offset-2 hover:underline";
  const labels = copyLabels(copies, "no platform");
  return (
    // pl-17 lines it up with the result's text: the padding, the cover
    // (w-11) and the gap after it. -mt-2 takes back most of the button's
    // own padding below, so the note reads as the result's last line.
    <p className="-mt-2 flex items-start gap-1.5 pr-3 pb-3 pl-17 text-xs text-muted-foreground">
      {/* mt-px centres it on the first line (h-4) when the note wraps. */}
      <LibraryBig className="mt-px size-3.5 shrink-0 text-primary" aria-hidden />
      <span className="min-w-0 break-words">
        {copies.length === 1 ? (
          <Link href={`/games/${copies[0].id}`} className={link}>
            In your library{copies[0].platform?.trim() ? ` · ${copies[0].platform.trim()}` : ""}
          </Link>
        ) : (
          <>
            In your library
            {copies.map((copy, i) => (
              <Fragment key={copy.id}>
                {" "}
                {/* Kept whole on a line where it fits ("· PlayStation 5"),
                    and wrapped within only when it is longer than one. */}
                <span className="inline-block max-w-full">
                  ·{" "}
                  <Link href={`/games/${copy.id}`} className={link}>
                    {labels[i]}
                  </Link>
                </span>
              </Fragment>
            ))}
          </>
        )}
      </span>
    </p>
  );
}

/**
 * Search-as-you-type against /api/metadata/search (IGDB when the server is
 * set up for it, Wikipedia and Steam, in the player's order). Picking a
 * result fetches the entry's full record (description, studios, time to
 * beat) and hands prefilled form values to the parent, which switches to
 * the review form, along with every platform the catalogue lists for the
 * form's suggestions. A result the player already has says so (see
 * InLibraryNote), but can be picked all the same.
 */
export function ImportSearch({
  onPick,
  tagImport = IMPORT_ALL_TAGS,
  findInLibrary = NOT_IN_LIBRARY,
}: {
  onPick: (values: GameFormValues, platforms: string[]) => void;
  /** How catalogue genres become tags (Preferences, New games). */
  tagImport?: TagImportSettings;
  /** The player's copies of a result, if any (lib/library-match). Checked
   *  in the browser against the library the page loaded, so it costs no
   *  request per result. */
  findInLibrary?: (candidate: LibraryCandidate) => LibraryGame[];
}) {
  const [query, setQuery] = useState("");
  // Results are stored with the query they answer. Everything the UI needs —
  // which results to show, and whether a search is outstanding — is then
  // derived from that one fact, instead of three states nudged into
  // agreement by setState calls at the top of the effect.
  // `failed`: the catalogues couldn't be reached, which is not the same
  // answer as "they have nothing by that name".
  const [answer, setAnswer] = useState<{
    query: string;
    list: GameMetadata[];
    failed?: boolean;
  } | null>(null);
  const [pickingId, setPickingId] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const trimmed = query.trim();
  const longEnough = trimmed.length >= MIN_QUERY_LENGTH;
  const answered = answer?.query === trimmed;
  // A typed character invalidates the previous answer by itself: the results
  // stop matching the query, which is exactly what "searching" means.
  const results = answered ? answer.list : [];
  const failed = answered && answer.failed === true;
  const searching = longEnough && !answered;

  /** Fetch the chosen result's full record, then prefill. */
  async function pick(result: GameMetadata, key: string) {
    setPickingId(key);
    let details: Partial<GameDetails> | null = null;
    try {
      const params = new URLSearchParams();
      if (result.catalogueId) params.set("id", result.catalogueId);
      params.set("title", result.title);
      const res = await fetch(`/api/metadata/details?${params}`);
      if (res.ok) {
        const data = await res.json();
        details = data.details;
      }
    } catch {
      // details are a bonus; the search result alone is enough to prefill
    }

    onPick(catalogueGameValues(result, details, tagImport), cataloguePlatforms(result, details));
    setPickingId(null);
  }

  // Debounced search: waits for a pause in typing, then cancels any in-flight
  // request so stale responses can't overwrite newer ones.
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (trimmed.length < MIN_QUERY_LENGTH) return;

    debounceRef.current = setTimeout(async () => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      try {
        const res = await fetch(
          `/api/metadata/search?q=${encodeURIComponent(trimmed)}`,
          { signal: controller.signal },
        );
        const data = await res.json();
        const list: GameMetadata[] = data.results ?? [];
        // 502: no catalogue answered. Other errors (a spent lookup budget)
        // also mean "couldn't search", not "nothing found".
        setAnswer({ query: trimmed, list, failed: !res.ok });
      } catch {
        // A failed lookup answers the query with nothing, which stops the
        // spinner and says the search failed. An abort is a newer query
        // taking over and must not answer this one.
        if (!controller.signal.aborted) setAnswer({ query: trimmed, list: [], failed: true });
      }
    }, DEBOUNCE_MS);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      // Also abort a request already in flight: without this, navigating away
      // mid-search left the fetch running and its setState firing into an
      // unmounted component.
      abortRef.current?.abort();
    };
  }, [trimmed]);

  return (
    <div className="grid gap-4">
      <Input
        placeholder="Search by title…"
        aria-label="Search the game catalogues"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        autoFocus
      />

      {searching && (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" /> Searching…
        </p>
      )}

      {!searching && longEnough && results.length === 0 && (
        <p className="text-sm text-muted-foreground">
          {failed
            ? "Couldn't reach the game catalogues. Try again in a moment, or add the game manually."
            : "No results. You can still add the game manually."}
        </p>
      )}

      {/* grid-cols-1 (minmax(0,1fr)) caps the track at the container width;
          a bare `grid` sizes its implicit column by content, so one long
          nowrap title would stretch every card past the page edge. */}
      <ul className="grid grid-cols-1 gap-2">
        {results.map((r, i) => {
          const key = r.catalogueId ?? `${r.title}-${i}`;
          const year = r.releaseDate?.slice(0, 4);
          const made = [year, r.developers.join(", ")].filter(Boolean).join(" · ");
          const copies = findInLibrary(r);
          return (
            // The card is the item rather than the button, so the library
            // note (with its links) can sit inside it, below the button.
            <li
              key={key}
              className="rounded-lg border bg-card transition-colors has-[>button:disabled]:opacity-60 has-[>button:hover]:border-ring/60"
            >
              <button
                type="button"
                onClick={() => pick(r, key)}
                disabled={pickingId !== null}
                className="flex w-full items-center gap-3 rounded-lg p-3 text-left"
              >
                <div className="h-16 w-11 shrink-0 overflow-hidden rounded bg-muted">
                  {r.coverUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={thumbnail(r.coverUrl)}
                      alt=""
                      loading="lazy"
                      decoding="async"
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <div className="flex h-full items-center justify-center">
                      <Gamepad2 className="size-4 text-muted-foreground/40" />
                    </div>
                  )}
                </div>
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{r.title}</p>
                  {made && <p className="truncate text-xs text-muted-foreground">{made}</p>}
                  <p className="truncate text-xs text-muted-foreground">
                    {r.platforms.length > 0 ? `${platformList(r.platforms)} · ` : ""}
                    {r.lengthMinutes
                      ? `about ${formatPlaytime(roundTimeToBeat(r.lengthMinutes))} · `
                      : ""}
                    {/* Results mix the catalogues — say which one each row
                        came from, so the right entry is easy to spot. */}
                    {SOURCE_LABELS[r.source]}
                  </p>
                </div>
                {pickingId === key && (
                  <Loader2 className="ml-auto size-4 shrink-0 animate-spin" />
                )}
              </button>
              {copies.length > 0 && <InLibraryNote copies={copies} />}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
