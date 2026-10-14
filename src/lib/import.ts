import fs from "node:fs/promises";
import path from "node:path";
import { GameFormat, GameOwnership, GoalUnit, Prisma, PlayStatus } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { BACKUP_FORMAT, BACKUP_VERSION } from "@/lib/backup";
import { coverFilePath, coversDir } from "@/lib/covers";
import { sniffImageKind } from "@/lib/image-type";
import { buildSearchText, foldForSearch } from "@/lib/utils";
import {
  CATALOGUE_ID_PATTERN,
  MAX_LENGTH_MINUTES,
  MAX_PLAYED_MINUTES,
  MAX_SPEAKER_LENGTH,
  isAllowedCoverUrl,
  shelfNameSchema,
} from "@/lib/validation";
import { cleanLibraryViewPatch } from "@/lib/library-view";
import { cleanPreferencesPatch } from "@/lib/preferences";
import {
  MAX_SAVED_VIEWS,
  SAVED_VIEW_NAME_MAX,
  canonicalViewQueryFromString,
} from "@/lib/saved-views";
import { parseThemeSetting, serializeThemeSetting } from "@/lib/themes";

/**
 * Restore of a MyGames backup: the `library.json` from the zip (with
 * `getCoverFile` supplying the bundled cover images), or that same file on
 * its own, unzipped.
 *
 * Semantics: merge into the current user's library. Games already present
 * are skipped (see duplicateFinder for what counts as the same game), so
 * restoring on top of a live library is safe and restoring into a fresh
 * instance brings everything back. A game's local cover path is kept when
 * the file already exists (same instance) or can be restored from the
 * backup, otherwise cleared.
 *
 * Every field goes through the same limits as the form that would have
 * saved it, so a hand-edited backup can't store what the app itself
 * couldn't. A bad value (a cover URL, a catalogue id, one quote) is dropped
 * on its own; only a game without a usable title is refused whole.
 *
 * Account settings (theme, library view, Preferences) are filled in only
 * where this account hasn't set them: a restore onto a fresh account brings
 * the old setup back, and one onto a live account never undoes choices
 * made since. Saved views merge by name like shelves.
 */

/**
 * A list taken one item at a time: an item that won't do is dropped on its
 * own, rather than taking the rest of the list with it. Anything that isn't
 * a list reads as empty, so a backup missing a list still restores.
 */
function eachValid<T extends z.ZodTypeAny>(item: T) {
  return z
    .array(z.unknown())
    .catch([])
    .transform((list) =>
      list.flatMap((x): z.output<T>[] => {
        const parsed = item.safeParse(x);
        return parsed.success ? [parsed.data] : [];
      }),
    );
}

/** Shelf names, taken the way the shelf form takes them (trimmed, 1 to 50
 *  characters). */
const shelfNames = eachValid(shelfNameSchema);

/** Shelves are matched by name in any case, as the shelf form matches them:
 *  a backup's "favourites" is the "Favourites" shelf already here. */
const shelfKey = (name: string) => name.toLowerCase();

/** An ISO date, or null for a missing or unreadable one. */
const dateField = z
  .string()
  .nullable()
  .optional()
  .transform((s) => {
    if (!s) return null;
    const d = new Date(s);
    return Number.isNaN(d.getTime()) ? null : d;
  })
  .catch(null);

/** Trimmed text up to `max` characters; blank is null, as in the forms. */
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullable()
    .optional()
    .transform((s) => s || null);

/** A whole number of minutes in range, or null. A bad value is dropped
 *  rather than refusing what it belongs to. */
const minutesField = (min: number, max: number) =>
  z.number().int().min(min).max(max).nullable().optional().catch(null);

/** 1–10 in half-star units, as the rating control saves it. */
const ratingField = z.number().int().min(1).max(10).nullable().optional().catch(null);

/** A favourite line, with who says it. */
const importedQuoteSchema = z.object({
  text: z.string().trim().min(1).max(5000),
  speaker: optionalText(MAX_SPEAKER_LENGTH).catch(null),
  note: optionalText(2000).catch(null),
  createdAt: dateField,
});

/** A past playthrough. Everything is optional, as on the play history card. */
const importedPlaythroughSchema = z.object({
  dateStarted: dateField,
  dateFinished: dateField,
  rating: ratingField,
  playedMinutes: minutesField(0, MAX_PLAYED_MINUTES),
  note: optionalText(2000).catch(null),
  createdAt: dateField,
});

