/** Normalized game metadata, independent of which API it came from. */
export interface GameMetadata {
  title: string;
  authors: string[];
  isbn: string | null;
  coverUrl: string | null;
  description: string | null;
  pageCount: number | null;
  publishedDate: string | null;
  tags: string[];
  openLibraryId: string | null;
  source: "openlibrary" | "googlebooks" | "nb";
}

/** A candidate cover image offered by the cover picker. */
export interface CoverCandidate {
  url: string;
  source: GameMetadata["source"];
}

/** Human-readable source names — shown on search results and cover
 *  candidates so mixed-source lists say where each row came from. */
export const SOURCE_LABELS: Record<GameMetadata["source"], string> = {
  openlibrary: "Open Library",
  googlebooks: "Google Games",
  nb: "nb.no",
};

/** Extra fields fetched lazily when the user picks a search result. */
export interface GameDetails {
  description: string | null;
  pageCount: number | null;
  tags: string[];
  coverUrl: string | null;
  /** The Open Library work, when one was found (also for a game that came
   *  from another catalogue, through its ISBN). */
  openLibraryId?: string | null;
}
