import { GameFormat, GameOwnership, PlayStatus } from "@prisma/client";
import { z } from "zod";

/**
 * Bulk edit's limits and input rules, shared by the server actions
 * (actions/bulk.ts) and the library's select bar. They live here rather
 * than in the actions file because a "use server" file may only export
 * async functions.
 */

/** Most game ids one bulk edit takes. The library page never renders more
 *  than this (games/page.tsx uses it as its page size ceiling), so "Select
 *  all" after any number of "Show more" always fits. Anything bigger goes
 *  as "every game that matches" instead. */
export const BULK_MAX_IDS = 2000;

/** Most games "every game that matches" may change at once. */
export const BULK_MAX_MATCHING = 25_000;

/** Rows per write. Keeps each statement well under Postgres's limit on
 *  bind parameters however many games are selected. */
export const BULK_CHUNK = 1000;

/** `list` in runs of at most `size`. */
export function chunk<T>(list: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

/** A game's tags with `add` merged in (no duplicates) and `remove` taken
 *  out, or null when that changes nothing. */
export function retag(tags: readonly string[], add: readonly string[], remove: readonly string[]): string[] | null {
  const next = [...new Set([...tags, ...add])].filter((t) => !remove.includes(t));
  const same = next.length === tags.length && next.every((t, i) => t === tags[i]);
  return same ? null : next;
}

const tagList = z
  .array(
    z
      .string()
      .trim()
      .toLowerCase()
      .min(1, "Tags can't be empty.")
      .max(50, "Tags can be at most 50 characters."),
  )
  .max(20, "Up to 20 tags at a time.")
  .optional();

/** Which games: the ids picked on screen, or every game matching the
 *  library's current URL parameters. Exactly one of the two. */
const targetFields = {
  gameIds: z
    .array(z.string().min(1).max(64))
    .max(
      BULK_MAX_IDS,
      `That's more than ${BULK_MAX_IDS.toLocaleString("en-US")} games. Use “Select all games that match” instead.`,
    )
    .optional(),
  matching: z
    .record(
      z.string().max(32),
      z.string().max(2000, "That search is too long to apply to every match."),
    )
    .refine((params) => Object.keys(params).length <= 40, "Too many filters.")
    .optional(),
};

function oneTarget(
  data: { gameIds?: string[]; matching?: Record<string, string> },
  ctx: z.RefinementCtx,
) {
  const ok =
    data.gameIds !== undefined
      ? data.gameIds.length > 0 && data.matching === undefined
      : data.matching !== undefined;
  if (!ok) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Select some games first." });
  }
}

export const bulkSchema = z
  .object({
    ...targetFields,
    status: z.nativeEnum(PlayStatus).optional(),
    format: z.nativeEnum(GameFormat).optional(),
    ownership: z.nativeEnum(GameOwnership).optional(),
    addShelfId: z.string().max(64).optional(),
    removeShelfId: z.string().max(64).optional(),
    addTags: tagList,
    removeTags: tagList,
  })
  .superRefine((data, ctx) => {
    oneTarget(data, ctx);
    const both = data.addTags?.find((t) => data.removeTags?.includes(t));
    if (both) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `“${both}” is in both Add tags and Remove tags.`,
      });
    }
  });

export const bulkDeleteSchema = z
  .object({
    ...targetFields,
    /** How many games the confirmation named. Required for "every game that
     *  matches", so a library that changed since can't widen the delete. */
    expectedCount: z.number().int().min(1).optional(),
  })
  .superRefine((data, ctx) => {
    oneTarget(data, ctx);
    if (data.matching !== undefined && data.expectedCount === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Confirm how many games to delete first.",
      });
    }
  });

export type BulkInput = z.input<typeof bulkSchema>;
export type BulkDeleteInput = z.input<typeof bulkDeleteSchema>;