/** A lending record. Without a borrower it says nothing, so it's dropped. */
const importedLoanSchema = z.object({
  borrower: z.string().trim().min(1).max(100),
  lentAt: dateField,
  returnedAt: dateField,
  note: optionalText(500).catch(null),
  createdAt: dateField,
});

/** A play-log entry: minutes played as of a date. 0 is a real value (the
 *  anchor that starts a playthrough). An entry without a usable date is
 *  meaningless (every consumer is time-based) and is dropped. */
const importedProgressSchema = z.object({
  minutes: z.number().int().min(0).max(MAX_PLAYED_MINUTES),
  date: dateField,
});

/** Developer names, trimmed, each kept or dropped on its own. */
const developerNames = eachValid(z.string().trim().min(1).max(200));

/** Tags as the tag form leaves them: lower case, at most 50 characters,
 *  each once. Split at commas too, since the library's tag filter lists
 *  tags comma-separated and a tag can't hold one. */
const tagList = eachValid(z.string()).transform((tags) => [
  ...new Set(
    tags
      .flatMap((t) => t.split(","))
      .map((t) => t.trim().toLowerCase())
      .filter((t) => t && t.length <= 50),
  ),
]);

const importedGameSchema = z.object({
  title: z.string().trim().min(1).max(500),
  developers: developerNames,
  publisher: optionalText(200).catch(null),
  platform: optionalText(100).catch(null),
  description: z.string().max(10000).nullable().optional().catch(null),
  // Same rule as the game form; a bad value drops the cover, not the game.
  coverUrl: z.string().max(2000).refine(isAllowedCoverUrl).nullable().optional().catch(null),
  lengthMinutes: minutesField(1, MAX_LENGTH_MINUTES),
  releaseDate: optionalText(20).catch(null),
  tags: tagList,
  format: z.nativeEnum(GameFormat).catch(GameFormat.PHYSICAL),
  ownership: z.nativeEnum(GameOwnership).catch(GameOwnership.OWNED),
  seriesName: optionalText(200).catch(null),
  seriesNumber: z.number().min(0).max(10000).nullable().optional().catch(null),
  // Only ids the catalogue clients write, so "Look up details" and the
  // catalogue link never chase something else.
  catalogueId: z
    .string()
    .trim()
    .max(200)
    .regex(CATALOGUE_ID_PATTERN)
    .nullable()
    .optional()
    .catch(null),
  status: z.nativeEnum(PlayStatus).catch(PlayStatus.WANT_TO_PLAY),
  rating: ratingField,
  review: z.string().max(20000).nullable().optional().catch(null),
  dateStarted: dateField,
  dateFinished: dateField,
  timesCompleted: z.number().int().min(0).max(1000).catch(0),
  playedMinutes: minutesField(0, MAX_PLAYED_MINUTES),
  shelves: shelfNames,
  quotes: eachValid(importedQuoteSchema),
  playthroughs: eachValid(importedPlaythroughSchema),
  progress: eachValid(importedProgressSchema),
  loans: eachValid(importedLoanSchema),
  createdAt: dateField,
  updatedAt: dateField,
});

type ImportedGame = z.infer<typeof importedGameSchema>;

const goalSchema = z.object({
  year: z.number().int().min(1900).max(2200),
  // The goal form's own limits (actions/goals.ts).
  target: z.number().int().min(1).max(10_000),
  // No default: a target read in the wrong unit would be a different goal.
  unit: z.nativeEnum(GoalUnit),
  countReplays: z.boolean().catch(true),
});

/** Shelf or saved-view names in a preference, as exported. */
const nameList = z.array(z.string().max(100)).max(500).optional().catch([]);

