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
 * One delayed retry: Open Library covers redirect to archive.org, which
 * extracts them from zip archives on demand — a cold request can take 10s+
 * or fail outright while the very next one is instant. Now that no user is
 * waiting, retrying is free and rescues most of those covers.
 *
 * Shared by the game form actions and the shelf scan. It lives here rather
 * than in a "use server" file, where every export becomes an action anyone
 * can call.
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
