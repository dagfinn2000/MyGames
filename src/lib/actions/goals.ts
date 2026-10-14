"use server";

import { revalidatePath } from "next/cache";
import { GoalUnit } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireUserId } from "@/lib/actions/helpers";

const goalSchema = z.object({
  year: z.coerce.number().int().min(1900).max(2200),
  // An hours goal can run into the thousands (a year has 8,760 hours), so
  // the cap is set by that rather than by any sensible game count.
  target: z.coerce.number().int().min(0).max(10_000),
  unit: z.nativeEnum(GoalUnit).catch(GoalUnit.GAMES),
  countReplays: z.boolean(),
});

/** What the goal form shows after a save. */
export interface GoalFormState {
  error?: string;
  saved?: { year: number; removed: boolean };
}

/**
 * Sets (or clears, with target 0 / empty) the play goal for a year, along
 * with what it counts: games or hours, with or without replays.
 * Any year can be saved, so next year's goal can be set in December and a
 * past one corrected; each year's goal is its own row.
 */
export async function setPlayGoal(formData: FormData): Promise<GoalFormState> {
  const userId = await requireUserId();

  const parsed = goalSchema.safeParse({
    year: formData.get("year"),
    // An emptied number input submits "" — treat it as clearing the goal.
    target: formData.get("target") || 0,
    unit: formData.get("unit"),
    // An unticked checkbox submits nothing at all.
    countReplays: formData.get("countReplays") === "on",
  });
  if (!parsed.success) return { error: "Enter a whole number from 0 to 10,000." };
  const { year, target, unit, countReplays } = parsed.data;

  if (target === 0) {
    await prisma.playGoal.deleteMany({ where: { userId, year } });
  } else {
    await prisma.playGoal.upsert({
      where: { userId_year: { userId, year } },
      create: { userId, year, target, unit, countReplays },
      update: { target, unit, countReplays },
    });
  }

  revalidatePath("/stats");
  revalidatePath(`/stats/year/${year}`);
  return { saved: { year, removed: target === 0 } };
}
