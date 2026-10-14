import { SOURCE_LABELS, type GameSource } from "./types";

/**
 * Game.catalogueId, read back: which catalogue an entry is from, and the
 * public page for it. Client-safe (no fetching), so the game page can link
 * to the entry and the metadata code can route a lookup to the right
 * catalogue with the same parsing.
 *
 * The ids look like "igdb:portal-2" (IGDB's slug), "steam:620" (the Steam
 * app id) and "wikidata:Q279744" (the Wikidata item behind the Wikipedia
 * article).
 */

const PATTERNS: { prefix: string; source: GameSource; key: RegExp }[] = [
  { prefix: "igdb:", source: "igdb", key: /^[a-z0-9][a-z0-9-]*$/i },
  { prefix: "steam:", source: "steam", key: /^\d+$/ },
  { prefix: "wikidata:", source: "wikipedia", key: /^Q\d+$/ },
];

/** The catalogue and its own key for a catalogueId, or null for anything
 *  that isn't one (empty, or an id from some other app). */
export function parseCatalogueId(
  catalogueId: string | null | undefined,
): { source: GameSource; key: string } | null {
  const id = catalogueId?.trim() ?? "";
  for (const { prefix, source, key } of PATTERNS) {
    if (!id.startsWith(prefix)) continue;
    const rest = id.slice(prefix.length);
    return key.test(rest) ? { source, key: rest } : null;
  }
  return null;
}

/** The entry's page on its catalogue, with the catalogue's name to show,
 *  or null when there is no (valid) catalogueId. A Wikidata item opens its
 *  English Wikipedia article, which is the page worth reading. */
export function catalogueLink(catalogueId: string | null): { label: string; url: string } | null {
  const parsed = parseCatalogueId(catalogueId);
  if (!parsed) return null;
  const label = SOURCE_LABELS[parsed.source];
  switch (parsed.source) {
    case "igdb":
      return { label, url: `https://www.igdb.com/games/${parsed.key.toLowerCase()}` };
    case "steam":
      return { label, url: `https://store.steampowered.com/app/${parsed.key}` };
    case "wikipedia":
      return {
        label,
        url: `https://www.wikidata.org/wiki/Special:GoToLinkedPage/enwiki/${parsed.key}`,
      };
  }
}
