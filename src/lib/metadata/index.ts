import type { Catalogue } from "@/lib/preferences";
import { getIgdbGame, igdbEnabled, searchIgdb } from "./igdb";
import { parseCatalogueId } from "./links";
import { releaseYear, titleKey } from "./match";
import { getSteamGame, searchSteam, steamCoverArt } from "./steam";
import { getWikipediaGame, searchWikipedia } from "./wikipedia";
import type { CoverCandidate, GameDetails, GameMetadata, GameSource } from "./types";

export type { GameDetails, GameMetadata, CoverCandidate };
export { igdbEnabled };

/** Thrown by searchGames when not one catalogue answered, so callers can say
 *  "couldn't reach the catalogues" instead of "no results". */
export class CataloguesUnreachableError extends Error {
  constructor() {
    super("Couldn't reach the game catalogues");
    this.name = "CataloguesUnreachableError";
  }
}

/** Every catalogue, in the default priority order. Callers pass the
 *  player's own list (Preferences) to switch some off or reorder them. */
const ALL_CATALOGUES: readonly Catalogue[] = ["igdb", "wikipedia", "steam"];

/** The catalogues worth asking: the chosen ones, minus IGDB when this
 *  server has no Twitch credentials for it. A list that leaves nothing
 *  (IGDB only, on a server without them) falls back to the keyless two. */
function askable(sources: readonly Catalogue[]): Catalogue[] {
  const asked = sources.filter((s) => s !== "igdb" || igdbEnabled());
  return asked.length > 0 ? asked : ["wikipedia", "steam"];
}

/** `row` with its empty fields filled from `twin`, a row for the same game
 *  from another catalogue. Its own values always win. */
function fillGaps(row: GameMetadata, twin: GameMetadata): GameMetadata {
  return {
    ...row,
    coverUrl: row.coverUrl ?? twin.coverUrl,
    description: row.description ?? twin.description,
    developers: row.developers.length > 0 ? row.developers : twin.developers,
    publisher: row.publisher ?? twin.publisher,
    platforms: row.platforms.length > 0 ? row.platforms : twin.platforms,
    lengthMinutes: row.lengthMinutes ?? twin.lengthMinutes,
    releaseDate: row.releaseDate ?? twin.releaseDate,
    seriesName: row.seriesName ?? twin.seriesName,
  };
}

/**
 * The catalogues' rows (in priority order) with each game listed once.
 * Rows from different catalogues are the same game when their titles match
 * (see titleKey) and so do their release years. The first row stays, filled
 * in from the rest; two rows from the same catalogue are two entries there
 * and are both kept.
 *
 * A row without a year (Steam's search never gives one) is matched by title
 * alone, but only when that leaves no doubt: it joins the one row of that
 * title that has a year, or another row without one. Next to Doom (1993)
 * and Doom (2016) a yearless "DOOM" could be either, so it stays its own
 * row rather than lending its cover or description to the wrong game.
 */
function mergeDuplicates(rows: readonly GameMetadata[]): GameMetadata[] {
  type Kept = { row: GameMetadata; key: string; year: string | null; from: Set<GameSource> };
  const kept: Kept[] = [];
  for (const row of rows) {
    const key = titleKey(row.title);
    const year = releaseYear(row.releaseDate);
    const twin = kept.find((k) => k.key === key && k.year === year && !k.from.has(row.source));
    if (twin) {
      twin.row = fillGaps(twin.row, row);
      twin.from.add(row.source);
    } else {
      kept.push({ row, key, year, from: new Set([row.source]) });
    }
  }

  // Then the yearless rows, once every dated row of their title is known.
  for (let i = 0; i < kept.length; i++) {
    const loose = kept[i];
    if (loose.year !== null) continue;
    const dated = kept.filter((k) => k.key === loose.key && k.year !== null);
    if (dated.length !== 1) continue;
    const [twin] = dated;
    if ([...loose.from].some((s) => twin.from.has(s))) continue;
    // Whichever comes first in the player's order stays, as above.
    const [first, second] = kept.indexOf(twin) < i ? [twin, loose] : [loose, twin];
    first.row = fillGaps(first.row, second.row);
    first.year = twin.year;
    for (const s of second.from) first.from.add(s);
    kept.splice(kept.indexOf(second), 1);
    if (second === loose) i--;
  }
  return kept.map((k) => k.row);
}

/**
 * Searches the catalogues in parallel and returns all their results, in
 * priority order: by default IGDB first (when this server is set up for
 * it), then Wikipedia, then Steam; `sources` is the player's own choice
 * and order from Preferences. No catalogue knows every game well — Steam
 * has the small PC releases, IGDB the consoles and the times to beat,
 * Wikipedia the older and better-known games — so they are shown side by
 * side rather than as fallbacks for each other, with the rows for one game
 * merged (see mergeDuplicates).
 *
 * One catalogue failing is normal and its rows are simply missing. If
 * every catalogue asked failed, this throws CataloguesUnreachableError.
 */
export async function searchGames(
  query: string,
  sources: readonly Catalogue[] = ALL_CATALOGUES,
): Promise<GameMetadata[]> {
  const search: Record<Catalogue, () => Promise<GameMetadata[]>> = {
    igdb: () => searchIgdb(query),
    wikipedia: () => searchWikipedia(query),
    steam: () => searchSteam(query),
  };
  const settled = await Promise.allSettled(askable(sources).map((s) => search[s]()));
  if (settled.every((s) => s.status === "rejected")) throw new CataloguesUnreachableError();
  return mergeDuplicates(settled.flatMap((s) => (s.status === "fulfilled" ? s.value : [])));
}

