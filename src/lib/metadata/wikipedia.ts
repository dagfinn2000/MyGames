import { normalizePlatforms } from "@/lib/platforms";
import { cachedLookup } from "./cache";
import type { GameMetadata } from "./types";

/**
 * Wikipedia and Wikidata client — keyless. English Wikipedia finds the game
 * (only articles with a video game infobox) and supplies its description
 * and box art; the Wikidata item behind the article supplies the facts:
 * developers, publisher, platforms, genres, release date and series.
 * https://www.mediawiki.org/wiki/API:Main_page
 *
 * Wikimedia asks API clients to send a descriptive User-Agent.
 */
const UA = "mygames/1.0 (self-hosted personal game library)";

const WIKIPEDIA_API = "https://en.wikipedia.org/w/api.php";
const WIKIDATA_API = "https://www.wikidata.org/w/api.php";

/** Wikidata takes at most 50 ids per wbgetentities call. */
const IDS_PER_CALL = 50;

/** Longest description kept from an article's introduction. */
const DESCRIPTION_MAX = 1000;

export interface WikiPage {
  title?: string;
  /** The page's place in the search results. */
  index?: number;
  missing?: boolean;
  extract?: string;
  thumbnail?: { source?: string };
  original?: { source?: string };
  pageprops?: { wikibase_item?: string };
}

export interface WikiQueryResponse {
  query?: { pages?: WikiPage[] };
}

interface WikidataSnak {
  snaktype?: string;
  datavalue?: { value?: unknown };
}

export interface WikidataClaim {
  mainsnak?: WikidataSnak;
  rank?: "preferred" | "normal" | "deprecated";
}

export interface WikidataEntity {
  id?: string;
  missing?: string;
  claims?: Record<string, WikidataClaim[]>;
  sitelinks?: { enwiki?: { title?: string } };
  labels?: { en?: { value?: string } };
}

export interface WikidataResponse {
  entities?: Record<string, WikidataEntity>;
}

/** What a Wikidata item says about a game, with the items it points at
 *  (studios, platforms, genres, series) still as ids. */
export interface WikidataClaims {
  developers: string[];
  publishers: string[];
  platforms: string[];
  genres: string[];
  series: string[];
  releaseDate: string | null;
  /** The English Wikipedia article's title. */
  enwikiTitle: string | null;
}

/** The same with every id put into words. */
export interface WikidataFacts {
  developers: string[];
  publisher: string | null;
  platforms: string[];
  tags: string[];
  seriesName: string | null;
  releaseDate: string | null;
  enwikiTitle: string | null;
  /** The item's own English label: a title for an item with no article. */
  label: string | null;
}

const PROPERTY = {
  developer: "P178",
  publisher: "P123",
  platform: "P400",
  genre: "P136",
  released: "P577",
  series: "P179",
} as const;

// --- Requests -----------------------------------------------------------

