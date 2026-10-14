import { after } from "next/server";
import { prisma } from "@/lib/prisma";
import { cacheCoverImage, deleteCachedCover } from "@/lib/covers";

/**
 * If the game was saved with a remote cover URL, pull it into the local
 * cache and point the row at the cached copy. Best-effort: on failure the
 * remote URL stays and the UI still works.
 *
 * Runs via `after()` — the download can take seconds on a slow image host,
 * and the save response shouldn't wait for it. The page renders the remote
 * URL until the cached copy lands; every game page after that gets the
 * local file.
 *
 * One delayed retry: an image host can time out or fail on a cold request
 * (a CDN fetching the file from its origin, a rate limit) while the very
 * next one is instant. Now that no one is waiting, retrying is free and
 * rescues most of those covers.
 *
 * Used by the game form actions. It lives here rather than in a "use
 * server" file, where every export becomes an action anyone can call.
 */
export function localizeCoverAfterResponse(gameId: string, coverUrl: string | null) {
  if (!coverUrl || !/^https?:\/\//.test(coverUrl)) return;
  after(async () => {
    let localUrl = await cacheCoverImage(coverUrl, gameId);
    if (!localUrl) {
      await new Promise((r) => setTimeout(r, 10_000));
      localUrl = await cacheCoverImage(coverUrl, gameId);
    }
    if (localUrl) {
      // Only if the game still has the cover this download was for. A save
      // in the meantime may have picked another one, and this older
      // download finishing late must not overwrite it.
      const { count } = await prisma.game.updateMany({
        where: { id: gameId, coverUrl },
        data: { coverUrl: localUrl },
      });
      if (count === 0) await deleteCachedCover(localUrl);
    }
  });
}
