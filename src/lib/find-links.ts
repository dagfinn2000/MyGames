import type { FindLink } from "@/lib/preferences";

type LinkGame = { title: string; developers: string[]; platform: string | null };

/**
 * A "Find it at" pattern with this game's details filled in, or null when
 * the link can't be made: a placeholder it uses has nothing to fill it with
 * (no developer, no platform), or the result somehow isn't an https://
 * address. {developer} is the first developer, {platform} the platform you
 * play it on. Each value is URL-encoded, so a title with & or # can't break
 * the query.
 */
export function fillFindLink(pattern: string, game: LinkGame): string | null {
  const values: Record<string, string> = {
    title: game.title.trim(),
    developer: game.developers[0]?.trim() ?? "",
    platform: game.platform?.trim() ?? "",
  };
  let missing = false;
  // A function replacer, so a "$&" in a title is inserted as written.
  const href = pattern.replace(/\{(title|developer|platform)\}/g, (_, key: string) => {
    if (!values[key]) missing = true;
    return encodeURIComponent(values[key]);
  });
  if (missing) return null;
  try {
    return new URL(href).protocol === "https:" ? href : null;
  } catch {
    return null;
  }
}

/** The links to show on a game, in the player's order. */
export function findLinksFor(
  links: FindLink[],
  game: LinkGame,
): { name: string; href: string }[] {
  return links.flatMap((link) => {
    const href = fillFindLink(link.url, game);
    return href ? [{ name: link.name, href }] : [];
  });
}
