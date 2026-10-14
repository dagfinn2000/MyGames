import Link from "next/link";
import { redirect } from "next/navigation";
import { PlayStatus, type Prisma } from "@prisma/client";
import { LibraryBig, Plus } from "lucide-react";
import { auth } from "@/auth";
import { BULK_MAX_IDS } from "@/lib/bulk";
import { orderByIds } from "@/lib/library-order";
import { prisma } from "@/lib/prisma";
import { getPreferences } from "@/lib/current-user";
import { calendarDay } from "@/lib/dates";
import {
  groupGames,
  seriesHeading,
  seriesProgress,
  sliceGroups,
  sortGames,
  type SortOptions,
} from "@/lib/library-sort";
import { parseFilters } from "@/lib/library-filters";
import { resolveGameWhere } from "@/lib/library-where";
import { naturalDir, parseLibraryView } from "@/lib/library-view";
import { seriesKey } from "@/lib/series";
import { canonicalViewQuery } from "@/lib/saved-views";
import { FilterBar, type FilterValues } from "@/components/filter-bar";
import { LibraryView } from "@/components/library-view";
import { SavedViewChips } from "@/components/saved-view-chips";
import { ShelfChips } from "@/components/shelf-chips";
import { ShelfTabs } from "@/components/shelf-tabs";
import { Button } from "@/components/ui/button";

export const dynamic = "force-dynamic";

/** Cards rendered per page load, and the ceiling "Show more" can reach.
 *  The cap keeps a crafted ?limit= from asking the server to serialize an
 *  entire library in one response. It is bulk edit's id limit too, so
 *  "Select all" after Show more always fits. */
const DEFAULT_PAGE_SIZE = 200;
const MAX_PAGE_SIZE = BULK_MAX_IDS;

function param(v: string | string[] | undefined): string {
  return typeof v === "string" ? v : "";
}

/** What the library page fetches per game: the card fields plus the sort
 *  and group keys (toCardGame drops the ones cards don't render before they
 *  reach the client). Everything else on Game — description, review,
 *  searchText, … — would be serialized into the client payload for every
 *  game on every visit, for nothing. */
const librarySelect = {
  id: true,
  title: true,
  developers: true,
  platform: true,
  coverUrl: true,
  status: true,
  rating: true,
  playedMinutes: true,
  lengthMinutes: true,
  seriesName: true,
  seriesNumber: true,
  dateFinished: true,
  createdAt: true,
  // Sort and group keys.
  dateStarted: true,
  releaseDate: true,
  updatedAt: true,
  format: true,
  ownership: true,
  tags: true,
  // Just enough to know whether the copy is out — one row at most, rather
  // than the loan history the card would never render.
  loans: { where: { returnedAt: null }, select: { id: true }, take: 1 },
} satisfies Prisma.GameSelect;

/** What the card actually receives: the selected columns with the open-loan
 *  probe collapsed into a boolean. */
type LibraryGame = Omit<
  Prisma.GameGetPayload<{ select: typeof librarySelect }>,
  "loans"
> & { lentOut: boolean };

/** A game as its card gets it: the fields only sorting and grouping read
 *  stay on the server. */
function toCardGame<B extends LibraryGame & { shelves?: unknown }>({
  dateStarted: _dateStarted,
  releaseDate: _releaseDate,
  updatedAt: _updatedAt,
  format: _format,
  tags: _tags,
  shelves: _shelves,
  ...card
}: B) {
  return card;
}

