"use server";

import { revalidatePath } from "next/cache";
import { Prisma } from "@prisma/client";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import {
  BULK_CHUNK,
  BULK_MAX_MATCHING,
  bulkDeleteSchema,
  bulkSchema,
  chunk,
  retag,
  type BulkDeleteInput,
  type BulkInput,
} from "@/lib/bulk";
import { deleteCachedCovers } from "@/lib/covers";
import { getPreferences } from "@/lib/current-user";
import { parseFilters } from "@/lib/library-filters";
import { resolveGameWhere } from "@/lib/library-where";
import { settlePlayState } from "@/lib/play-state";

export interface BulkResult {
  count?: number;
  error?: string;
}

/** Room for thousands of per-game writes (a status change runs each game
 *  through the play rules); Prisma's default gives up after 5 seconds. */
const TRANSACTION_OPTIONS = { timeout: 120_000, maxWait: 10_000 };

/** A transaction that ran out of time becomes "timeout" (everything in it
 *  was rolled back), so the player gets a message rather than an error
 *  page. Anything else is rethrown. */
function timedOut(err: unknown): "timeout" {
  if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2028") {
    return "timeout";
  }
  throw err;
}

const TOO_LONG = "That took too long. Try fewer games at a time.";

/**
 * The games a bulk action applies to, as a `where` plus how many there are.
 * Either the ids picked on screen, or every game matching the library's
 * URL parameters, found through the same resolveGameWhere call the library
 * page makes, so "all that match" is exactly the games it counted. Both
 * are scoped to `userId`, so ids or a shelf from another account simply
 * match nothing.
 */
async function resolveTarget(
  userId: string,
  target: { gameIds?: string[]; matching?: Record<string, string> },
): Promise<{ where: Prisma.GameWhereInput; count: number } | { error: string }> {
  const where: Prisma.GameWhereInput = target.matching
    ? {
        // resolveGameWhere scopes to the user itself; saying it again costs
        // nothing on an action that can delete thousands of games.
        AND: [
          await resolveGameWhere(userId, parseFilters(target.matching), await getPreferences()),
          { userId },
        ],
      }
    : { id: { in: target.gameIds ?? [] }, userId };

  const count = await prisma.game.count({ where });
  if (count === 0) return { error: "No matching games" };
  if (count > BULK_MAX_MATCHING) {
    return {
      error: `That's more than ${BULK_MAX_MATCHING.toLocaleString("en-US")} games. Narrow the filters first.`,
    };
  }
  return { where, count };
}

/**
 * Apply changes to many games at once: play status, format, ownership,
 * tags to add or remove, and/or a shelf to put them on or take them off.
 * The games are the ids picked on screen, each checked against the
 * account, or every game matching the library's filters ("Select all N
 * games that match").
 */