const exportPayloadSchema = z.object({
  format: z.literal(BACKUP_FORMAT),
  version: z.literal(BACKUP_VERSION),
  shelves: z
    .array(z.unknown())
    .catch([])
    .transform((list) => shelfNames.parse(list.map((s) => (s as { name?: unknown } | null)?.name))),
  playGoals: eachValid(goalSchema),
  settings: z
    .object({
      theme: z.string().max(100).nullable().catch(null),
      libraryView: z.unknown(),
      preferences: z.unknown(),
      defaultViewName: z.string().max(SAVED_VIEW_NAME_MAX).nullable().catch(null),
      // Shelf and saved-view preferences, by name (see restoreSettings).
      shelfOrderNames: nameList,
      hiddenShelfNames: nameList,
      savedViewOrderNames: nameList,
    })
    .nullable()
    .optional()
    .catch(null),
  savedViews: eachValid(
    z.object({
      name: z.string().trim().min(1).max(SAVED_VIEW_NAME_MAX),
      query: z.string().max(4000),
      /** The shelf the query's `shelfId` named, since the id doesn't
       *  survive a move. */
      shelfName: z.string().trim().min(1).max(50).optional().catch(undefined),
    }),
  ),
  games: z.array(z.unknown()),
});

export interface ImportSummary {
  gamesCreated: number;
  gamesSkipped: number;
  gamesInvalid: number;
  shelvesCreated: number;
  goalsRestored: number;
  savedViewsRestored: number;
  /** True when the backup's theme, library view or preferences were applied
   *  (only ever to an account that had none). */
  settingsRestored: boolean;
  coversRestored: number;
  quotesRestored: number;
  playthroughsRestored: number;
  progressRestored: number;
  loansRestored: number;
  /** Set when the restore stopped early. Everything counted above did land —
   *  a restore is resumable by re-running it, since games already present are
   *  skipped — but the caller must not present the run as complete. */
  incomplete?: { after: number; reason: string };
}

/** How many game creates are in flight at once. Each game is a single nested
 *  write (game + its quotes, playthroughs and play log), so per-game
 *  atomicity is already guaranteed by the database; this only bounds how
 *  many of those round-trips overlap. Sequential made a 1000-game restore
 *  1000 waits long; unbounded would open 1000 connections. */
const IMPORT_CONCURRENCY = 10;

/**
 * Runs `worker` over `items`, at most `limit` at a time, preserving order in
 * the returned results and stopping at the first failure.
 *
 * "Stopping" has to be done deliberately. Letting the rejection propagate out
 * of `Promise.all` returns while the other runners are still pulling items and
 * writing — so the caller reads its progress counters mid-flight and reports a
 * total lower than what actually reached the database, which is exactly the
 * number a user is told to trust when re-running an interrupted restore. A
 * second runner failing afterwards would also surface as an unhandled
 * rejection, since nothing is awaiting it any more.
 *
 * So: the first error is captured, remaining runners stop claiming new work,
 * everything already in flight is allowed to settle, and only then is the
 * error rethrown.
 */
async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  let failure: unknown = null;

  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      if (failure !== null) return;
      const i = next++;
      if (i >= items.length) return;
      try {
        results[i] = await worker(items[i], i);
      } catch (err) {
        failure ??= err;
        return;
      }
    }
  });

  await Promise.all(runners); // always settles: runners swallow their own error
  if (failure !== null) throw failure;
  return results;
}

/** Text as duplicate detection compares it: case, accents and spacing
 *  aside, so "Ōkami" and "okami " are the same title. */
function fold(s: string | null | undefined): string {
  return foldForSearch(s ?? "").replace(/\s+/g, " ").trim();
}

/** The fields that say which game a row is. */
type GameIdentity = {
  title: string;
  developers: string[];
  platform: string | null;
  catalogueId: string | null;
};

/** Title, platform and developers (in any order), folded. JSON keeps the
 *  parts apart whatever characters they hold. */
function titleKey(g: GameIdentity): string {
  return JSON.stringify([fold(g.title), fold(g.platform), g.developers.map(fold).sort()]);
}

/** The catalogue entry and the platform. The platform is part of it
 *  because one catalogue entry covers every system a game came out on, and
 *  a copy on the Switch and another on PC are two games in a library. */
function catalogueKey(catalogueId: string, platform: string | null): string {
  return JSON.stringify([catalogueId, fold(platform)]);
}

/**
 * The games already in a library, for telling whether a backup's game is
 * one of them: by catalogue id where both have one, since that survives a
 * title edited on either side and tells a remake from the original of the
 * same name; otherwise by title, platform and developers.
 */
