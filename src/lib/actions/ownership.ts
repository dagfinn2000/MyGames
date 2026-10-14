"use server";

import { revalidatePath } from "next/cache";
import { GameOwnership } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireUserId } from "@/lib/actions/helpers";
import type { ActionState } from "@/lib/actions/helpers";

const setOwnershipSchema = z.object({
  gameId: z.string().min(1).max(100),
  ownership: z.nativeEnum(GameOwnership),
});

/**
 * Change only a game's ownership: "I bought it" on the Do I own this? page,
 * where sending the whole game form back would be overkill.
 */
export async function setOwnership(
  gameId: string,
  ownership: GameOwnership,
): Promise<ActionState> {
  const userId = await requireUserId();

  const parsed = setOwnershipSchema.safeParse({ gameId, ownership });
  if (!parsed.success) return { error: "Invalid input" };

  const { count } = await prisma.game.updateMany({
    where: { id: parsed.data.gameId, userId },
    data: { ownership: parsed.data.ownership },
  });
  if (count === 0) return { error: "Game not found" };

  revalidatePath("/games");
  revalidatePath(`/games/${parsed.data.gameId}`);
  return { success: true };
}
