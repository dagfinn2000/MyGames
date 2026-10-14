"use server";

import { revalidatePath } from "next/cache";
import { GameFormat, GameOwnership } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { loanSchema } from "@/lib/validation";
import { requireUserId } from "@/lib/actions/helpers";
import type { ActionState } from "@/lib/actions/helpers";

/**
 * Lending: where your copy went.
 *
 * A game is "lent out" while it has a loan with no `returnedAt`. Returning
 * one keeps the row, so the game page can show who has borrowed it over the
 * years rather than only the current state.
 *
 * Ownership is unaffected: a lent game is still yours. That is why lending
 * lives here and not in the ownership enum — the two answer different
 * questions ("is this mine?" vs "is it on my shelf right now?").
 */

/** Lend the game out. Refuses if it's already out — two open loans would make
 *  "who has it?" unanswerable — and unless it is a physical copy you own (the
 *  card hides the button for the rest). */
export async function lendGame(
  gameId: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const userId = await requireUserId();

  const game = await prisma.game.findFirst({
    where: { id: gameId, userId },
    select: { id: true, ownership: true, format: true },
  });
  if (!game) return { error: "Game not found" };
  if (game.ownership !== GameOwnership.OWNED) {
    return { error: "Only a copy you own can be lent out." };
  }
  if (game.format !== GameFormat.PHYSICAL) {
    return { error: "Only a physical copy can be lent out." };
  }

  const parsed = loanSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const data = parsed.data;

  const alreadyOut = await prisma.loan.findFirst({
    where: { gameId, returnedAt: null },
    select: { borrower: true },
  });
  if (alreadyOut) {
    return { error: `Already lent to ${alreadyOut.borrower} — mark it returned first.` };
  }

  await prisma.loan.create({
    data: {
      gameId,
      borrower: data.borrower,
      lentAt: data.lentAt ?? new Date(),
      note: data.note ?? null,
    },
  });

  revalidatePath("/games");
  revalidatePath(`/games/${gameId}`);
  return { success: true };
}

/** Mark the open loan returned (ownership checked through the game). */
export async function returnLoan(loanId: string): Promise<void> {
  const userId = await requireUserId();

  const loan = await prisma.loan.findFirst({
    where: { id: loanId, game: { userId } },
    select: { gameId: true, returnedAt: true },
  });
  if (!loan || loan.returnedAt) return;

  await prisma.loan.update({
    where: { id: loanId },
    data: { returnedAt: new Date() },
  });

  revalidatePath("/games");
  revalidatePath(`/games/${loan.gameId}`);
}

/** Delete a loan record entirely — for fixing a mistaken entry, where
 *  "returned" would leave a lie in the history. */
export async function deleteLoan(loanId: string): Promise<void> {
  const userId = await requireUserId();

  const loan = await prisma.loan.findFirst({
    where: { id: loanId, game: { userId } },
    select: { gameId: true },
  });
  if (!loan) return;

  await prisma.loan.delete({ where: { id: loanId } });

  revalidatePath("/games");
  revalidatePath(`/games/${loan.gameId}`);
}
