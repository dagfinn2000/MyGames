"use client";

import { Fragment, useCallback, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, CircleCheck, LibraryBig, X } from "lucide-react";
import { createGame } from "@/lib/actions/games";
import { copyLabels, libraryMatcher, timesPhrase, type LibraryGame } from "@/lib/library-match";
import type { TagImportSettings } from "@/lib/tag-rules";
import { GameForm, type GameFormValues } from "@/components/game-form";
import { ImportSearch } from "@/components/import-search";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

/** A picked game, waiting in the review form. */
interface Prefill {
  values: GameFormValues;
  /** Every platform the catalogue lists it on, for the platform field's
   *  suggestions. */
  platforms: string[];
}

/** A stable empty library, so the matcher below isn't rebuilt each render. */
const NO_GAMES: LibraryGame[] = [];

/**
 * "You already have Hollow Knight in your library, on Nintendo Switch.",
 * above the form for a picked result the player already has, linking to
 * their copy (or, with several, to each by its platform). Only a note:
 * saving still adds the game, as it should for a copy on another platform.
 */
function AlreadyInLibrary({ copies }: { copies: LibraryGame[] }) {
  const link = "font-medium underline underline-offset-2";
  const [first] = copies;
  // "…twice: PC and one without a platform."
  const labels = copyLabels(copies, "one without a platform");
  return (
    <p className="flex items-start gap-2 rounded-lg border bg-card p-3 text-sm">
      <LibraryBig className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
      <span className="min-w-0 flex-1 break-words">
        {copies.length === 1 ? (
          <>
            You already have{" "}
            <Link href={`/games/${first.id}`} className={link}>
              {first.title}
            </Link>{" "}
            in your library{first.platform?.trim() ? `, on ${first.platform.trim()}` : ""}.
          </>
        ) : (
          <>
            You already have {first.title} in your library {timesPhrase(copies.length)}:{" "}
            {copies.map((copy, i) => (
              <Fragment key={copy.id}>
                {i === 0 ? "" : i === copies.length - 1 ? " and " : ", "}
                <Link href={`/games/${copy.id}`} className={link}>
                  {labels[i]}
                </Link>
              </Fragment>
            ))}
            .
          </>
        )}{" "}
        <span className="text-muted-foreground">
          You can still add it as another copy, on a different platform for example.
        </span>
      </span>
    </p>
  );
}

/**
 * Add-game flow: either search-and-import (pick a result → review the
 * prefilled form → save) or straight manual entry. A result the player
 * already has is pointed out in the list and again above the form, without
 * standing in the way of adding it.
 *
 * "Add and add another" comes back here instead of opening the game: each
 * round starts afresh (the round number keys the search and the form), on
 * the tab it was added from, with a line saying what was just added.
 */
export function AddGameClient({
  seriesNames = [],
  libraryPlatforms = [],
  library = NO_GAMES,
  defaults = {},
  tagImport,
}: {
  seriesNames?: string[];
  /** The platforms already in the library, most used first: suggested
   *  after the catalogue's own. */
  libraryPlatforms?: string[];
  /** Every game in the library, oldest first, for saying which results the
   *  player already has. Fresh after each add: createGame revalidates, and
   *  a Server Action that does re-renders this page in its response. */
  library?: LibraryGame[];
  /** Format, status and ownership a new game starts with (Preferences). */
  defaults?: Pick<GameFormValues, "format" | "status" | "ownership">;
  /** How a catalogue's genres become tags (Preferences, New games). */
  tagImport?: TagImportSettings;
}) {
  const [tab, setTab] = useState("search");
  const [round, setRound] = useState(0);
  const [prefill, setPrefill] = useState<Prefill | null>(null);
  const [lastAdded, setLastAdded] = useState<{ id: string; title: string } | null>(null);
  // Built once per library rather than per result: it folds every title.
  const findInLibrary = useMemo(() => libraryMatcher(library), [library]);
  // The picked result's title and catalogue entry are the row's own (see
  // catalogueGameValues), so this finds what the list said it would, but
  // its date is the full entry's: a row that had none in the list (Steam's)
  // and could have been either of two games of its title is settled here.
  const pickedCopies = prefill
    ? findInLibrary({
        title: prefill.values.title ?? "",
        catalogueId: prefill.values.catalogueId,
        releaseDate: prefill.values.releaseDate,
      })
    : [];

  const handlePick = useCallback((values: GameFormValues, platforms: string[]) => {
    setPrefill({ values, platforms });
  }, []);

  function handleAdded(game: { id: string; title: string }) {
    setLastAdded(game);
    setPrefill(null);
    setRound((r) => r + 1);
  }

  return (
    <div className="grid gap-4">
      {/* Always in the page, so each new "Added" is read out; the strip
          below is what's seen. sr-only takes it out of the grid, so it adds
          no gap. */}
      <p role="status" className="sr-only">
        {lastAdded ? `Added ${lastAdded.title}` : ""}
      </p>
      {lastAdded && (
        <div className="flex items-start gap-2 rounded-lg border border-emerald-300 bg-emerald-50 p-3 text-sm dark:border-emerald-900 dark:bg-emerald-950/40">
          <CircleCheck className="mt-0.5 size-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
          <span className="min-w-0 flex-1 break-words">
            Added <b className="font-medium">{lastAdded.title}</b> ·{" "}
            <Link href={`/games/${lastAdded.id}`} className="underline underline-offset-2">
              Open it
            </Link>
          </span>
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            aria-label="Dismiss"
            title="Dismiss"
            onClick={() => setLastAdded(null)}
          >
            <X />
          </Button>
        </div>
      )}

      {prefill ? (
        <>
          <div>
            <Button variant="ghost" size="sm" onClick={() => setPrefill(null)}>
              <ArrowLeft data-slot="icon" />
              Back to search
            </Button>
          </div>
          {pickedCopies.length > 0 && <AlreadyInLibrary copies={pickedCopies} />}
          <p className="text-sm text-muted-foreground">
            Review the imported details, adjust anything you like, then save.
          </p>
          <GameForm
            key={round}
            action={createGame}
            initial={{ ...defaults, ...prefill.values }}
            showStatus
            seriesNames={seriesNames}
            platformOptions={[...prefill.platforms, ...libraryPlatforms]}
            onAdded={handleAdded}
          />
        </>
      ) : (
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList>
            <TabsTrigger value="search">Search &amp; import</TabsTrigger>
            <TabsTrigger value="manual">Manual entry</TabsTrigger>
          </TabsList>
          <TabsContent value="search" className="pt-4">
            <ImportSearch
              key={round}
              onPick={handlePick}
              tagImport={tagImport}
              findInLibrary={findInLibrary}
            />
          </TabsContent>
          <TabsContent value="manual" className="pt-4">
            <GameForm
              key={round}
              action={createGame}
              initial={defaults}
              showStatus
              seriesNames={seriesNames}
              platformOptions={libraryPlatforms}
              onAdded={handleAdded}
              autoFocusTitle={round > 0}
            />
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}
