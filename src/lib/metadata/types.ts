/** The catalogues a game can come from. */
export type GameSource = "igdb" | "steam" | "wikipedia";

/** Normalized game metadata, independent of which catalogue it came from. */
export interface GameMetadata {
  title: string;
  /** The studios that made it. */
  developers: string[];
  publisher: string | null;
  /** Every platform the catalogue lists the game on, in its own order, with
   *  everyday names ("Nintendo Switch", "PlayStation 5", "PC"). */
  platforms: string[];
  coverUrl: string | null;
  description: string | null;
  /** How long the main story usually takes, in minutes. */
  lengthMinutes: number | null;
  /** "2017", "2017-03" or "2017-03-03". */
  releaseDate: string | null;
  /** Genres and themes, as the catalogue words them. */
  tags: string[];
  seriesName: string | null;
  /** The catalogue's own key, prefixed by catalogue: "igdb:<slug>"
   *  ("igdb:portal-2"), "steam:<app id>" ("steam:620") or
   *  "wikidata:<Q-id>" ("wikidata:Q279744"). See lib/metadata/links.ts. */
  catalogueId: string | null;
  source: GameSource;
}

/** A candidate cover image offered by the cover picker. */
export interface CoverCandidate {
  url: string;
  source: GameSource;
}

/** Human-readable source names — shown on search results and cover
 *  candidates so mixed-source lists say where each row came from. */
export const SOURCE_LABELS: Record<GameSource, string> = {
  igdb: "IGDB",
  steam: "Steam",
  wikipedia: "Wikipedia",
};

/** The fuller record fetched when the player picks a search result, or asks
 *  "Look up details" on the edit page. Every field may be missing. */
export interface GameDetails {
  description: string | null;
  lengthMinutes: number | null;
  tags: string[];
  coverUrl: string | null;
  developers: string[];
  publisher: string | null;
  platforms: string[];
  releaseDate: string | null;
  seriesName: string | null;
  /** The entry the details came from, when one was found (also for a game
   *  that was matched by title rather than by id). */
  catalogueId: string | null;
}
