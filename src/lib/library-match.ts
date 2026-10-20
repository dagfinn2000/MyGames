import { parseCatalogueId } from "@/lib/metadata/links";
import { releaseYear, titleKey } from "@/lib/metadata/match";

/**
 * Telling whether a game on the Add page — a search result, or the result
 * picked for the form — is one the player already has, so the page can say
 * so. Pure and client-safe: the page loads the few fields below for the
 * whole library once, and every search result is checked against them in
 * the browser, with no request per keystroke. A personal library is small
 * enough for that.
 *
 * It only ever leads to a note, never to a refusal: having a game on two
 * platforms is normal, and so is a second copy on the same one.
 */

/** A game already in the library, as much of it as the Add page needs. */
export interface LibraryGame {
  id: string;
  title: string;
  platform: string | null;
  catalogueId: string | null;
  /** As saved ("2017", "2017-03-03"): only its year counts (see below). */
  releaseDate?: string | null;
}

/** What is looked for: a catalogue's search result, or the form values
 *  picked from one. */
export interface LibraryCandidate {
  title: string;
  catalogueId?: string | null;
  releaseDate?: string | null;
}

/** What two games are compared by: the title and release year as the
 *  catalogue merge compares them (the title "" when nothing of it is
 *  left), and the catalogue entry. */
interface Identity {
  title: string;
  year: string | null;
  source: string | null;
  entry: string | null;
}

function identify(game: LibraryCandidate): Identity {
  const parsed = parseCatalogueId(game.catalogueId);
  return {
    title: titleKey(game.title),
    year: releaseYear(game.releaseDate),
    source: parsed?.source ?? null,
    entry: parsed ? `${parsed.source}:${parsed.key}` : null,
  };
}

/**
 * The matching rule. Two entries in the same catalogue are the same game
 * exactly when they are the same entry: that survives a title edited on
 * either side, and tells Doom (1993) from Doom (2016), which share a title.
 * Otherwise — one side typed in by hand, or the two from different
 * catalogues, whose ids say nothing about each other ("steam:367520" and
 * "igdb:hollow-knight" are the same game) — it is the title, compared as
 * the catalogue merge compares it (titleKey), so "Hollow Knight™" and
 * "hollow knight" are one game and "Hollow Knight: Silksong" another. The
 * platform plays no part: a copy on another system is still the game.
 *
 * Remakes and reboots keep the name, so as in the merge the release years
 * must agree too when both sides have one: a library's Resident Evil 4
 * (2023) from Steam is not IGDB's Resident Evil 4 (2005). A side without a
 * year is matched by its title alone, since it may well be the game: Steam's
 * search gives no year, so its "DOOM" is noted as in the library of a
 * player who has Doom (1993), though it is the 2016 game. That is only in
 * the list; picking it brings the entry's own date, which settles it in the
 * notice above the form. The other way round, a year typed in differently
 * from the catalogue's (a console's later release) keeps one game apart
 * from itself. Both are the lesser mistake for a note that blocks nothing.
 */
function sameIdentity(a: Identity, b: Identity): boolean {
  if (a.entry && b.entry && a.source === b.source) return a.entry === b.entry;
  if (a.title === "" || a.title !== b.title) return false;
  return a.year === null || b.year === null || a.year === b.year;
}

/** Whether two games are the same game, by the rule above. */
export function isSameGame(a: LibraryCandidate, b: LibraryCandidate): boolean {
  return sameIdentity(identify(a), identify(b));
}

/**
 * A lookup over the library: built once (each title folded once), then
 * asked for each search result as it arrives. Answers with every game in
 * the library that is the candidate, in the library's own order, or [] —
 * more than one when the player has it on several platforms.
 */
export function libraryMatcher(
  library: readonly LibraryGame[],
): (candidate: LibraryCandidate) => LibraryGame[] {
  type Indexed = { game: LibraryGame; order: number; identity: Identity };
  const byTitle = new Map<string, Indexed[]>();
  const byEntry = new Map<string, Indexed[]>();
  const file = (map: Map<string, Indexed[]>, key: string, item: Indexed) => {
    const list = map.get(key);
    if (list) list.push(item);
    else map.set(key, [item]);
  };
  library.forEach((game, order) => {
    const item = { game, order, identity: identify(game) };
    if (item.identity.title) file(byTitle, item.identity.title, item);
    if (item.identity.entry) file(byEntry, item.identity.entry, item);
  });

  return (candidate) => {
    const identity = identify(candidate);
    // Only games sharing the title or the entry can match; the rule then
    // decides between them.
    const near = new Set([
      ...(identity.entry ? (byEntry.get(identity.entry) ?? []) : []),
      ...(identity.title ? (byTitle.get(identity.title) ?? []) : []),
    ]);
    return [...near]
      .filter((item) => sameIdentity(identity, item.identity))
      .sort((a, b) => a.order - b.order)
      .map((item) => item.game);
  };
}

/**
 * The copies as the notes name them among several, in the same order: each
 * by its platform, which is what tells them apart, or by `noPlatform` (the
 * caller's phrase, to fit its sentence) when it has none. Copies that would
 * share a name are numbered in the library's order, "PC (1)" and "PC (2)",
 * so that each link says which one it goes to: two copies on one system
 * are normal too.
 */
export function copyLabels(
  copies: readonly Pick<LibraryGame, "platform">[],
  noPlatform: string,
): string[] {
  const names = copies.map((copy) => copy.platform?.trim() || noPlatform);
  const seen = new Map<string, number>();
  return names.map((name) => {
    if (names.indexOf(name) === names.lastIndexOf(name)) return name;
    const n = (seen.get(name) ?? 0) + 1;
    seen.set(name, n);
    return `${name} (${n})`;
  });
}

/** "twice", "3 times": how often a game is in the library, from two up. */
export function timesPhrase(count: number): string {
  return count === 2 ? "twice" : `${count} times`;
}
