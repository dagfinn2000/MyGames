import { normalizePlatforms } from "@/lib/platforms";
import { cachedLookup } from "./cache";
import type { GameMetadata } from "./types";

/**
 * IGDB client — the richest catalogue (covers, studios, platforms, series
 * and how long a game takes to beat), but it needs a free Twitch developer
 * app: IGDB_CLIENT_ID and IGDB_CLIENT_SECRET. Without them it is simply
 * not asked. https://api-docs.igdb.com/
 *
 * Every request carries an app access token, fetched from Twitch with the
 * client credentials and kept in memory until shortly before it expires.
 */
export function igdbEnabled(): boolean {
  return !!process.env.IGDB_CLIENT_ID && !!process.env.IGDB_CLIENT_SECRET;
}

/** The fields asked for every game: enough for a search row and the
 *  details alike, so one cached answer serves both. */
const GAME_FIELDS = [
  "name",
  "slug",
  "cover.image_id",
  "first_release_date",
  "platforms.name",
  "genres.name",
  "themes.name",
  "involved_companies.company.name",
  "involved_companies.developer",
  "involved_companies.publisher",
  "summary",
  "collections.name",
  "franchises.name",
].join(",");

export interface IgdbGame {
  id?: number;
  name?: string;
  slug?: string;
  cover?: { image_id?: string };
  /** Unix seconds. */
  first_release_date?: number;
  platforms?: { name?: string }[];
  genres?: { name?: string }[];
  themes?: { name?: string }[];
  involved_companies?: {
    company?: { name?: string };
    developer?: boolean;
    publisher?: boolean;
  }[];
  summary?: string;
  collections?: { name?: string }[];
  franchises?: { name?: string }[];
}

export interface IgdbTimeToBeat {
  game_id?: number;
  /** All in seconds. */
  hastily?: number;
  normally?: number;
  completely?: number;
}

// --- Access token -------------------------------------------------------

let token: { value: string; expiresAt: number } | null = null;
/** A token request already on its way, shared by everyone who asks for
 *  one meanwhile, so parallel lookups don't each fetch their own. */
let tokenRequest: Promise<string | null> | null = null;

async function fetchToken(): Promise<string | null> {
  const url = new URL("https://id.twitch.tv/oauth2/token");
  url.searchParams.set("client_id", process.env.IGDB_CLIENT_ID ?? "");
  url.searchParams.set("client_secret", process.env.IGDB_CLIENT_SECRET ?? "");
  url.searchParams.set("grant_type", "client_credentials");
  try {
    const res = await fetch(url, { method: "POST", signal: AbortSignal.timeout(10_000) });
    if (!res.ok) return null;
    const data = (await res.json()) as { access_token?: unknown; expires_in?: unknown };
    if (typeof data.access_token !== "string" || !data.access_token) return null;
    const lifetime = typeof data.expires_in === "number" ? data.expires_in : 0;
    // Renewed a minute early, so a request never sets off with a token that
    // runs out on the way.
    token = { value: data.access_token, expiresAt: Date.now() + (lifetime - 60) * 1000 };
    return token.value;
  } catch {
    return null;
  }
}

/** A usable token, or null when Twitch can't be reached or refuses the
 *  credentials. `renew` drops the one in memory first (IGDB said 401). */
async function accessToken(renew = false): Promise<string | null> {
  if (renew) token = null;
  if (token && Date.now() < token.expiresAt) return token.value;
  tokenRequest ??= fetchToken().finally(() => {
    tokenRequest = null;
  });
  return tokenRequest;
}

/** Forgets the token in memory. For tests, which each stub Twitch afresh. */
export function resetIgdbToken(): void {
  token = null;
  tokenRequest = null;
}

/**
 * One Apicalypse query. Null when it failed, so nothing is cached. A 401
 * means the token was revoked or expired early: it is fetched again once
 * and the query retried.
 */
async function igdbQuery<T>(endpoint: string, body: string): Promise<T | null> {
  for (const renew of [false, true]) {
    const bearer = await accessToken(renew);
    if (!bearer) return null;
    const res = await fetch(`https://api.igdb.com/v4/${endpoint}`, {
      method: "POST",
      headers: {
        "Client-ID": process.env.IGDB_CLIENT_ID ?? "",
        Authorization: `Bearer ${bearer}`,
        Accept: "application/json",
      },
      body,
      signal: AbortSignal.timeout(10_000),
    });
    if (res.status === 401 && !renew) continue;
    if (!res.ok) return null;
    return (await res.json()) as T;
  }
  return null;
}

/** A string as an Apicalypse literal: quoted, with `"` and `\` escaped, so
 *  a title with quotes can't end the query early. */
export function apicalypseString(s: string): string {
  return `"${s.replace(/[\\"]/g, "\\$&")}"`;
}

// --- Parsing (pure) -----------------------------------------------------

/** IGDB's release date (unix seconds) as "YYYY-MM-DD", read in UTC: IGDB
 *  stores dates at midnight UTC, which a local reading could move a day. */
export function igdbDate(seconds: number | undefined): string | null {
  if (typeof seconds !== "number" || !Number.isFinite(seconds)) return null;
  return new Date(seconds * 1000).toISOString().slice(0, 10);
}

