import { GameFormat, GameOwnership, PlayStatus } from "@prisma/client";
import { z } from "zod";
import { COMMON_PLATFORMS } from "@/lib/platforms";
import { buildSearchText } from "@/lib/utils";

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

/** Longest platform a bulk edit sets: the game form's limit (validation.ts). */
export const BULK_PLATFORM_MAX = 100;

/**
 * The Set platform field's suggestions: the platforms already in the
 * library first, so a bulk edit spells a system the way the library already
 * does ("PS5" stays "PS5" rather than gaining a "PlayStation 5" twin), then
 * the common ones. Each once whatever its case, the first spelling winning.
 */
export function platformSuggestions(library: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const name of [...library, ...COMMON_PLATFORMS]) {
    const tidy = name.trim();
    const key = tidy.toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(tidy);
  }
  return out;
}

/** The fields Set platform reads from a game to rewrite it. */
export interface PlatformTarget {
  title: string;
  developers: string[];
  seriesName: string | null;
  platform: string | null;
  searchText: string;
}

/**
 * What Set platform writes to one game: the new platform (null clears it)
 * and its searchText rebuilt to match, or null when the game already says
 * exactly that. searchText folds the platform in (buildSearchText), so
 * changing one without the other would leave search finding the game by
 * the platform it used to have. A searchText that is somehow out of step
 * is rewritten even when the platform itself is unchanged.
 */
export function replatform(
  game: PlatformTarget,
  platform: string | null,
): { platform: string | null; searchText: string } | null {
  const searchText = buildSearchText(game.title, game.developers, game.seriesName, platform);
  if (game.platform === platform && game.searchText === searchText) return null;
  return { platform, searchText };
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
    /** Set platform: the name to give every game, trimmed. Empty (or null)
     *  clears it; leaving it out leaves each game's platform alone. */
    platform: z
      .string()
      .trim()
      .max(BULK_PLATFORM_MAX, `A platform can be at most ${BULK_PLATFORM_MAX} characters.`)
      .transform((p) => p || null)
      .nullable()
      .optional(),
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
