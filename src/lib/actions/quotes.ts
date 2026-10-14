"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { quoteSchema } from "@/lib/validation";
import { requireUserId } from "@/lib/actions/helpers";
import type { ActionState } from "@/lib/actions/helpers";

/** Add a quote to a game (the form carries the gameId). */
export async function addQuote(
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

  const parsed = quoteSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const data = parsed.data;

  await prisma.quote.create({
    data: {
      gameId,
      text: data.text,
      speaker: data.speaker ?? null,
      note: data.note ?? null,
    },
  });

  revalidatePath(`/games/${gameId}`);
  revalidatePath("/quotes");
  return { success: true };
}

/** Edit an existing quote (ownership checked through the game). */
export async function updateQuote(
  quoteId: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const userId = await requireUserId();

  const existing = await prisma.quote.findFirst({
    where: { id: quoteId, game: { userId } },
    select: { gameId: true },
  });
  if (!existing) return { error: "Quote not found" };

  const parsed = quoteSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const data = parsed.data;

  await prisma.quote.update({
    where: { id: quoteId },
    data: {
      text: data.text,
      // An emptied box clears who says it, as it does the note.
      speaker: data.speaker ?? null,
      note: data.note ?? null,
    },
  });

  revalidatePath(`/games/${existing.gameId}`);
  revalidatePath("/quotes");
  return { success: true };
}

/** Delete a quote (ownership checked through the game). */
export async function deleteQuote(quoteId: string): Promise<void> {
  const userId = await requireUserId();

  const existing = await prisma.quote.findFirst({
    where: { id: quoteId, game: { userId } },
    select: { gameId: true },
  });
  if (!existing) return;

  await prisma.quote.delete({ where: { id: quoteId } });
  revalidatePath(`/games/${existing.gameId}`);
  revalidatePath("/quotes");
}