/** The cover at a size that stays sharp in the cover picker's grid. */
export function igdbCoverUrl(imageId: string): string {
  return `https://images.igdb.com/igdb/image/upload/t_cover_big_2x/${imageId}.jpg`;
}

/** Minutes to beat per game id. "Normally" is the main story played at an
 *  ordinary pace, the closest to what people mean by how long a game is;
 *  "hastily" (rushing it) only when that is all IGDB has. */
export function parseTimesToBeat(rows: readonly IgdbTimeToBeat[]): Map<number, number> {
  const minutes = new Map<number, number>();
  for (const row of rows) {
    const seconds = (row.normally ?? 0) > 0 ? row.normally! : (row.hastily ?? 0);
    if (typeof row.game_id === "number" && seconds > 0) {
      minutes.set(row.game_id, Math.round(seconds / 60));
    }
  }
  return minutes;
}

function names(list: { name?: string }[] | undefined): string[] {
  return (list ?? []).map((x) => x.name?.trim() ?? "").filter(Boolean);
}

/** One IGDB game as a catalogue row, or null without a name or slug. The
 *  series is the game's first collection ("Portal"), else its franchise. */
export function parseIgdbGame(
  game: IgdbGame,
  timesToBeat: ReadonlyMap<number, number> = new Map(),
): GameMetadata | null {
  const title = game.name?.trim();
  if (!title || !game.slug) return null;
  const companies = game.involved_companies ?? [];
  const companyNames = (role: "developer" | "publisher") => [
    ...new Set(names(companies.filter((c) => c[role]).map((c) => c.company ?? {}))),
  ];
  return {
    title,
    developers: companyNames("developer"),
    publisher: companyNames("publisher")[0] ?? null,
    platforms: normalizePlatforms(names(game.platforms)),
    coverUrl: game.cover?.image_id ? igdbCoverUrl(game.cover.image_id) : null,
    description: game.summary?.trim() || null,
    lengthMinutes: (game.id !== undefined && timesToBeat.get(game.id)) || null,
    releaseDate: igdbDate(game.first_release_date),
    tags: [...new Set([...names(game.genres), ...names(game.themes)])],
    seriesName: names(game.collections)[0] ?? names(game.franchises)[0] ?? null,
    catalogueId: `igdb:${game.slug}`,
    source: "igdb",
  };
}

// --- Lookups ------------------------------------------------------------

/** How long each game takes to beat, best effort: an empty map when IGDB
 *  has no times for them or can't be reached. */
async function timesToBeat(ids: number[]): Promise<Map<number, number>> {
  const unique = [...new Set(ids)].sort((a, b) => a - b);
  if (unique.length === 0) return new Map();
  const list = unique.join(",");
  const rows = await cachedLookup<IgdbTimeToBeat[]>("igdb-ttb", list, () =>
    igdbQuery(
      "game_time_to_beats",
      `fields game_id,normally,hastily,completely; where game_id = (${list}); limit ${unique.length};`,
    ),
  );
  return parseTimesToBeat(rows ?? []);
}

/**
 * Searches IGDB by name. Editions and re-releases that IGDB files under
 * another game (version_parent) are left out, so a search for "Skyrim"
 * isn't a page of Special Editions. Unless `timeToBeat` is false (the
 * cover picker only wants covers), the rows' times to beat are fetched in
 * one more request.
 */
export async function searchIgdb(
  query: string,
  { limit = 10, timeToBeat = true }: { limit?: number; timeToBeat?: boolean } = {},
): Promise<GameMetadata[]> {
  if (!igdbEnabled()) return [];
  const games = await cachedLookup<IgdbGame[]>(
    "igdb-search",
    // The limit is part of the key: the import search (10) and the cover
    // picker (6) must not overwrite each other's cached result lists.
    `${query}|${limit}`,
    () =>
      igdbQuery(
        "games",
        `search ${apicalypseString(query)}; fields ${GAME_FIELDS}; where version_parent = null; limit ${limit};`,
      ),
  );
  // null means the request failed and nothing was cached: an outage, which
  // searchGames needs to tell apart from "no matches".
  if (games === null) throw new Error("IGDB unavailable");
  const times = timeToBeat
    ? await timesToBeat(games.flatMap((g) => (typeof g.id === "number" ? [g.id] : [])))
    : new Map<number, number>();
  return games.map((g) => parseIgdbGame(g, times)).filter((g): g is GameMetadata => g !== null);
}

/** One game by its IGDB slug, with its time to beat. Null when IGDB has no
 *  such game or can't be reached; "not found" isn't cached, so a game IGDB
 *  adds later is found then. */
export async function getIgdbGame(slug: string): Promise<GameMetadata | null> {
  if (!igdbEnabled()) return null;
  const games = await cachedLookup<IgdbGame[]>("igdb-game", slug, async () => {
    const found = await igdbQuery<IgdbGame[]>(
      "games",
      `fields ${GAME_FIELDS}; where slug = ${apicalypseString(slug)}; limit 1;`,
    );
    return found && found.length > 0 ? found : null;
  });
  const game = games?.[0];
  if (!game) return null;
  return parseIgdbGame(game, typeof game.id === "number" ? await timesToBeat([game.id]) : undefined);
}
