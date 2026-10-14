import { foldForSearch } from "@/lib/utils";

/**
 * Telling whether two catalogue rows (or a row and a game in the form) are
 * the same game. Pure and client-safe: the server merges search results
 * with it, and "Look up details" uses it to accept a search hit.
 */

/** A title as compared: case, accents, punctuation, trademark signs and
 *  "&" against "and" don't count, so IGDB's "The Witcher 3: Wild Hunt" and
 *  Steam's "The Witcher® 3: Wild Hunt" are one game. */
export function titleKey(title: string): string {
  return foldForSearch(title)
    .replace(/[™®©]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/** The year of a release date ("2017", "2017-03", "2017-03-03"), or null. */
export function releaseYear(date: string | null | undefined): string | null {
  return date?.trim().match(/^\d{4}/)?.[0] ?? null;
}