/** One catalogue entry by its catalogueId, or null when the id isn't one,
 *  its catalogue is switched off, or the entry can't be fetched. */
async function getEntry(
  catalogueId: string | null | undefined,
  asked: readonly Catalogue[],
): Promise<GameMetadata | null> {
  const parsed = parseCatalogueId(catalogueId);
  if (!parsed || !asked.includes(parsed.source)) return null;
  const fetchers: Record<GameSource, (key: string) => Promise<GameMetadata | null>> = {
    igdb: getIgdbGame,
    steam: getSteamGame,
    wikipedia: getWikipediaGame,
  };
  return fetchers[parsed.source](parsed.key).catch(() => null);
}

/** IGDB's game with exactly this title (see titleKey), preferring the one
 *  released in `year` when there are several (remakes keep the name). */
async function igdbByTitle(title: string, year: string | null): Promise<GameMetadata | null> {
  const key = titleKey(title);
  if (!key) return null;
  const rows = await searchIgdb(title).catch(() => []);
  const same = rows.filter((r) => titleKey(r.title) === key);
  return same.find((r) => year !== null && releaseYear(r.releaseDate) === year) ?? same[0] ?? null;
}

const NO_DETAILS: GameDetails = {
  description: null,
  lengthMinutes: null,
  tags: [],
  coverUrl: null,
  developers: [],
  publisher: null,
  platforms: [],
  releaseDate: null,
  seriesName: null,
  catalogueId: null,
};

/**
 * The full record for a game, for the review form after picking a search
 * result and for "Look up details" on the edit page: the entry's own
 * catalogue, by its id. Only IGDB knows how long games take to beat, so
 * for an entry from elsewhere (or no entry at all) IGDB is asked by title
 * when it is set up, and its time counts only for a game with exactly the
 * same title. With no entry to go on, that IGDB game becomes the entry, and
 * its id comes back as `catalogueId`.
 */
export async function getGameDetails(
  params: { catalogueId?: string | null; title?: string | null },
  sources: readonly Catalogue[] = ALL_CATALOGUES,
): Promise<GameDetails> {
  const asked = askable(sources);
  let entry = await getEntry(params.catalogueId, asked);
  const title = entry?.title ?? params.title?.trim() ?? "";

  if (asked.includes("igdb") && title && entry?.source !== "igdb") {
    if (!entry) {
      entry = await igdbByTitle(title, null);
    } else if (entry.lengthMinutes === null) {
      const match = await igdbByTitle(title, releaseYear(entry.releaseDate));
      if (match?.lengthMinutes) entry = { ...entry, lengthMinutes: match.lengthMinutes };
    }
  }
  if (!entry) return NO_DETAILS;

  return {
    description: entry.description,
    lengthMinutes: entry.lengthMinutes,
    tags: entry.tags,
    coverUrl: entry.coverUrl,
    developers: entry.developers,
    publisher: entry.publisher,
    platforms: entry.platforms,
    releaseDate: entry.releaseDate,
    seriesName: entry.seriesName,
    catalogueId: entry.catalogueId,
  };
}

/** Steam rows' portrait art, for the first few hits only: each one is a
 *  request of its own, and further down the list is rarely the game. */
async function steamCovers(title: string): Promise<CoverCandidate[]> {
  const hits = await searchSteam(title, { limit: 4 }).catch(() => []);
  const art = await Promise.all(
    hits.map((h) => {
      const parsed = parseCatalogueId(h.catalogueId);
      return parsed ? steamCoverArt(parsed.key) : null;
    }),
  );
  return art.flatMap((url) => (url ? [{ url, source: "steam" as const }] : []));
}

/**
 * Gathers candidate covers from every catalogue for the cover picker. The
 * entry's own cover comes first — most likely the one wanted — then covers
 * from a title search in each catalogue. All are asked in parallel and
 * failures are simply dropped.
 */
export async function getCoverCandidates(
  params: { catalogueId?: string | null; title?: string | null },
  sources: readonly Catalogue[] = ALL_CATALOGUES,
): Promise<CoverCandidate[]> {
  const title = params.title?.trim() ?? "";
  const asked = askable(sources);

  const covers = (rows: GameMetadata[]): CoverCandidate[] =>
    rows.flatMap((r) => (r.coverUrl ? [{ url: r.coverUrl, source: r.source }] : []));
  const search: Record<Catalogue, () => Promise<CoverCandidate[]>> = {
    igdb: () => searchIgdb(title, { limit: 6, timeToBeat: false }).then(covers),
    wikipedia: () => searchWikipedia(title, { limit: 6, facts: false }).then(covers),
    steam: () => steamCovers(title),
  };
  const [entry, ...perSource] = await Promise.all([
    getEntry(params.catalogueId, asked),
    ...asked.map((s) => (title ? search[s]().catch(() => []) : Promise.resolve([]))),
  ]);

  const candidates: CoverCandidate[] = [];
  if (entry?.coverUrl) candidates.push({ url: entry.coverUrl, source: entry.source });
  // Interleaved round-robin so every catalogue keeps a fair share of the
  // capped grid — appended list by list, IGDB and Wikipedia would fill all
  // twelve slots before a single Steam cover showed.
  const longest = Math.max(0, ...perSource.map((l) => l.length));
  for (let i = 0; i < longest; i++) {
    for (const list of perSource) if (list[i]) candidates.push(list[i]);
  }

  // Dedupe by URL, cap the grid at a screenful.
  const seen = new Set<string>();
  return candidates
    .filter((c) => (seen.has(c.url) ? false : (seen.add(c.url), true)))
    .slice(0, 12);
}
