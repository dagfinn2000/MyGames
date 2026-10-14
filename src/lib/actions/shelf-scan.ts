"use server";

import type { GameFormat, GameOwnership } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireUserId } from "@/lib/actions/helpers";
import { metadataBudgetUsed, takeMetadataBudget } from "@/lib/api-guard";
import { catalogueGameValues } from "@/lib/catalogue-values";
import { localizeCoverAfterResponse } from "@/lib/cover-localize";
import { deleteCachedCover } from "@/lib/covers";
import { getPreferences } from "@/lib/current-user";
import { isbnVariants, looksLikeIsbn, normalizeIsbn } from "@/lib/isbn";
import { findGameByIsbn, findGameByTitle } from "@/lib/library-match";
import { CataloguesUnreachableError, getGameDetails, searchGames } from "@/lib/metadata";
import { METADATA_LOOKUPS_PER_MINUTE } from "@/lib/rate-limit";
import { settleReadingState } from "@/lib/reading-state";
import { tagImportFor } from "@/lib/user-tags";
import { buildSearchText } from "@/lib/utils";
import { gameSchema, isAllowedCoverUrl } from "@/lib/validation";

/** What one scanned barcode came to. */
export type ScanResult =
  | { kind: "added"; game: { id: string; title: string; authors: string[] } }
  | {
      kind: "have";
      match: "isbn" | "title";
      /** Ownership and format word the answer as the check page does. */
      game: { id: string; title: string; ownership: GameOwnership; format: GameFormat };
    }
  | { kind: "notFound"; isbn: string }
  /** The lookup budget is spent: try this code again after the wait. */
  | { kind: "paused"; retryInMs: number }
  | { kind: "error"; message: string };

export type ScanAnswer = ScanResult & {
  /** Catalogue lookups this minute, to show the reader. */
  budget: { used: number; limit: number };
};

const scanSchema = z.object({
  isbn: z.string().trim().max(20).refine(looksLikeIsbn),
  /** Add it even though a game with the same title is in the library. */
  force: z.boolean().optional(),
});

/** Units of the lookup budget a game's details cost: the work, the exact
 *  edition and Google Games. With the search, about three a scan. */
const DETAILS_COST = 2;

/**
 * Shelf scan ("Keep scanning"): looks one barcode up and adds the game with
 * the reader's New games settings, without the review form. A game whose
 * ISBN is already in the library is reported, not added again, and so is
 * one with the same title in another edition unless `force` says to add it
 * anyway.
 *
 * Spends the same per-user lookup budget as the search box. When it runs
 * out the answer is "paused" with the wait, and nothing is added; the scan
 * list tries the code again then.
 *
 * Nothing is revalidated here. A revalidating action re-renders the page
 * it was called from in its response, which would redraw the add page on
 * every scan; the library is rendered fresh on each visit anyway.
 */
export async function scanAddGame(
  isbn: string,
  options?: { force?: boolean },
): Promise<ScanAnswer> {
  const userId = await requireUserId();
  const answer = (result: ScanResult): ScanAnswer => ({
    ...result,
    budget: { used: metadataBudgetUsed(userId), limit: METADATA_LOOKUPS_PER_MINUTE },
  });

  const parsed = scanSchema.safeParse({ isbn, force: options?.force });
  if (!parsed.success) return answer({ kind: "error", message: "That isn't an ISBN" });
  const code = normalizeIsbn(parsed.data.isbn);

  const owned = await findGameByIsbn(userId, code);
  if (owned) return answer({ kind: "have", match: "isbn", game: owned });

  const search = takeMetadataBudget(userId);
  if (!search.ok) return answer({ kind: "paused", retryInMs: search.retryInMs });

  const prefs = await getPreferences();
  let results;
  try {
    results = await searchGames(code, prefs.catalogues);
  } catch (e) {
    if (!(e instanceof CataloguesUnreachableError)) throw e;
    return answer({ kind: "error", message: "Couldn't reach the game catalogues" });
  }
  // The row for this very edition when there is one; an ISBN search's
  // first row otherwise.
  const variants = isbnVariants(code);
  const hit =
    results.find((r) => r.isbn && variants.includes(normalizeIsbn(r.isbn))) ?? results[0];
  if (!hit) return answer({ kind: "notFound", isbn: code });

  if (!parsed.data.force) {
    const sameTitle = await findGameByTitle(userId, hit.title, hit.authors[0]);
    if (sameTitle) return answer({ kind: "have", match: "title", game: sameTitle });
  }

  // Description, subjects and a better page count. A spent budget here
  // isn't worth a pause: the search row alone makes a good enough game.
  let details = null;
  if (takeMetadataBudget(userId, DETAILS_COST).ok) {
    details = await getGameDetails(
      { openLibraryId: hit.openLibraryId, isbn: code, title: hit.title, author: hit.authors[0] },
      prefs.catalogues,
    ).catch(() => null);
  }

  const values = catalogueGameValues(hit, details, await tagImportFor(userId, prefs), code);
  // Through the form's own schema, so the limits and cover URL rules are the
  // ones a game added by hand gets. Catalogue text can run past the limits.
  const game = gameSchema.safeParse({
    ...values,
    title: values.title.slice(0, 500),
    description: values.description.slice(0, 10_000),
    publishedDate: values.publishedDate.slice(0, 20),
    coverUrl:
      values.coverUrl.length <= 2000 && isAllowedCoverUrl(values.coverUrl) ? values.coverUrl : "",
    format: prefs.newGameFormat,
    ownership: prefs.newGameOwnership,
  });
  if (!game.success) return answer({ kind: "error", message: "Couldn't add this game" });
  const data = game.data;

  const reading = settleReadingState(
    null,
    { status: prefs.newGameStatus, dateStarted: null, dateFinished: null, currentPage: null },
    0,
    new Date(),
    { undatedFinish: prefs.addedAsReadFinished === "undated" },
  );

  const created = await prisma.game.create({
    data: {
      userId,
      title: data.title,
      authors: data.authors,
      isbn: data.isbn ?? null,
      description: data.description ?? null,
      coverUrl: data.coverUrl ?? null,
      pageCount: data.pageCount ?? null,
      publishedDate: data.publishedDate ?? null,
      tags: data.tags,
      format: data.format,
      ownership: data.ownership,
      openLibraryId: data.openLibraryId ?? null,
      status: reading.status,
      dateStarted: reading.dateStarted,
      dateFinished: reading.dateFinished,
      timesRead: reading.timesRead,
      searchText: buildSearchText(data.title, data.authors),
    },
    select: { id: true, title: true, authors: true, coverUrl: true },
  });
  localizeCoverAfterResponse(created.id, created.coverUrl);

  return answer({
    kind: "added",
    game: { id: created.id, title: created.title, authors: created.authors },
  });
}

/**
 * Undo for a scanned game: deletes it (and its cached cover) if it is the
 * reader's own. Like scanAddGame, revalidates nothing and stays on the page.
 */
export async function removeScannedGame(gameId: string): Promise<{ error?: string }> {
  const userId = await requireUserId();
  const id = z.string().min(1).max(64).safeParse(gameId);
  if (!id.success) return { error: "Game not found" };

  const game = await prisma.game.findFirst({
    where: { id: id.data, userId },
    select: { coverUrl: true },
  });
  if (!game) return { error: "Game not found" };

  await prisma.game.delete({ where: { id: id.data } });
  await deleteCachedCover(game.coverUrl);
  return {};
}
