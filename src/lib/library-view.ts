/**
 * The library's view preference — which sort/direction/grouping the user
 * last chose, plus how the games are drawn (card size, grid or list, card
 * style, 3D covers, and which details each card shows). Saved on the User
 * row (User.libraryView) whenever it changes in the filter bar. Sort and
 * grouping are applied by the games page when the URL carries no explicit
 * view params, so clicking away and back doesn't reset the view; the
 * display settings always apply.
 *
 * The value lists here are the source of truth shared by the filter bar's
 * dropdowns, the save action's validation, and the games page's fallback —
 * add new sorts/groupings here first.
 */

export const LIBRARY_SORTS = [
  "createdAt",
  "title",
  "developer",
  "rating",
  "dateFinished",
  "dateStarted",
  "length",
  "released",
  "updatedAt",
] as const;

export const LIBRARY_GROUPS = [
  "none",
  "developer",
  "platform",
  "series",
  "yearFinished",
  "status",
  "format",
  "ownership",
  "tag",
  "shelf",
  "rating",
] as const;

export const LIBRARY_DIRS = ["asc", "desc"] as const;

export type LibrarySortKey = (typeof LIBRARY_SORTS)[number];
// Not LibraryGroup: components/library-view.tsx uses that name for a group
// of games.
export type LibraryGroupKey = (typeof LIBRARY_GROUPS)[number];
export type LibraryDir = (typeof LIBRARY_DIRS)[number];

/** The direction each sort opens in when picked: A to Z for words, newest,
 *  highest and longest first for the rest. */
export const NATURAL_DIRS: Record<LibrarySortKey, LibraryDir> = {
  createdAt: "desc",
  title: "asc",
  developer: "asc",
  rating: "desc",
  dateFinished: "desc",
  dateStarted: "desc",
  length: "desc",
  released: "desc",
  updatedAt: "desc",
};

export function naturalDir(sort: string): LibraryDir {
  // Own keys only: `sort` comes from the URL, and ?sort=constructor would
  // otherwise find Object's constructor.
  return Object.hasOwn(NATURAL_DIRS, sort) ? NATURAL_DIRS[sort as LibrarySortKey] : "desc";
}

/** The date a list row shows next to the game, if any. */
export const ROW_DATES = ["none", "added", "finished"] as const;

/** How big the covers are, which sets how many fit across. */
export const CARD_SIZES = ["small", "medium", "large"] as const;

/** Cover grid, or one compact row per game. */
export const LIBRARY_LAYOUTS = ["grid", "list"] as const;

/** How the grid draws each game: a framed card with its details, the bare
 *  cover and title, or covers standing on a shelf. */
export const CARD_STYLES = ["cards", "covers", "shelf"] as const;

// A type alias (not an interface) so it satisfies Prisma's Json input type —
// aliases get an implicit index signature for assignability, interfaces don't.
export type LibraryView = {
  sort: LibrarySortKey;
  dir: LibraryDir;
  group: LibraryGroupKey;
  cardSize: (typeof CARD_SIZES)[number];
  layout: (typeof LIBRARY_LAYOUTS)[number];
  cardStyle: (typeof CARD_STYLES)[number];
  /** Covers drawn as little boxes with depth and a shadow, here and on
   *  every other page; see globals.css. */
  cover3d: boolean;
  showRating: boolean;
  showStatus: boolean;
  showSeries: boolean;
  /** The platform you play it on, under the developers. */
  showPlatform: boolean;
  /** A Wishlist, Borrowed or Given away badge (nothing for owned games). */
  showOwnership: boolean;
  /** List layout only. */
  rowDate: (typeof ROW_DATES)[number];
  /** List layout only: the time to beat ("about 40 h"). */
  showLength: boolean;
};

/** The drawing half of a view — what the View menu changes. */
export type LibraryDisplay = Pick<
  LibraryView,
  | "cardSize"
  | "layout"
  | "cardStyle"
  | "cover3d"
  | "showRating"
  | "showStatus"
  | "showSeries"
  | "showPlatform"
  | "showOwnership"
  | "rowDate"
  | "showLength"
>;

export const DEFAULT_LIBRARY_VIEW: LibraryView = {
  sort: "createdAt",
  dir: "desc",
  group: "none",
  cardSize: "medium",
  layout: "grid",
  cardStyle: "cards",
  cover3d: false,
  showRating: true,
  showStatus: true,
  showSeries: true,
  showPlatform: true,
  showOwnership: false,
  rowDate: "none",
  showLength: false,
};

/** Stored JSON (or anything else) → a safe view, unknown fields defaulted. */
export function parseLibraryView(raw: unknown): LibraryView {
  const obj = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const pick = <T extends readonly string[]>(
    allowed: T,
    value: unknown,
    fallback: T[number],
  ): T[number] =>
    typeof value === "string" && (allowed as readonly string[]).includes(value)
      ? (value as T[number])
      : fallback;
  const bool = (value: unknown, fallback: boolean) =>
    typeof value === "boolean" ? value : fallback;
  const d = DEFAULT_LIBRARY_VIEW;
  return {
    sort: pick(LIBRARY_SORTS, obj.sort, d.sort),
    dir: pick(LIBRARY_DIRS, obj.dir, d.dir),
    group: pick(LIBRARY_GROUPS, obj.group, d.group),
    cardSize: pick(CARD_SIZES, obj.cardSize, d.cardSize),
    layout: pick(LIBRARY_LAYOUTS, obj.layout, d.layout),
    cardStyle: pick(CARD_STYLES, obj.cardStyle, d.cardStyle),
    cover3d: bool(obj.cover3d, d.cover3d),
    showRating: bool(obj.showRating, d.showRating),
    showStatus: bool(obj.showStatus, d.showStatus),
    showSeries: bool(obj.showSeries, d.showSeries),
    showPlatform: bool(obj.showPlatform, d.showPlatform),
    showOwnership: bool(obj.showOwnership, d.showOwnership),
    rowDate: pick(ROW_DATES, obj.rowDate, d.rowDate),
    showLength: bool(obj.showLength, d.showLength),
  };
}

/** The known fields of `patch`, each made valid — what a save may write. */
export function cleanLibraryViewPatch(patch: unknown): Partial<LibraryView> {
  if (!patch || typeof patch !== "object") return {};
  // Own keys only, like naturalDir: `in` would let "constructor" through.
  const keys = Object.keys(patch).filter((k) =>
    Object.hasOwn(DEFAULT_LIBRARY_VIEW, k),
  ) as (keyof LibraryView)[];
  const parsed = parseLibraryView({ ...DEFAULT_LIBRARY_VIEW, ...patch });
  const out: Partial<LibraryView> = {};
  for (const k of keys) (out as Record<string, unknown>)[k] = parsed[k];
  return out;
}