function duplicateFinder(existing: GameIdentity[]) {
  const byCatalogue = new Set<string>();
  const byTitle = new Set<string>();
  /** Title keys of the games without a catalogue id: the only ones a
   *  catalogued game can match by title. */
  const byTitleUncatalogued = new Set<string>();
  const add = (g: GameIdentity) => {
    const key = titleKey(g);
    byTitle.add(key);
    if (g.catalogueId) byCatalogue.add(catalogueKey(g.catalogueId, g.platform));
    else byTitleUncatalogued.add(key);
  };
  existing.forEach(add);
  return (g: GameIdentity): boolean =>
    g.catalogueId
      ? byCatalogue.has(catalogueKey(g.catalogueId, g.platform)) ||
        byTitleUncatalogued.has(titleKey(g))
      : byTitle.has(titleKey(g));
}

/** Reads a cover image bundled with the backup (zip imports supply this). */
export type CoverFileReader = (filename: string) => Promise<Uint8Array | null>;

/** Only names the cover cache itself produces get written back — and only
 *  extensions /api/covers actually serves. Keeps a hand-crafted backup from
 *  planting arbitrary files in the cache directory; the bytes must also be
 *  an image, the same check /api/covers/upload makes. */
const SAFE_COVER_FILENAME = /^[A-Za-z0-9][A-Za-z0-9._-]*\.(jpg|png|gif|webp)$/;

/**
 * A local cover path from the export is kept if the file already exists on
 * this instance, or can be written back from the backup; otherwise cleared.
 * Returns the resolved URL and whether a file was restored from the backup.
 */
async function resolveCoverUrl(
  coverUrl: string | null | undefined,
  getCoverFile: CoverFileReader | undefined,
): Promise<{ url: string | null; restored: boolean }> {
  if (!coverUrl) return { url: null, restored: false };
  if (!coverUrl.startsWith("/api/covers/")) return { url: coverUrl, restored: false }; // remote URL — keep

  const filename = path.basename(coverUrl);
  const target = coverFilePath(filename);
  try {
    await fs.access(target);
    return { url: coverUrl, restored: false }; // same instance — file survived
  } catch {
    // fall through to the backup
  }

  if (getCoverFile && SAFE_COVER_FILENAME.test(filename)) {
    try {
      const data = await getCoverFile(filename);
      if (data && sniffImageKind(data)) {
        await fs.mkdir(coversDir(), { recursive: true });
        await fs.writeFile(target, data);
        return { url: coverUrl, restored: true };
      }
    } catch {
      // unreadable zip entry / disk error — treat as missing
    }
  }
  return { url: null, restored: false };
}

/** Why a file was refused, in words that say what to do about it. */
function notABackup(payload: unknown): string {
  const head = (payload ?? {}) as { format?: unknown; version?: unknown };
  if (head.format === BACKUP_FORMAT && typeof head.version === "number" && head.version > BACKUP_VERSION) {
    return "This backup is from a newer version of MyGames. Update this one, then restore it again.";
  }
  return "That isn't a MyGames backup.";
}

