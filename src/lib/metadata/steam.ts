import { cachedLookup } from "./cache";
import type { GameMetadata } from "./types";

/**
 * Steam store client — keyless, PC games only, but it knows nearly every
 * one of them, small indie releases included. The store search gives a
 * name, the platforms and a small capsule image; the app's details give
 * the rest. These are the store's own endpoints, not the documented Web
 * API, so every field is treated as optional.
 */
const STORE = "https://store.steampowered.com/api";
const ASSETS = "https://shared.akamai.steamstatic.com/store_item_assets/steam/apps";

export interface SteamPlatforms {
  windows?: boolean;
  mac?: boolean;
  linux?: boolean;
}

export interface SteamSearchItem {
  type?: string;
  id?: number;
  name?: string;
  tiny_image?: string;
  platforms?: SteamPlatforms;
}

export interface SteamSearchResponse {
  items?: SteamSearchItem[];
}

export interface SteamAppData {
  type?: string;
  name?: string;
  short_description?: string;
  header_image?: string;
  developers?: string[];
  publishers?: string[];
  genres?: { description?: string }[];
  release_date?: { coming_soon?: boolean; date?: string };
  platforms?: SteamPlatforms;
}

/** appdetails answers with the app id as the key. */
export type SteamAppResponse = Record<string, { success?: boolean; data?: SteamAppData }>;

// --- Parsing (pure) -----------------------------------------------------

/** Steam's platform flags in everyday names. */
export function steamPlatforms(p: SteamPlatforms | undefined): string[] {
  const out: string[] = [];
  if (p?.windows) out.push("PC");
  if (p?.mac) out.push("Mac");
  if (p?.linux) out.push("Linux");
  return out;
}

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

/**
 * A store release date as "YYYY-MM-DD", "YYYY-MM" or "YYYY". The store
 * writes it as people read it, in more than one order ("14 Nov, 2023",
 * "Nov 14, 2023", "November 2023", "Q1 2024", "2024"); anything without a
 * year ("Coming soon", "To be announced") is null.
 */
export function parseSteamDate(text: string | undefined): string | null {
  const s = (text ?? "").toLowerCase().replace(/[,.]/g, " ");
  const year = /\b(\d{4})\b/.exec(s)?.[1];
  if (!year) return null;
  const words = s.match(/[a-z]+/g) ?? [];
  const month = MONTHS.findIndex((m) => words.some((w) => w.length >= 3 && m === w.slice(0, 3)));
  if (month < 0) return year;
  const mm = String(month + 1).padStart(2, "0");
  const day = Number(/\b(\d{1,2})\b/.exec(s)?.[1]);
  const valid =
    day >= 1 && new Date(Date.UTC(Number(year), month, day)).getUTCMonth() === month;
  return valid ? `${year}-${mm}-${String(day).padStart(2, "0")}` : `${year}-${mm}`;
}

/** Text from the store, which comes with HTML entities ("&quot;") and now
 *  and then a tag, as plain text. */
export function decodeHtml(text: string): string {
  const named: Record<string, string> = {
    amp: "&",
    lt: "<",
    gt: ">",
    quot: '"',
    apos: "'",
    nbsp: " ",
    ndash: "–",
    mdash: "—",
    hellip: "…",
    rsquo: "’",
    lsquo: "‘",
    rdquo: "”",
    ldquo: "“",
    trade: "™",
    reg: "®",
    copy: "©",
  };
  return text
    .replace(/<[^>]*>/g, " ")
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, code: string) => {
      if (code[0] === "#") {
        const n = code[1].toLowerCase() === "x" ? parseInt(code.slice(2), 16) : Number(code.slice(1));
        return Number.isInteger(n) && n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : whole;
      }
      return named[code.toLowerCase()] ?? whole;
    })
    .replace(/\s+/g, " ")
    .trim();
}

/** The store's portrait library art for an app: the closest thing Steam
 *  has to a box cover. Not every app has it at this address (see
 *  steamCoverArt). */
export function steamPortraitUrl(appId: string | number): string {
  return `${ASSETS}/${appId}/library_600x900_2x.jpg`;
}

/** Soundtracks are apps on the store too, but never what a player is
 *  looking for. */
const SOUNDTRACK = /\b(soundtrack|ost)\b/i;