export default async function GamesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login"); // revoked session (see auth.ts)
  const userId = session.user.id;

  const sp = await searchParams;
  const prefs = await getPreferences();

  // Saved views are needed up front: a bare visit to /games (the nav link,
  // the installed app) opens on the default saved view when there is one.
  // Every link the page itself makes carries explicit params, so this only
  // ever fires on the way in.
  const savedViews = await prisma.savedView.findMany({
    where: { userId },
    select: { id: true, name: true, query: true },
    orderBy: { name: "asc" },
  });
  if (Object.keys(sp).length === 0 && prefs.defaultViewId) {
    const start = savedViews.find((v) => v.id === prefs.defaultViewId);
    if (start) redirect(`/games?${start.query}`);
  }

  // Explicit view params in the URL win (the filter bar always writes them);
  // a param-less visit — the nav link, a bookmark — falls back to the view
  // saved on the account, so the chosen sort survives clicking away.
  const hasViewParams =
    sp.sort !== undefined || sp.dir !== undefined || sp.group !== undefined;

  const filters = parseFilters(sp);
  const where = await resolveGameWhere(userId, filters, prefs);

  // How many cards to render. Sorting and grouping stay in JS — the
  // article and series-block rules have no SQL equivalent — so the
  // whole filtered set is still fetched and ordered here, but only this many
  // games are serialized into the client payload. "Show more" raises it via
  // the URL, like every other bit of view state in this app.
  const limit = Math.min(
    Math.max(parseInt(param(sp.limit), 10) || DEFAULT_PAGE_SIZE, DEFAULT_PAGE_SIZE),
    MAX_PAGE_SIZE,
  );

  const [
    games,
    statusCounts,
    tagRows,
    platformRows,
    shelves,
    viewUser,
    gameFinishes,
    pastFinishes,
  ] = await Promise.all([
    prisma.game.findMany({ where, select: librarySelect }),
    prisma.game.groupBy({
      by: ["status"],
      where: { userId },
      _count: { _all: true },
    }),
    // Tag names + occurrence counts across the whole library, aggregated in
    // SQL instead of shipping every game's tags array out of the database.
    prisma.$queryRaw<{ tag: string; count: number }[]>`
      SELECT t AS tag, COUNT(*)::int AS count
      FROM "Game", LATERAL unnest("tags") AS t
      WHERE "userId" = ${userId}
      GROUP BY t`,
    // Every platform in the library, once each, for the platform filter.
    prisma.game.findMany({
      where: { userId, platform: { not: null } },
      distinct: ["platform"],
      select: { platform: true },
    }),
    prisma.shelf.findMany({
      where: { userId },
      include: { _count: { select: { games: true } } },
      orderBy: { name: "asc" },
    }),
    // The saved view only affects sort/group and how cards are drawn,
    // never the where clause, so its lookup can ride in the same round of
    // queries.
    prisma.user.findUnique({
      where: { id: userId },
      select: { libraryView: true },
    }),
    // The span of years anything was finished in, for "Finished in".
    prisma.game.aggregate({
      where: { userId, status: PlayStatus.COMPLETED },
      _min: { dateFinished: true },
      _max: { dateFinished: true },
    }),
    prisma.playthrough.aggregate({
      where: { game: { userId } },
      _min: { dateFinished: true },
      _max: { dateFinished: true },
    }),
  ]);

  const accountView = parseLibraryView(viewUser?.libraryView);
  // Sort and grouping from the account only fill in a param-less visit; the
  // display settings (card size, layout, card details) always apply.
  const savedView = hasViewParams ? parseLibraryView(null) : accountView;

  const sortParam = param(sp.sort);
  const values: FilterValues = {
    ...filters,
    group: param(sp.group) || savedView.group,
    sort: sortParam || savedView.sort,
    // A link with a sort but no direction (an old bookmark, say) opens that
    // sort the natural way round, as picking it in the menu would.
    dir: param(sp.dir) || (sortParam ? naturalDir(sortParam) : savedView.dir),
  };

  // "Finished in" offers this year back to the first year anything was
  // finished (a hundred at most), plus a year already in the URL.
  const yearOf = (d: Date | null) =>
    d ? Number(calendarDay(d, prefs.timeZone).slice(0, 4)) : null;
  const thisYear = Number(calendarDay(new Date(), prefs.timeZone).slice(0, 4));
  const finishYears = [gameFinishes._min, gameFinishes._max, pastFinishes._min, pastFinishes._max]
    .map((a) => yearOf(a.dateFinished))
    .filter((y): y is number => y !== null);
  const newestYear = Math.max(thisYear, ...finishYears);
  const oldestYear = Math.max(Math.min(thisYear, ...finishYears), newestYear - 99);
  const finishedYears: number[] = [];
  for (let y = newestYear; y >= oldestYear; y--) finishedYears.push(y);
  if (values.finished && !finishedYears.includes(Number(values.finished))) {
    finishedYears.push(Number(values.finished));
    finishedYears.sort((a, b) => b - a);
  }

  // Group by shelf needs each game's shelves: one query over the shelves
  // rather than a join on every game in every other view.
  const shelvesOf = new Map<string, { id: string; name: string }[]>();
  if (values.group === "shelf") {
    const memberships = await prisma.shelf.findMany({
      where: { userId },
      select: { id: true, name: true, games: { select: { id: true } } },
    });
    for (const s of memberships) {
      for (const b of s.games) {
        shelvesOf.set(b.id, [...(shelvesOf.get(b.id) ?? []), { id: s.id, name: s.name }]);
      }
    }
  }

  // Sort and group the whole filtered set — the shelf-filing rules need every
  // game to place any of them — then hand the client only the slice it
  // renders. Passing all of them was the page's real cost: a 20k-game library
  // serialized ~6.7 MB of props to draw two hundred cards.
  // Flatten the open-loan probe into a boolean before sorting, so the client
  // payload carries a flag rather than a relation.
  const withLoanFlag = games.map(({ loans, ...b }) => ({
    ...b,
    lentOut: loans.length > 0,
    shelves: shelvesOf.get(b.id) ?? [],
  }));

  const sortOptions: SortOptions = {
    ignoreArticles: prefs.ignoreArticles,
    alphabet: prefs.sortAlphabet,
    timeZone: prefs.timeZone,
    ratingStyle: prefs.ratingStyle,
    shelfOrder: prefs.shelfOrder,
  };
  const sorted = sortGames(withLoanFlag, values.sort, values.dir, sortOptions);
  const groups = groupGames(sorted, values.group, sortOptions);
  // Grouped views fill their sections up to `limit` entries. A game under
  // three tags is three entries, so the games on screen are the shown
  // sections' games, each once.
  const sliced = groups ? sliceGroups(groups, limit) : null;
  const visibleGames = sliced
    ? [...new Map(sliced.groups.flatMap((g) => g.games).map((b) => [b.id, b])).values()]
    : sorted.slice(0, limit);

  // Series headings say how far through each series the player is. That
  // takes the whole library: on the Want to Play tab, the games already
  // completed aren't on screen.
  if (sliced && values.group === "series") {
    const members = await prisma.game.findMany({
      where: { userId, seriesName: { not: null } },
      select: { seriesName: true, seriesNumber: true, status: true, timesCompleted: true },
    });
    const bySeries = new Map<string, typeof members>();
    for (const m of members) {
      const key = seriesKey(m.seriesName!);
      bySeries.set(key, [...(bySeries.get(key) ?? []), m]);
    }
    for (const g of sliced.groups) {
      const series = g.key === "series:none" ? undefined : bySeries.get(seriesKey(g.title));
      if (series) Object.assign(g, seriesHeading(seriesProgress(series), g.total));
    }
  }

  const counts: Record<string, number> = { all: 0 };
  for (const row of statusCounts) {
    counts[row.status] = row._count._all;
    counts.all += row._count._all;
  }
  // Sorted in JS (not ORDER BY) so tag ordering stays exactly what the
  // previous [...new Set(...)].sort() produced, independent of DB collation.
  const allTags = tagRows.map((r) => r.tag).sort();
  const tagCounts: Record<string, number> = {};
  for (const row of tagRows) tagCounts[row.tag] = row.count;
  // In the player's alphabet, like the platform sections when grouped.
  const platforms = platformRows
    .map((r) => r.platform?.trim() ?? "")
    .filter((p, i, all) => p && all.indexOf(p) === i)
    .sort(new Intl.Collator(prefs.sortAlphabet).compare);

  // Current params as plain strings, for shelf/status links.
  const flatParams: Record<string, string> = {};
  for (const [k, v] of Object.entries(sp)) {
    if (typeof v === "string" && v) flatParams[k] = v;
  }
  // Links built from these (status tabs, shelf chips, "Show more") always
  // name the view they keep. None of them is then a bare /games, which would
  // open the default saved view instead of the shelf that was clicked.
  flatParams.group ||= values.group;
  flatParams.sort ||= values.sort;
  flatParams.dir ||= values.dir;

  const hasFilters =
    !!values.q ||
    !!values.developer ||
    !!values.tag ||
    !!values.notTag ||
    !!values.format ||
    !!values.platform ||
    values.owned !== "all" ||
    !!values.minRating ||
    !!values.finished ||
    !!values.missing ||
    !!values.shelfId ||
    !!values.series;

  return (
    <div className="grid gap-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">Library</h1>
        <Button asChild>
          <Link href="/games/new">
            <Plus data-slot="icon" />
            Add game
          </Link>
        </Button>
      </div>

      <ShelfTabs
        current={values.shelf}
        counts={counts}
        searchParams={flatParams}
        hidden={prefs.hiddenStatusTabs}
      />
      <ShelfChips
        shelves={shelves.map((s) => ({
          id: s.id,
          name: s.name,
          gameCount: s._count.games,
        }))}
        activeShelfId={values.shelfId}
        searchParams={flatParams}
      />
      <SavedViewChips
        views={orderByIds(savedViews, prefs.savedViewOrder)}
        currentQuery={canonicalViewQuery({ ...flatParams, ...values })}
        clearHref={`/games?${new URLSearchParams({
          group: values.group,
          sort: values.sort,
          dir: values.dir,
        })}`}
      />
      <FilterBar
        values={values}
        allTags={allTags}
        tagCounts={tagCounts}
        platforms={platforms}
        display={accountView}
        ratingStyle={prefs.ratingStyle}
        finishedYears={finishedYears}
      />

      {/* Mounted even when nothing matches, so a bulk change that empties
          the view still shows how it went (LibraryView shows `empty`). */}
      <LibraryView
        games={visibleGames.map(toCardGame)}
        groups={
          sliced?.groups.map((g) => ({ ...g, games: g.games.map(toCardGame) })) ?? null
        }
        limit={limit}
        maxLimit={MAX_PAGE_SIZE}
        hasMore={!!sliced && sliced.shownEntries < sliced.totalEntries}
        totalCount={sorted.length}
        searchParams={flatParams}
        shelves={shelves.map((s) => ({ id: s.id, name: s.name }))}
        display={accountView}
        empty={
          <div
            className="flex flex-col items-center gap-3 rounded-lg border border-dashed py-16 text-center"
            data-library-view=""
          >
            <LibraryBig className="size-10 text-muted-foreground/40" />
            <p className="text-muted-foreground">
              {counts.all === 0
                ? "Your library is empty. Add your first game!"
                : hasFilters
                  ? "No games match these filters."
                  : "Nothing on this shelf yet."}
            </p>
            {counts.all === 0 && (
              <Button asChild variant="outline">
                <Link href="/games/new">
                  <Plus data-slot="icon" />
                  Add a game
                </Link>
              </Button>
            )}
          </div>
        }
      />
    </div>
  );
}