export async function importLibrary(
  userId: string,
  payload: unknown,
  getCoverFile?: CoverFileReader,
): Promise<ImportSummary | { error: string }> {
  const parsed = exportPayloadSchema.safeParse(payload);
  if (!parsed.success) return { error: notABackup(payload) };
  const data = parsed.data;

  // Shelves: create the missing ones, map every name to an id.
  const existingShelves = await prisma.shelf.findMany({
    where: { userId },
    select: { id: true, name: true },
  });
  // Keyed by shelfKey; where names differ only in case, the first wins.
  const shelfIdByName = new Map<string, string>();
  for (const s of existingShelves) {
    if (!shelfIdByName.has(shelfKey(s.name))) shelfIdByName.set(shelfKey(s.name), s.id);
  }
  const wantedShelves = new Map<string, string>();
  const want = (name: string) => {
    if (!wantedShelves.has(shelfKey(name))) wantedShelves.set(shelfKey(name), name);
  };
  data.shelves.forEach(want);
  for (const raw of data.games) {
    shelfNames.parse((raw as { shelves?: unknown } | null)?.shelves).forEach(want);
  }
  // Missing shelves in one statement, then read back to learn their ids —
  // two round-trips instead of one per shelf.
  const missingShelves = [...wantedShelves]
    .filter(([key]) => !shelfIdByName.has(key))
    .map(([, name]) => name);
  let shelvesCreated = 0;
  if (missingShelves.length > 0) {
    const created = await prisma.shelf.createMany({
      data: missingShelves.map((name) => ({ userId, name })),
      skipDuplicates: true,
    });
    shelvesCreated = created.count;
    const refreshed = await prisma.shelf.findMany({
      where: { userId, name: { in: missingShelves } },
      select: { id: true, name: true },
    });
    for (const s of refreshed) shelfIdByName.set(shelfKey(s.name), s.id);
  }

  // Play goals: upsert per year, concurrently — they're independent. A
  // year listed twice keeps its last entry, as saving it twice would.
  const goals = [...new Map(data.playGoals.map((g) => [g.year, g])).values()];
  await mapWithConcurrency(goals, IMPORT_CONCURRENCY, (goal) =>
    prisma.playGoal.upsert({
      where: { userId_year: { userId, year: goal.year } },
      create: {
        userId,
        year: goal.year,
        target: goal.target,
        unit: goal.unit,
        countReplays: goal.countReplays,
      },
      update: { target: goal.target, unit: goal.unit, countReplays: goal.countReplays },
    }),
  );

  // Saved views: add the ones whose names are new here, up to the cap.
  // Queries are rebuilt the same way saving one does, so a hand-edited
  // backup can't store parameters the library doesn't know. A view kept to
  // one shelf is pointed at that shelf here, found by name; when there's no
  // such shelf (or the backup gave only an id from elsewhere), the shelf is
  // dropped rather than left naming one that matches nothing.
  const ownShelfIds = new Set(shelfIdByName.values());
  const restoredQuery = (view: { query: string; shelfName?: string }) => {
    const params = new URLSearchParams(view.query);
    const oldId = params.get("shelfId");
    if (oldId) {
      const id = view.shelfName
        ? shelfIdByName.get(shelfKey(view.shelfName))
        : ownShelfIds.has(oldId)
          ? oldId
          : undefined;
      if (id) params.set("shelfId", id);
      else params.delete("shelfId");
    }
    return canonicalViewQueryFromString(params.toString());
  };
  const existingViewCount = await prisma.savedView.count({ where: { userId } });
  const viewsCreated = await prisma.savedView.createMany({
    data: data.savedViews
      .slice(0, Math.max(0, MAX_SAVED_VIEWS - existingViewCount))
      .map((v) => ({ userId, name: v.name, query: restoredQuery(v) })),
    skipDuplicates: true,
  });

  const settingsRestored = data.settings ? await restoreSettings(userId, data.settings) : false;

  // Existing games, for duplicate detection.
  const isDuplicate = duplicateFinder(
    await prisma.game.findMany({
      where: { userId },
      select: { title: true, developers: true, platform: true, catalogueId: true },
    }),
  );

  let gamesSkipped = 0;
  let gamesInvalid = 0;

  // Pass 1 — decide, sequentially. A game already in the library is
  // skipped, so a restore can be re-run. Within the file itself only a true
  // repeat is skipped: the same game (by the same rule) in the same format.
  // So a physical copy and a digital one of the same game both come back,
  // as the library had them. Each accepted game is folded into `seen` as
  // the file is walked; that ordering dependency is why the decisions stay
  // serial; only the slow database work below is parallelised.
  const seen = new Set<string>();
  const accepted: ImportedGame[] = [];
  for (const raw of data.games) {
    const parsedGame = importedGameSchema.safeParse(raw);
    if (!parsedGame.success) {
      gamesInvalid++;
      continue;
    }
    const g = parsedGame.data;
    const identity = {
      title: g.title,
      developers: g.developers,
      platform: g.platform,
      catalogueId: g.catalogueId ?? null,
    };
    const repeat = JSON.stringify([
      identity.catalogueId ? catalogueKey(identity.catalogueId, identity.platform) : titleKey(identity),
      g.format,
    ]);
    if (isDuplicate(identity) || seen.has(repeat)) {
      gamesSkipped++;
      continue;
    }
    seen.add(repeat);
    accepted.push(g);
  }

  let gamesCreated = 0;
  let coversRestored = 0;
  let quotesRestored = 0;
  let playthroughsRestored = 0;
  let progressRestored = 0;
  let loansRestored = 0;
  let incomplete: ImportSummary["incomplete"];

  // Pass 2 — write, with bounded concurrency. Each game is one nested create,
  // so a game and its quotes, playthroughs and play log can never land
  // half-written.
  const createOne = async (g: ImportedGame) => {
    const cover = await resolveCoverUrl(g.coverUrl, getCoverFile);

    // Play history. A file that gives a count without the playthroughs
    // behind it (one put together by hand, say) gets that many undated past
    // playthroughs, less the current one, which lives on the Game row.
    // Either way timesCompleted ends up consistent with the rows created.
    const isCompleted = g.status === PlayStatus.COMPLETED;
    const pastPlaythroughs =
      g.playthroughs.length > 0
        ? g.playthroughs
        : Array.from({ length: Math.max(g.timesCompleted - (isCompleted ? 1 : 0), 0) }, () => ({
            dateStarted: null,
            dateFinished: null,
            rating: null,
            playedMinutes: null,
            note: null,
            createdAt: null,
          }));
    const timesCompleted = pastPlaythroughs.length + (isCompleted ? 1 : 0);
    const progress = g.progress.filter((e) => e.date != null);

    await prisma.game.create({
      data: {
        userId,
        title: g.title,
        developers: g.developers,
        publisher: g.publisher,
        platform: g.platform,
        description: g.description || null,
        coverUrl: cover.url,
        lengthMinutes: g.lengthMinutes ?? null,
        releaseDate: g.releaseDate,
        tags: g.tags,
        format: g.format,
        ownership: g.ownership,
        seriesName: g.seriesName,
        seriesNumber: g.seriesNumber ?? null,
        catalogueId: g.catalogueId ?? null,
        status: g.status,
        rating: g.rating ?? null,
        review: g.review || null,
        reviewSearchText: foldForSearch(g.review ?? ""),
        dateStarted: g.dateStarted,
        dateFinished: g.dateFinished,
        timesCompleted,
        playedMinutes: g.playedMinutes ?? null,
        searchText: buildSearchText(g.title, g.developers, g.seriesName, g.platform),
        // Preserve "date added" and "recently edited" from the original
        // library, so both sorts still mean something after a restore.
        ...(g.createdAt && { createdAt: g.createdAt }),
        ...(g.updatedAt && { updatedAt: g.updatedAt }),
        shelves: {
          connect: [
            ...new Set(
              g.shelves
                .map((name) => shelfIdByName.get(shelfKey(name)))
                .filter((id): id is string => !!id),
            ),
          ].map((id) => ({ id })),
        },
        quotes: {
          create: g.quotes.map((q) => ({
            text: q.text,
            speaker: q.speaker,
            note: q.note,
            ...(q.createdAt && { createdAt: q.createdAt }),
          })),
        },
        playthroughs: {
          create: pastPlaythroughs.map((p) => ({
            dateStarted: p.dateStarted,
            dateFinished: p.dateFinished,
            rating: p.rating ?? null,
            playedMinutes: p.playedMinutes ?? null,
            note: p.note,
            ...(p.createdAt && { createdAt: p.createdAt }),
          })),
        },
        progress: {
          create: progress.map((e) => ({ minutes: e.minutes, date: e.date! })),
        },
        loans: {
          // An undated loan cannot be reasoned about (how long has it been
          // out?), so lentAt falls back to the record's creation date and
          // finally to now rather than dropping the borrower entirely.
          create: g.loans.map((l) => ({
            borrower: l.borrower,
            lentAt: l.lentAt ?? l.createdAt ?? new Date(),
            returnedAt: l.returnedAt,
            note: l.note,
            ...(l.createdAt && { createdAt: l.createdAt }),
          })),
        },
      },
    });

    // Counted only after the write lands, so the summary never claims a game
    // the database rejected.
    if (cover.restored) coversRestored++;
    gamesCreated++;
    quotesRestored += g.quotes.length;
    playthroughsRestored += pastPlaythroughs.length;
    progressRestored += progress.length;
    loansRestored += g.loans.length;
  };

  try {
    await mapWithConcurrency(accepted, IMPORT_CONCURRENCY, createOne);
  } catch (err) {
    // A restore is not one transaction — wrapping thousands of nested writes
    // in a single long-running transaction trades this failure mode for a
    // worse one. Instead the games written so far stay written, and the run
    // says so. Re-running the same backup finishes the job: everything
    // already restored is detected as a duplicate and skipped.
    incomplete = {
      after: gamesCreated,
      reason: err instanceof Error ? err.message : "unknown error",
    };
  }

  return {
    gamesCreated,
    gamesSkipped,
    gamesInvalid,
    shelvesCreated,
    goalsRestored: goals.length,
    savedViewsRestored: viewsCreated.count,
    settingsRestored,
    coversRestored,
    quotesRestored,
    playthroughsRestored,
    progressRestored,
    loansRestored,
    ...(incomplete && { incomplete }),
  };
}