/** Search hits as catalogue rows: apps only (no bundles or packages), and
 *  no soundtracks. The capsule image stands in as the cover until the
 *  details bring the portrait art. */
export function parseSteamSearch(data: SteamSearchResponse, limit = 10): GameMetadata[] {
  return (data.items ?? [])
    .filter((i) => i.type === "app" && typeof i.id === "number" && i.name?.trim())
    .filter((i) => !SOUNDTRACK.test(i.name!))
    .slice(0, limit)
    .map((i) => ({
      title: i.name!.trim(),
      developers: [],
      publisher: null,
      platforms: steamPlatforms(i.platforms),
      coverUrl: i.tiny_image ?? null,
      description: null,
      lengthMinutes: null,
      releaseDate: null,
      tags: [],
      seriesName: null,
      catalogueId: `steam:${i.id}`,
      source: "steam" as const,
    }));
}

/** One app's details as a catalogue row, its header image as the cover.
 *  Null when the store has nothing for that id. */
export function parseSteamApp(appId: string, data: SteamAppResponse): GameMetadata | null {
  const entry = data[appId];
  const app = entry?.success ? entry.data : undefined;
  const title = app?.name?.trim();
  if (!app || !title) return null;
  const list = (xs: string[] | undefined) => [...new Set((xs ?? []).map((x) => x.trim()).filter(Boolean))];
  const description = app.short_description ? decodeHtml(app.short_description) : "";
  return {
    title,
    developers: list(app.developers),
    publisher: list(app.publishers)[0] ?? null,
    platforms: steamPlatforms(app.platforms),
    coverUrl: app.header_image ?? null,
    description: description || null,
    lengthMinutes: null,
    releaseDate: parseSteamDate(app.release_date?.date),
    tags: list(app.genres?.map((g) => g.description ?? "")),
    seriesName: null,
    catalogueId: `steam:${appId}`,
    source: "steam",
  };
}

// --- Lookups ------------------------------------------------------------

async function getJson<T>(url: string): Promise<T | null> {
  const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) return null;
  return (await res.json()) as T;
}

/** Searches the Steam store by name. */
export async function searchSteam(
  query: string,
  { limit = 10 }: { limit?: number } = {},
): Promise<GameMetadata[]> {
  // The store always answers with up to ten hits, so the limit isn't part
  // of the key: it only trims the cached list.
  const data = await cachedLookup<SteamSearchResponse>("steam-search", query, () => {
    const url = new URL(`${STORE}/storesearch/`);
    url.searchParams.set("term", query);
    url.searchParams.set("l", "english");
    url.searchParams.set("cc", "US");
    return getJson(url.toString());
  });
  // null: failed and nothing cached (see searchIgdb).
  if (data === null) throw new Error("Steam unavailable");
  return parseSteamSearch(data, limit);
}

/**
 * The portrait art for an app when it exists, else null. Newer apps keep
 * their art under hashed paths, so the plain address 404s for them; a
 * HEAD request tells. The answer is cached either way: art doesn't come
 * and go. A request that failed isn't, and counts as no art for now.
 */
export async function steamCoverArt(appId: string): Promise<string | null> {
  const url = steamPortraitUrl(appId);
  const found = await cachedLookup<{ exists: boolean }>("steam-art", appId, async () => {
    const res = await fetch(url, { method: "HEAD", signal: AbortSignal.timeout(8_000) });
    if (res.ok) return { exists: true };
    return res.status === 404 || res.status === 403 ? { exists: false } : null;
  });
  return found?.exists ? url : null;
}

/** One app by its id, with the portrait art as its cover when Steam has
 *  it (the header image otherwise). Null when the store doesn't know the
 *  app or can't be reached; neither is cached. */
export async function getSteamGame(appId: string): Promise<GameMetadata | null> {
  const data = await cachedLookup<SteamAppResponse>("steam-app", appId, async () => {
    const url = new URL(`${STORE}/appdetails`);
    url.searchParams.set("appids", appId);
    url.searchParams.set("l", "english");
    const found = await getJson<SteamAppResponse>(url.toString());
    return found?.[appId]?.success ? found : null;
  });
  const game = data ? parseSteamApp(appId, data) : null;
  if (!game) return null;
  const art = await steamCoverArt(appId);
  return art ? { ...game, coverUrl: art } : game;
}
