/**
 * Platform names. A game's `platform` is freeform (whatever the player
 * types), but the catalogues each have their own spelling for the same
 * system: IGDB says "PC (Microsoft Windows)", Wikidata "Microsoft Windows",
 * Steam only knows Windows, Mac and Linux. Their names are turned into the
 * everyday ones here, so the form's suggestions, a search result's platform
 * list and the stats' platforms all say "PC". Client-safe.
 */

/** Catalogue names that read better another way, keyed in lower case.
 *  Names not listed here are already the everyday ones ("PlayStation 4",
 *  "Nintendo Switch", "Xbox Series X|S") and are kept as written. */
const EVERYDAY_NAMES: Record<string, string> = {
  "pc (microsoft windows)": "PC",
  "microsoft windows": "PC",
  windows: "PC",
  "personal computer": "PC",
  "ibm pc compatible": "PC",
  macos: "Mac",
  "mac os": "Mac",
  "mac os x": "Mac",
  "os x": "Mac",
  "classic mac os": "Mac",
  "gnu/linux": "Linux",
  "xbox series x and series s": "Xbox Series X|S",
  "xbox series x/s": "Xbox Series X|S",
  "xbox series x": "Xbox Series X|S",
  "xbox series s": "Xbox Series X|S",
  "playstation portable": "PSP",
  "playstation vita": "PS Vita",
  "nintendo gamecube": "GameCube",
  "super nintendo entertainment system": "SNES",
  "super nes": "SNES",
  "nintendo entertainment system": "NES",
  "sega mega drive/genesis": "Mega Drive",
  "sega mega drive": "Mega Drive",
  "sega genesis": "Mega Drive",
  genesis: "Mega Drive",
  "sega dreamcast": "Dreamcast",
  "google stadia": "Stadia",
  "web browser": "Browser",
  "ms-dos": "DOS",
};

/** One catalogue's platform name as people say it: "PC (Microsoft Windows)"
 *  and "Microsoft Windows" become "PC", "macOS" becomes "Mac". Anything
 *  else is kept, with its spacing tidied. */
export function normalizePlatform(name: string): string {
  const tidy = name.trim().replace(/\s+/g, " ");
  return EVERYDAY_NAMES[tidy.toLowerCase()] ?? tidy;
}

/** A catalogue's platform list in everyday names, in the catalogue's order,
 *  without the repeats that renaming makes (Wikidata often lists both
 *  "Microsoft Windows" and "Windows"). */
export function normalizePlatforms(names: readonly string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const name of names) {
    const platform = normalizePlatform(name);
    const key = platform.toLowerCase();
    if (!platform || seen.has(key)) continue;
    seen.add(key);
    out.push(platform);
  }
  return out;
}

/** Suggestions for the platform field, after the catalogue's own list:
 *  the systems people play on now first, then older ones. */
export const COMMON_PLATFORMS: readonly string[] = [
  "PC",
  "PlayStation 5",
  "Xbox Series X|S",
  "Nintendo Switch 2",
  "Nintendo Switch",
  "Steam Deck",
  "Mac",
  "iOS",
  "Android",
  "Meta Quest",
  "PlayStation 4",
  "Xbox One",
  "Linux",
  "PlayStation 3",
  "Xbox 360",
  "Wii U",
  "Wii",
  "Nintendo 3DS",
  "Nintendo DS",
  "PS Vita",
  "PSP",
  "PlayStation 2",
  "GameCube",
  "Xbox",
  "Game Boy Advance",
  "PlayStation",
  "Nintendo 64",
  "Dreamcast",
  "SNES",
  "Mega Drive",
  "NES",
  "Game Boy",
];
