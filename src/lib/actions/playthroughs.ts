"use server";

import { revalidatePath } from "next/cache";
import type { Prisma } from "@prisma/client";
import { PlayStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { pastPlaythroughSchema } from "@/lib/validation";
import { requireUserId } from "@/lib/actions/helpers";
import type { ActionState } from "@/lib/actions/helpers";

/** Keep Game.timesCompleted = archived passes + the current one when finished.
 *  Runs on the caller's transaction client so the recount sees (and commits
 *  with) the write that made it necessary. */
async function syncTimesCompleted(
  db: Prisma.TransactionClient,
  gameId: string,
): Promise<void> {
  const game = await db.game.findUnique({
    where: { id: gameId },
    select: { status: true, _count: { select: { playthroughs: true } } },
  });
  if (!game) return;
  await db.game.update({
    where: { id: gameId },
    data: {
      timesCompleted:
        game._count.playthroughs + (game.status === PlayStatus.COMPLETED ? 1 : 0),
    },
  });
}

function revalidateGame(gameId: string) {
  revalidatePath("/games");
  revalidatePath(`/games/${gameId}`);
  revalidatePath("/stats");
}

/**
 * Start a re-read: archive the current finished pass (dates + what you rated
 * it that time) into the Read table, then flip the game back to Currently
 * Reading starting today. The overall rating on the game stays yours to keep
 * or change.
 */
export async function playAgain(gameId: string): Promise<void> {
  const userId = await requireUserId();

  const game = await prisma.game.findFirst({
    where: { id: gameId, userId },
    select: { status: true, dateStarted: true, dateFinished: true, rating: true },
  });
  if (!game || game.status !== PlayStatus.COMPLETED) return;

  const now = new Date();
  // One atomic unit — failing between these writes would strand the game
  // half-archived. The progress entry is the new pass's page-0 anchor at the
  // exact re-read moment: the date form field only keeps day precision, so
  // without it a re-read started on a day with already-logged entries would
  // blend into the previous pass. timesCompleted is unchanged throughout: the
  // pass moved from "current" to "archived".
  await prisma.$transaction([
    prisma.playthrough.create({
      data: {
        gameId,
        dateStarted: game.dateStarted,
        dateFinished: game.dateFinished,
        rating: game.rating,
      },
    }),
    prisma.game.update({
      where: { id: gameId },
      data: {
        status: PlayStatus.PLAYING,
        dateStarted: now,
        dateFinished: null,
        currentPage: null,
      },
    }),
    prisma.progressEntry.create({
      data: { gameId, page: 0, date: now },
    }),
  ]);

  revalidateGame(gameId);
}

/** Record a read from before the app (the form carries the gameId). */
export async function addPastPlaythrough(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const userId = await requireUserId();

  const gameId = formData.get("gameId");
  if (typeof gameId !== "string" || !gameId) return { error: "Game not found" };
  const game = await prisma.game.findFirst({
    where: { id: gameId, userId },
    select: { id: true },
  });
  if (!game) return { error: "Game not found" };

  const parsed = pastPlaythroughSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const data = parsed.data;

  await prisma.$transaction(async (tx) => {
    await tx.playthrough.create({
      data: {
        gameId,
        dateStarted: data.dateStarted ?? null,
        dateFinished: data.dateFinished ?? null,
        rating: data.rating || null, // 0 = unrated
        note: data.note ?? null,
      },
    });
    await syncTimesCompleted(tx, gameId);
  });

  revalidateGame(gameId);
  return { success: true };
}

/** Edit a past read (ownership checked through the game). */
export async function updatePastPlaythrough(
  playthroughId: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const userId = await requireUserId();

  const existing = await prisma.playthrough.findFirst({
    where: { id: playthroughId, game: { userId } },
    select: { gameId: true },
  });
  if (!existing) return { error: "Read not found" };

  const parsed = pastPlaythroughSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const data = parsed.data;

  await prisma.playthrough.update({
    where: { id: playthroughId },
    data: {
      dateStarted: data.dateStarted ?? null,
      dateFinished: data.dateFinished ?? null,
      rating: data.rating || null,
      // Only when the form sent one (an empty one clears it): a note is
      // free text, so a request without the field mustn't wipe it.
      ...(data.note !== undefined && { note: data.note }),
    },
  });

  revalidateGame(existing.gameId);
  return { success: true };
}

/** Delete a past read (ownership checked through the game). */
export async function deletePastPlaythrough(playthroughId: string): Promise<void> {
  const userId = await requireUserId();

  const existing = await prisma.playthrough.findFirst({
    where: { id: playthroughId, game: { userId } },
    select: { gameId: true },
  });
  if (!existing) return;

  await prisma.$transaction(async (tx) => {
    await tx.playthrough.delete({ where: { id: playthroughId } });
    await syncTimesCompleted(tx, existing.gameId);
  });

  revalidateGame(existing.gameId);
}
