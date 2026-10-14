import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/** Letters that NFD doesn't split into base + accent, spelled the way
 *  someone without the key would type them. */
const FOLDED_LETTERS: Record<string, string> = {
  æ: "ae",
  ø: "o",
  œ: "oe",
  ß: "ss",
  đ: "d",
  ð: "d",
  ł: "l",
  þ: "th",
};

/**
 * Lowercases and strips accents, so "Pokémon" and "Ōkami" are found by
 * "pokemon" and "okami". Applied to both the stored searchText and the words
 * typed into search; the two have to agree exactly.
 *
 * Every game's searchText was folded this way when it was saved. Change
 * the steps and the stored rows need rewriting by a migration, or searches
 * will stop finding them.
 */
export function foldForSearch(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .normalize("NFC")
    .replace(/[æøœßđðłþ]/g, (c) => FOLDED_LETTERS[c]);
}

/** Folded title + developers + series + platform blob stored on
 *  Game.searchText: makes case- and accent-insensitive search a `contains`
 *  query (Prisma can't substring-search a String[] column). Shared by the
 *  game actions and the backup import so the two can never drift; anything
 *  else that changes one of these fields has to rebuild it too. */
export function buildSearchText(
  title: string,
  developers: string[],
  seriesName?: string | null,
  platform?: string | null,
): string {
  // Blank parts left out, so a game with a platform but no series doesn't
  // get a double space in the middle.
  return foldForSearch([title, ...developers, seriesName, platform].filter(Boolean).join(" ").trim());
}

/** Escapes LIKE's wildcards. Prisma's `contains` passes `%` and `_` through,
 *  so a search for "%" would otherwise match every game. */
export function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, "\\$&");
}

/** The words of a search query, folded like searchText, each once, at most
 *  ten. For matching in JS; searchTerms is the same list escaped for SQL. */
export function searchWords(q: string): string[] {
  const words = foldForSearch(q).split(/\s+/).filter(Boolean);
  return [...new Set(words)].slice(0, 10);
}

/**
 * The words of a search query, folded like searchText and escaped for
 * `contains`. Each word is matched on its own, so "cherry knight" finds
 * Hollow Knight by Team Cherry even though that phrase appears nowhere.
 */
export function searchTerms(q: string): string[] {
  return searchWords(q).map(escapeLike);
}