/**
 * Applies a backup's account settings wherever this account hasn't chosen
 * its own: the theme if none is saved, and each library-view and
 * Preferences field the account has never set. Field by field rather than
 * all or nothing, because a fresh account already has a little saved — its
 * time zone is filled in on the very first page load. Each value goes
 * through the same cleaning a save does, so nothing unknown is stored; the
 * default saved view is matched by name, since view ids are new on every
 * instance.
 */
async function restoreSettings(
  userId: string,
  settings: {
    theme: string | null;
    libraryView?: unknown;
    preferences?: unknown;
    defaultViewName: string | null;
    shelfOrderNames?: string[];
    hiddenShelfNames?: string[];
    savedViewOrderNames?: string[];
  },
): Promise<boolean> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { theme: true, libraryView: true, preferences: true },
  });
  if (!user) return false;

  const asObject = (v: unknown): Record<string, unknown> =>
    v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  /** The backup's fields that the stored object doesn't have yet. */
  const missing = (stored: Record<string, unknown>, backup: Record<string, unknown>) =>
    Object.fromEntries(Object.entries(backup).filter(([k]) => !(k in stored)));

  const data: Prisma.UserUpdateInput = {};

  const theme = parseThemeSetting(settings.theme);
  if (user.theme === null && theme) data.theme = serializeThemeSetting(theme);

  const storedView = asObject(user.libraryView);
  const viewAdds = missing(storedView, cleanLibraryViewPatch(settings.libraryView));
  if (Object.keys(viewAdds).length > 0) {
    data.libraryView = { ...storedView, ...viewAdds } as Prisma.InputJsonObject;
  }

  const storedPrefs = asObject(user.preferences);
  // The backup's own ids point at shelves and views on the old instance;
  // they come back through the names exported beside them.
  const {
    defaultViewId: _oldViewId,
    shelfOrder: _oldShelfOrder,
    hiddenShelves: _oldHiddenShelves,
    savedViewOrder: _oldViewOrder,
    ...backupPrefs
  } = cleanPreferencesPatch(settings.preferences);
  const prefAdds: Record<string, unknown> = missing(storedPrefs, backupPrefs);

  const [shelves, views] = await Promise.all([
    prisma.shelf.findMany({ where: { userId }, select: { id: true, name: true } }),
    prisma.savedView.findMany({ where: { userId }, select: { id: true, name: true } }),
  ]);
  const shelfIds = new Map(shelves.map((s) => [shelfKey(s.name), s.id]));
  const viewIds = new Map(views.map((v) => [v.name, v.id]));
  const idsOf = (
    names: string[] | undefined,
    ids: Map<string, string>,
    key: (name: string) => string = (name) => name,
  ) => (names ?? []).flatMap((name) => ids.get(key(name)) ?? []);
  const byName: [string, string[]][] = [
    ["shelfOrder", idsOf(settings.shelfOrderNames, shelfIds, shelfKey)],
    ["hiddenShelves", idsOf(settings.hiddenShelfNames, shelfIds, shelfKey)],
    ["savedViewOrder", idsOf(settings.savedViewOrderNames, viewIds)],
  ];
  for (const [key, ids] of byName) {
    if (ids.length > 0 && !(key in storedPrefs)) prefAdds[key] = ids;
  }
  if (settings.defaultViewName && !("defaultViewId" in storedPrefs)) {
    const id = viewIds.get(settings.defaultViewName);
    if (id) prefAdds.defaultViewId = id;
  }
  if (Object.keys(prefAdds).length > 0) {
    data.preferences = { ...storedPrefs, ...prefAdds } as Prisma.InputJsonObject;
  }

  if (Object.keys(data).length === 0) return false;
  await prisma.user.update({ where: { id: userId }, data });
  return true;
}