export async function bulkUpdateGames(input: BulkInput): Promise<BulkResult> {
  const session = await auth();
  if (!session?.user?.id) return { error: "Not authenticated" };
  const userId = session.user.id;

  const parsed = bulkSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  const { status, format, ownership, addShelfId, removeShelfId, addTags, removeTags } =
    parsed.data;

  if (
    !status &&
    !format &&
    !ownership &&
    !addShelfId &&
    !removeShelfId &&
    !addTags?.length &&
    !removeTags?.length
  ) {
    return { error: "Nothing to apply" };
  }

  const target = await resolveTarget(userId, parsed.data);
  if ("error" in target) return target;

  const owned = await prisma.game.findMany({
    where: target.where,
    select: {
      id: true,
      tags: true,
      status: true,
      dateStarted: true,
      dateFinished: true,
      playedMinutes: true,
      _count: { select: { playthroughs: true } },
    },
  });
  if (owned.length === 0) return { error: "No matching games" };
  const ownedIds = owned.map((b) => b.id);

  // The shelf is resolved before the transaction so an unknown shelf id is
  // rejected without having written anything.
  let shelf: { id: string; games: { id: string }[] } | null = null;
  if (addShelfId) {
    shelf = await prisma.shelf.findFirst({
      where: { id: addShelfId, userId },
      select: { id: true, games: { select: { id: true } } },
    });
    if (!shelf) return { error: "Shelf not found" };
  }
  let removeFrom: { id: string } | null = null;
  if (removeShelfId) {
    removeFrom = await prisma.shelf.findFirst({
      where: { id: removeShelfId, userId },
      select: { id: true },
    });
    if (!removeFrom) return { error: "Shelf not found" };
  }

  // One unit of work. Applying a status, then tags, then a shelf as three
  // independent writes meant a failure partway through left some of the
  // selection changed and some not — while still reporting the whole batch
  // as updated. "Apply to 20 games" should either happen or not.
  // Games moved to Completed with no finish date are dated the way games
  // added as Completed are (Preferences, New games): today, or not at all.
  const undatedFinish = status
    ? (await getPreferences()).addedAsCompletedFinished === "undated"
    : false;

  const outcome = await prisma.$transaction(async (tx) => {
    if (status) {
      // Per game, through the same rules as the playing card: moving a game
      // to Completed dates it and counts the completion, moving it off
      // Completed uncounts it. A bare updateMany of the status left both
      // behind, so games bulk-moved to Completed were missing from the
      // yearly stats and goal. The time played goes with the playthrough
      // (kept, or cleared back on Want to Play). Games already in the
      // target status are left alone.
      for (const b of owned) {
        if (b.status === status) continue;
        const next = settlePlayState(
          b.status,
          {
            status,
            dateStarted: b.dateStarted,
            dateFinished: b.dateFinished,
            playedMinutes: b.playedMinutes,
          },
          b._count.playthroughs,
          new Date(),
          { undatedFinish },
        );
        await tx.game.update({ where: { id: b.id }, data: next });
      }
    }

    // Format and ownership are plain fields, so a run of games per write.
    // Games already set that way are left alone.
    if (format) {
      for (const part of chunk(ownedIds, BULK_CHUNK)) {
        await tx.game.updateMany({
          where: { id: { in: part }, userId, format: { not: format } },
          data: { format },
        });
      }
    }
    if (ownership) {
      for (const part of chunk(ownedIds, BULK_CHUNK)) {
        await tx.game.updateMany({
          where: { id: { in: part }, userId, ownership: { not: ownership } },
          data: { ownership },
        });
      }
    }

    if (addTags?.length || removeTags?.length) {
      // Per-row updates so existing tags are merged without duplicates —
      // updateMany's `push` would blindly append. Only games whose tags
      // change are written.
      for (const b of owned) {
        const tags = retag(b.tags, addTags ?? [], removeTags ?? []);
        if (tags) await tx.game.update({ where: { id: b.id }, data: { tags } });
      }
    }

    if (shelf) {
      const already = new Set(shelf.games.map((b) => b.id));
      const toConnect = ownedIds.filter((id) => !already.has(id));
      for (const part of chunk(toConnect, BULK_CHUNK)) {
        await tx.shelf.update({
          where: { id: shelf.id },
          data: { games: { connect: part.map((id) => ({ id })) } },
        });
      }
    }

    if (removeFrom) {
      // Disconnecting a game that isn't on the shelf is a no-op.
      for (const part of chunk(ownedIds, BULK_CHUNK)) {
        await tx.shelf.update({
          where: { id: removeFrom.id },
          data: { games: { disconnect: part.map((id) => ({ id })) } },
        });
      }
    }
  }, TRANSACTION_OPTIONS).catch(timedOut);
  if (outcome === "timeout") return { error: TOO_LONG };

  revalidatePath("/games");
  // Status, format and ownership all feed the stats page.
  revalidatePath("/stats");
  return { count: ownedIds.length };
}

/**
 * Delete many games at once, with their play history and loans (the
 * schema cascades), then their cached covers where no other game uses
 * them. For "every game that matches", the count the confirmation showed
 * must still be the count that matches, or nothing is deleted: a game
 * added or changed in the meantime must not quietly join the delete.
 */
export async function bulkDeleteGames(input: BulkDeleteInput): Promise<BulkResult> {
  const session = await auth();
  if (!session?.user?.id) return { error: "Not authenticated" };
  const userId = session.user.id;

  const parsed = bulkDeleteSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };

  const target = await resolveTarget(userId, parsed.data);
  if ("error" in target) return target;

  // Checked against the rows about to go, not target.count: a game added
  // between counting and this read would otherwise join the delete.
  const doomed = await prisma.game.findMany({
    where: target.where,
    select: { id: true, coverUrl: true },
  });
  if (parsed.data.matching && doomed.length !== parsed.data.expectedCount) {
    return { error: "The games that match have changed. Check the count and try again." };
  }
  if (doomed.length === 0) return { error: "No matching games" };

  const outcome = await prisma.$transaction(async (tx) => {
    for (const part of chunk(doomed.map((b) => b.id), BULK_CHUNK)) {
      await tx.game.deleteMany({ where: { id: { in: part }, userId } });
    }
  }, TRANSACTION_OPTIONS).catch(timedOut);
  if (outcome === "timeout") return { error: TOO_LONG };

  await deleteCachedCovers(doomed.map((b) => b.coverUrl));

  revalidatePath("/games");
  revalidatePath("/stats");
  return { count: doomed.length };
}