async function getJson<T>(api: string, params: Record<string, string>): Promise<T | null> {
  const url = new URL(api);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = await fetch(url, {
    headers: { "User-Agent": UA },
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) return null;
  const data: unknown = await res.json();
  // The action API reports its errors (search too busy, a bad id, ...) with
  // HTTP 200 and an `error` member: a failure, not an answer to cache.
  if (data !== null && typeof data === "object" && "error" in data) return null;
  return data as T;
}

/** The article fields both the search and a single page ask for. */
const PAGE_PARAMS = {
  action: "query",
  format: "json",
  formatversion: "2",
  prop: "pageimages|pageprops|extracts",
  piprop: "thumbnail|original",
  pithumbsize: "600",
  // Box art is non-free, and without this pageimages leaves it out.
  pilicense: "any",
  ppprop: "wikibase_item",
  exintro: "1",
  explaintext: "1",
  exlimit: "max",
};

function chunks<T>(list: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

// --- Parsing (pure) -----------------------------------------------------

/** The result pages in search order: the API returns them unordered,
 *  each with its place as `index`. */
export function parseWikiPages(data: WikiQueryResponse): WikiPage[] {
  return (data.query?.pages ?? [])
    .filter((p) => p.title && !p.missing)
    .sort((a, b) => (a.index ?? Infinity) - (b.index ?? Infinity));
}

/** An article title as a game title: without the "(video game)" or
 *  "(2016 video game)" that only tells Wikipedia's articles apart. */
export function gameTitle(articleTitle: string): string {
  return articleTitle.replace(/\s*\((?:[^()]*\s)?(?:video )?game\)$/i, "").trim();
}

/**
 * An article's introduction as a game description: whole paragraphs while
 * they fit in DESCRIPTION_MAX characters, and always the first. A first
 * paragraph that is longer on its own is cut after its last full sentence
 * that fits.
 */
export function trimExtract(text: string | undefined, max = DESCRIPTION_MAX): string | null {
  const paragraphs = (text ?? "")
    .split(/\n+/)
    .map((p) => p.trim())
    .filter(Boolean);
  if (paragraphs.length === 0) return null;

  let out = paragraphs[0];
  if (out.length > max) {
    // Where each sentence ends: its stop, any closing quote or bracket,
    // then a space or the end of the text.
    let end = 0;
    for (const m of out.matchAll(/[.!?]+["”’)\]]*(?=\s|$)/g)) {
      const stop = m.index + m[0].length;
      if (stop > max) break;
      end = stop;
    }
    return end > 0 ? out.slice(0, end) : `${out.slice(0, max).trimEnd()}…`;
  }
  for (const p of paragraphs.slice(1)) {
    if (out.length + 2 + p.length > max) break;
    out += `\n\n${p}`;
  }
  return out;
}

/** The ids a claim list points at, skipping deprecated statements. */
function itemIds(claims: WikidataClaim[] | undefined): string[] {
  const ids: string[] = [];
  for (const c of claims ?? []) {
    if (c.rank === "deprecated" || c.mainsnak?.snaktype !== "value") continue;
    const value = c.mainsnak.datavalue?.value as { id?: unknown } | undefined;
    if (typeof value?.id === "string" && /^Q\d+$/.test(value.id) && !ids.includes(value.id)) {
      ids.push(value.id);
    }
  }
  return ids;
}

/** A Wikidata time ("+2011-04-19T00:00:00Z") at its precision: 9 is a
 *  year ("2011"), 10 a month ("2011-04"), 11 a day ("2011-04-19"). Null for
 *  anything vaguer (a decade) or BCE. */
export function wikidataTime(value: { time?: unknown; precision?: unknown }): string | null {
  if (typeof value.time !== "string") return null;
  const m = /^\+(\d{4})-(\d{2})-(\d{2})T/.exec(value.time);
  const precision = typeof value.precision === "number" ? value.precision : 0;
  if (!m || precision < 9) return null;
  const [, year, month, day] = m;
  if (precision === 9 || month === "00") return year;
  if (precision === 10 || day === "00") return `${year}-${month}`;
  return `${year}-${month}-${day}`;
}

/** The first release among a game's publication dates (one per region or
 *  platform, often). A vaguer date sorts after the exact ones in the same
 *  year or month: "2011-04-19" beats "2011", but "2010" beats both. */
export function earliestRelease(claims: WikidataClaim[] | undefined): string | null {
  const sortKey = (date: string) => `${date}-99-99`.slice(0, 10);
  let best: string | null = null;
  for (const c of claims ?? []) {
    if (c.rank === "deprecated" || c.mainsnak?.snaktype !== "value") continue;
    const date = wikidataTime((c.mainsnak.datavalue?.value ?? {}) as { time?: unknown });
    if (date && (best === null || sortKey(date) < sortKey(best))) best = date;
  }
  return best;
}

/** What one Wikidata item says about a game, its links still as ids. */
export function parseWikidataEntity(entity: WikidataEntity): WikidataClaims {
  const claims = entity.claims ?? {};
  return {
    developers: itemIds(claims[PROPERTY.developer]),
    publishers: itemIds(claims[PROPERTY.publisher]),
    platforms: itemIds(claims[PROPERTY.platform]),
    genres: itemIds(claims[PROPERTY.genre]),
    series: itemIds(claims[PROPERTY.series]),
    releaseDate: earliestRelease(claims[PROPERTY.released]),
    enwikiTitle: entity.sitelinks?.enwiki?.title ?? null,
  };
}

/** English labels by id, from a wbgetentities answer. */
export function parseLabels(data: WikidataResponse): Map<string, string> {
  const labels = new Map<string, string>();
  for (const [id, entity] of Object.entries(data.entities ?? {})) {
    const label = entity.labels?.en?.value?.trim();
    if (label) labels.set(id, label);
  }
  return labels;
}

/** A genre as a tag: "puzzle video game" says no more than "puzzle". */
function genreTag(label: string): string {
  return label.replace(/\s+video game$/i, "").trim();
}

/** The claims in words. Ids without an English label are left out. */
export function factsInWords(
  claims: WikidataClaims,
  labels: ReadonlyMap<string, string>,
  ownId?: string,
): WikidataFacts {
  const words = (ids: string[]) => ids.flatMap((id) => labels.get(id) ?? []);
  return {
    developers: words(claims.developers),
    publisher: words(claims.publishers)[0] ?? null,
    platforms: normalizePlatforms(words(claims.platforms)),
    tags: [...new Set(words(claims.genres).map(genreTag).filter(Boolean))],
    seriesName: words(claims.series)[0] ?? null,
    releaseDate: claims.releaseDate,
    enwikiTitle: claims.enwikiTitle,
    label: (ownId && labels.get(ownId)) || null,
  };
}

/** An article (and the facts from its Wikidata item, when there are any)
 *  as a catalogue row. Null for a page without a Wikidata item, which has
 *  no id to come back to. */
export function wikiRow(page: WikiPage, facts: WikidataFacts | undefined): GameMetadata | null {
  const qid = page.pageprops?.wikibase_item;
  if (!page.title || !qid) return null;
  return {
    title: gameTitle(page.title),
    developers: facts?.developers ?? [],
    publisher: facts?.publisher ?? null,
    platforms: facts?.platforms ?? [],
    coverUrl: page.thumbnail?.source ?? page.original?.source ?? null,
    description: trimExtract(page.extract),
    lengthMinutes: null,
    releaseDate: facts?.releaseDate ?? null,
    tags: facts?.tags ?? [],
    seriesName: facts?.seriesName ?? null,
    catalogueId: `wikidata:${qid}`,
    source: "wikipedia",
  };
}

// --- Lookups ------------------------------------------------------------

/**
 * The facts for some Wikidata items, by id: their claims, then the labels
 * of everything those point at, each in calls of at most 50 ids. Best
 * effort: an item that couldn't be fetched is just missing from the map,
 * and its game shows with what Wikipedia alone knows.
 */
async function wikidataFacts(qids: readonly string[]): Promise<Map<string, WikidataFacts>> {
  const facts = new Map<string, WikidataFacts>();
  const ids = [...new Set(qids)];
  if (ids.length === 0) return facts;

  const claimsById = new Map<string, WikidataClaims>();
  for (const chunk of chunks(ids, IDS_PER_CALL)) {
    // Only the claims read here are kept: a popular game's item, with every
    // statement and its references, runs to hundreds of kilobytes.
    const claims = await cachedLookup<Record<string, WikidataClaims>>(
      "wiki-claims",
      chunk.join("|"),
      async () => {
        const data = await getJson<WikidataResponse>(WIKIDATA_API, {
          action: "wbgetentities",
          format: "json",
          ids: chunk.join("|"),
          props: "claims|sitelinks",
          sitefilter: "enwiki",
        });
        if (!data) return null;
        return Object.fromEntries(
          Object.entries(data.entities ?? {})
            .filter(([, entity]) => entity.missing === undefined)
            .map(([id, entity]) => [id, parseWikidataEntity(entity)]),
        );
      },
    );
    for (const [id, c] of Object.entries(claims ?? {})) claimsById.set(id, c);
  }

  // The items' own ids too, for a title when an item has no article.
  const referenced = new Set<string>(claimsById.keys());
  for (const c of claimsById.values()) {
    for (const id of [...c.developers, ...c.publishers, ...c.platforms, ...c.genres, ...c.series]) {
      referenced.add(id);
    }
  }
  const labels = new Map<string, string>();
  for (const chunk of chunks([...referenced].sort(), IDS_PER_CALL)) {
    const data = await cachedLookup<WikidataResponse>("wiki-labels", chunk.join("|"), () =>
      getJson(WIKIDATA_API, {
        action: "wbgetentities",
        format: "json",
        ids: chunk.join("|"),
        props: "labels",
        languages: "en",
        // An item may have only a label for all languages ("mul"), which
        // Wikidata now prefers for names; this returns it as the English one.
        languagefallback: "1",
      }),
    );
    for (const [id, label] of parseLabels(data ?? {})) labels.set(id, label);
  }

  for (const [id, claims] of claimsById) facts.set(id, factsInWords(claims, labels, id));
  return facts;
}

/**
 * Searches English Wikipedia for articles about video games (the ones
 * with a video game infobox) and fills in each from its Wikidata item.
 * With `facts` false (the cover picker, which only wants the box art),
 * Wikidata isn't asked.
 */
export async function searchWikipedia(
  query: string,
  { limit = 10, facts = true }: { limit?: number; facts?: boolean } = {},
): Promise<GameMetadata[]> {
  const data = await cachedLookup<WikiQueryResponse>(
    "wiki-search",
    // The limit is part of the key: the import search (10) and the cover
    // picker (6) must not overwrite each other's cached result lists.
    `${query}|${limit}`,
    () =>
      getJson(WIKIPEDIA_API, {
        ...PAGE_PARAMS,
        generator: "search",
        // The filter first: a search starting "Portal: ..." would otherwise
        // search the Portal namespace.
        gsrsearch: `hastemplate:"Infobox video game" ${query}`,
        gsrnamespace: "0",
        gsrlimit: String(limit),
      }),
  );
  // null: failed and nothing cached (see searchIgdb).
  if (data === null) throw new Error("Wikipedia unavailable");
  const pages = parseWikiPages(data);
  const byId = facts
    ? await wikidataFacts(pages.flatMap((p) => p.pageprops?.wikibase_item ?? []))
    : new Map<string, WikidataFacts>();
  return pages
    .map((p) => wikiRow(p, byId.get(p.pageprops?.wikibase_item ?? "")))
    .filter((r): r is GameMetadata => r !== null);
}

/**
 * One game by its Wikidata item: the item's facts, then its English
 * article for the description and box art. Null when Wikidata doesn't know
 * the item or can't be reached. An item without an article still gives
 * its facts, under its Wikidata label.
 */
export async function getWikipediaGame(qid: string): Promise<GameMetadata | null> {
  const facts = (await wikidataFacts([qid])).get(qid);
  if (!facts) return null;

  let page: WikiPage | undefined;
  if (facts.enwikiTitle) {
    const data = await cachedLookup<WikiQueryResponse>("wiki-page", facts.enwikiTitle, () =>
      getJson(WIKIPEDIA_API, { ...PAGE_PARAMS, titles: facts.enwikiTitle!, redirects: "1" }),
    );
    page = data ? parseWikiPages(data)[0] : undefined;
  }
  const title = page?.title ?? facts.enwikiTitle ?? facts.label;
  if (!title) return null;
  return wikiRow(
    { ...page, title, pageprops: { wikibase_item: qid } },
    facts,
  );
}
