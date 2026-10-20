/**
 * The colours of the drawn cover a game gets when it has no box art
 * (GameCover in components/game-card.tsx), and the words on the band of
 * its system across the top (bandLabel, below).
 *
 * Everything but the band comes from the title, so a game keeps the same
 * cover on every page and every visit, and different titles spread around
 * the colour wheel instead of all coming out one shade. Saturation and
 * lightness stay in a range dark enough for the pale title text to read
 * on any hue.
 */
export interface CoverArt {
  /** 0–359 */
  hue: number;
  /** Percent, 26–47 */
  saturation: number;
  /** Percent, 22–32 */
  lightness: number;
  /** Which of the three title arrangements to use (see globals.css). */
  layout: 0 | 1 | 2;
  /** Title size as a percent of the cover's width: smaller when the title
   *  has a long word, so "Castlevania:" fits on one line instead of
   *  breaking mid-word. */
  titleSize: number;
}

/** 32-bit FNV-1a, finished with MurmurHash3's mixing step. FNV alone
 *  leaves titles that differ only in their last letter ("Doom 2",
 *  "Doom 3") with nearly the same low bits, which the hue comes from.
 *  The game room (lib/room.ts) uses it too, so each game's case looks the
 *  same on every visit. */
export function hash(text: string): number {
  let h = 2166136261;
  for (const ch of text) {
    h ^= ch.codePointAt(0)!;
    h = Math.imul(h, 16777619);
  }
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

/** The text area is about 70% of the cover's width, and a letter of the
 *  title face averages a little under 0.6 of its size; the 11.5 cap is what
 *  short titles get. */
function titleSize(title: string): number {
  const longest = Math.max(1, ...title.split(/\s+/).map((w) => [...w].length));
  return Math.floor(Math.min(11.5, 70 / (longest * 0.6)) * 10) / 10;
}

export function coverArt(title: string): CoverArt {
  // Case and stray spaces don't change a game's colour.
  const h = hash(title.trim().toLowerCase());
  return {
    hue: h % 360,
    saturation: 26 + ((h >>> 9) % 22),
    lightness: 22 + ((h >>> 17) % 11),
    layout: ((h >>> 5) % 3) as CoverArt["layout"],
    titleSize: titleSize(title),
  };
}

/**
 * The system's name on the band across the top of a drawn cover, as a real
 * case prints its own ("NINTENDO SWITCH" on the red band, "PS5" on the
 * white). The band's colour comes from caseBand in lib/room.ts, so the
 * library and the game room's shelves agree; this is only the words on it.
 */
export interface BandLabel {
  /** The platform as the player typed it, spaces tidied; the cover sets
   *  it in capitals. */
  text: string;
  /** Size as a percent of the cover's width, BAND_LABEL_MIN to
   *  BAND_LABEL_MAX. */
  size: number;
}

/** The size a short name gets: capitals a little under half the band's
 *  height (globals.css, .drawn-cover-band). */
export const BAND_LABEL_MAX = 6;
/** Smaller than this a name can't be made out on any but the largest
 *  covers, so a very long one stops shrinking here and the cover's
 *  ellipsis cuts it short instead. */
export const BAND_LABEL_MIN = 3.5;
/** The name runs from the band's left edge, a little in from it as on a
 *  real case, and must stop well short of the right one: 80% of the
 *  cover's width, inside the 88% the band's padding leaves (globals.css),
 *  so a name with more wide capitals than most still fits. */
export const BAND_LABEL_WIDTH = 80;
/** A capital of the band's bold, letter-spaced face averages a little
 *  under 0.8 of its size. An estimate, not a measure: a name of all W's
 *  runs wider, and the cover's ellipsis catches it. */
export const BAND_LETTER_WIDTH = 0.78;

/** The words for a cover's band: null without a platform, which leaves
 *  the plain band. Shrinks a long name ("Nintendo Entertainment System")
 *  so it fits on one line rather than being cut off. */
export function bandLabel(platform: string | null | undefined): BandLabel | null {
  const text = (platform ?? "").trim().replace(/\s+/g, " ");
  if (!text) return null;
  const fits = BAND_LABEL_WIDTH / ([...text].length * BAND_LETTER_WIDTH);
  const size = Math.floor(Math.min(BAND_LABEL_MAX, fits) * 10) / 10;
  return { text, size: Math.max(BAND_LABEL_MIN, size) };
}
