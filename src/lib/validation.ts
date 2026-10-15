import { z } from "zod";
import { GameFormat, GameOwnership, PlayStatus } from "@prisma/client";
import { parseCatalogueId } from "@/lib/metadata/links";
import { parseDuration, TIME_EXAMPLE } from "@/lib/progress-units";

/**
 * What a stored cover URL may be: a local path ("/api/covers/…") or an
 * http(s) URL. Not `javascript:` or `data:`, and not a protocol-relative
 * `//host/x` or `/\host/x`, which start with "/" but point off-site.
 * Shared by the game form and the backup import.
 */
export function isAllowedCoverUrl(s: string): boolean {
  return s === "" || /^\/(?![/\\])/.test(s) || /^https?:\/\//i.test(s);
}

/** Shared by registration and the change-password form. */
export const passwordSchema = z
  .string()
  .min(8, "Password must be at least 8 characters")
  // bcrypt only uses the first 72 bytes; reject rather than silently truncate
  .max(72, "Password must be at most 72 characters");

export const registerSchema = z.object({
  username: z
    .string()
    .trim()
    .min(3, "Username must be at least 3 characters")
    .max(32, "Username must be at most 32 characters")
    .regex(
      /^[a-zA-Z0-9._-]+$/,
      "Username may only contain letters, numbers, and . _ -",
    ),
  password: passwordSchema,
});

/** Account page: change password. The current password re-proves identity —
 *  a stolen session cookie alone must not be enough to take the account. */
export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, "Current password is required"),
  newPassword: passwordSchema,
});

/** The longest time to beat a game can have, in minutes (1,000 hours).
 *  Shared with the backup restore, so a restored game passes the form. */
export const MAX_LENGTH_MINUTES = 60_000;

/** The most time one playthrough can record, in minutes (10,000 hours).
 *  Generous on purpose: some games are played for years. Shared with the
 *  backup restore. */
export const MAX_PLAYED_MINUTES = 600_000;

/**
 * Whether text is a catalogue id: "igdb:<slug>", "steam:<app id>" or
 * "wikidata:<Q-id>", as the catalogue clients write them, checked by the
 * same parser that reads them back. The form carries it in a hidden field,
 * so anything else came from somewhere else and would only make "Look up
 * details" and the catalogue link go wrong.
 */
export function isCatalogueId(s: string): boolean {
  return parseCatalogueId(s) !== null;
}

/** Trimmed text with a length limit; blank is null. */
function optionalText(max: number, message?: string) {
  return z
    .string()
    .trim()
    .max(max, message)
    .transform((s) => s || null)
    .nullable()
    .optional();
}

/**
 * Time played, as typed: "12:30", "12h 30m", "45 min", "1.5h" or a bare
 * number of minutes (see parseDuration). Blank or zero is none (null); not
 * sent at all is undefined, which updatePlay reads as "keep the time there
 * is". Something that isn't a time is reported rather than quietly dropped,
 * so a typo never wipes the time already recorded.
 */
const playedMinutesField = z
  .string()
  .optional()
  .transform((s, ctx) => {
    if (s === undefined) return undefined;
    const text = s.trim();
    if (!text) return null;
    const minutes = parseDuration(text);
    if (minutes === null) {
      ctx.addIssue({ code: "custom", message: `Couldn't read “${text.slice(0, 20)}”. ${TIME_EXAMPLE}` });
      return z.NEVER;
    }
    if (minutes > MAX_PLAYED_MINUTES) {
      ctx.addIssue({ code: "custom", message: "Time played must be at most 10,000 hours" });
      return z.NEVER;
    }
    return minutes || null;
  });

/** Shared shape for creating and editing games. Forms submit strings; this
 *  schema does the coercion so server actions can pass FormData through. */
export const gameSchema = z.object({
  title: z.string().trim().min(1, "Title is required").max(500),
  /** The studios, comma-separated in the form; stored as an array. */
  developers: z
    .string()
    .transform((s) =>
      s
        .split(",")
        .map((a) => a.trim())
        .filter(Boolean),
    ),
  publisher: optionalText(200, "Publisher must be at most 200 characters"),
  /** The platform you play it on. Freeform: the form only suggests names. */
  platform: optionalText(100, "Platform must be at most 100 characters"),
  description: optionalText(10000),
  /**
   * Either a local cache path ("/api/covers/…") or a remote image URL the
   * player pasted. Bounded like every other free-text field and restricted
   * to http(s), so a `javascript:` or `data:` value can't be stored and
   * later rendered into an attribute.
   */
  coverUrl: z
    .string()
    .trim()
    .max(2000, "Cover URL must be at most 2000 characters")
    .refine(isAllowedCoverUrl, "Cover URL must be an http(s) URL")
    .transform((s) => s || null)
    .nullable()
    .optional(),
  /** How long the game usually takes to beat, in whole minutes (the form's
   *  hours and minutes, added up). Blank is "not known". A bad value is
   *  reported rather than quietly dropped. */
  lengthMinutes: z.preprocess(
    (v) => (typeof v === "string" && v.trim() === "" ? null : v),
    z.coerce
      .number()
      .int("Time to beat must be whole minutes")
      .min(1, "Time to beat must be at least 1 minute")
      .max(MAX_LENGTH_MINUTES, "Time to beat must be at most 1,000 hours")
      .nullable()
      .optional(),
  ),
  /** As the catalogues give it: "1998", "2017-03" or "2017-03-03". */
  releaseDate: optionalText(20),
  tags: z
    .string()
    .transform((s) => [
      // Deduped: catalogue genres often differ only in case ("RPG", "rpg"),
      // which collide after lowercasing — and duplicate tags break React
      // keys wherever tags render.
      ...new Set(
        s
          .split(",")
          .map((t) => t.trim().toLowerCase())
          .filter(Boolean),
      ),
    ]),
  seriesName: optionalText(200),
  /** Position in a series; float so a spin-off can slot in at 2.5. A blank
   *  field is no number, not #0: `z.coerce` alone turns "" into 0, and 0 is
   *  a real position (prequels are often numbered 0). */
  seriesNumber: z.preprocess(
    (v) => (typeof v === "string" && v.trim() === "" ? null : v),
    z.coerce.number().min(0).max(10000).nullable().optional().catch(null),
  ),
  format: z.nativeEnum(GameFormat),
  /** Defaults to OWNED so a form that omits the field (or sends something
   *  unexpected) still saves as an ordinary game in your collection. */
  ownership: z.nativeEnum(GameOwnership).catch(GameOwnership.OWNED),
  /** The catalogue entry the game came from; blank when typed in by hand. */
  catalogueId: z
    .string()
    .trim()
    .max(200)
    .refine((s) => s === "" || isCatalogueId(s), "That isn't a catalogue id MyGames knows")
    .transform((s) => s || null)
    .nullable()
    .optional(),
});

/** "" → null, unparseable → null, otherwise a valid Date. */
function parseDateOrNull(s: string): Date | null {
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Started/finished dates must make sense together: no finishing before you
 * started (it shows up as a negative "quickest to complete"), and nothing in
 * the future. "Future" allows a day's slack, because the form sends a calendar
 * date read as midnight UTC, which is already tomorrow east of UTC.
 */
function checkPlayDates(
  d: { dateStarted?: Date | null; dateFinished?: Date | null },
  ctx: z.RefinementCtx,
) {
  const latest = Date.now() + 86_400_000;
  if (d.dateStarted && d.dateStarted.getTime() > latest) {
    ctx.addIssue({ code: "custom", path: ["dateStarted"], message: "Start date is in the future" });
  }
  if (d.dateFinished && d.dateFinished.getTime() > latest) {
    ctx.addIssue({ code: "custom", path: ["dateFinished"], message: "Finish date is in the future" });
  }
  if (d.dateStarted && d.dateFinished && d.dateFinished < d.dateStarted) {
    ctx.addIssue({
      code: "custom",
      path: ["dateFinished"],
      message: "Finish date is before the start date",
    });
  }
}

/** Personal play data, editable from the game detail page. */
export const playSchema = z.object({
  status: z.nativeEnum(PlayStatus),
  /** 1–10 half-star units; empty string/0 clears the rating. */
  rating: z.coerce.number().int().min(0).max(10).nullable().optional().catch(null),
  review: z
    .string()
    .trim()
    .max(20000)
    .transform((s) => s || null)
    .nullable()
    .optional(),
  dateStarted: z
    .string()
    .transform(parseDateOrNull)
    .nullable()
    .optional(),
  dateFinished: z
    .string()
    .transform(parseDateOrNull)
    .nullable()
    .optional(),
  /** Time played so far in this playthrough, typed ("12:30"). */
  playedMinutes: playedMinutesField,
  /** The "Don't remember" box next to the finish date: a ticked checkbox
   *  sends "on", an unticked one sends nothing. */
  finishedUnknown: z.preprocess((v) => v === "on" || v === "true" || v === true, z.boolean()),
}).superRefine(checkPlayDates);

/** A past playthrough of a game (the play history card). Everything is
 *  optional: "I know I beat this in 2019" and a fully undated "played it
 *  before" are both valid entries. */
export const pastPlaythroughSchema = z.object({
  dateStarted: z
    .string()
    .transform(parseDateOrNull)
    .nullable()
    .optional(),
  dateFinished: z
    .string()
    .transform(parseDateOrNull)
    .nullable()
    .optional(),
  /** 1–10 half-star units; empty string/0 means "unrated that time". */
  rating: z.coerce.number().int().min(0).max(10).nullable().optional().catch(null),
  /** How long that playthrough took, when you know ("42:00"). */
  playedMinutes: playedMinutesField,
  /** "100%, on hard"; empty clears it. Same limit as restore. */
  note: z
    .string()
    .trim()
    .max(2000, "Keep the note to 2000 characters or fewer.")
    .transform((s) => s || null)
    .nullable()
    .optional(),
}).superRefine(checkPlayDates);

/** The longest speaker name a quote can carry. Shared with the restore. */
export const MAX_SPEAKER_LENGTH = 200;

/** A favourite line from the game detail page. Forms submit strings. */
export const quoteSchema = z.object({
  text: z
    .string()
    .trim()
    .min(1, "Quote text is required")
    .max(5000, "Quote must be at most 5000 characters"),
  /** Who says it in the game ("Cave old man"); empty means nobody named. */
  speaker: optionalText(
    MAX_SPEAKER_LENGTH,
    `Speaker must be at most ${MAX_SPEAKER_LENGTH} characters`,
  ),
  note: z
    .string()
    .trim()
    .max(2000)
    .transform((s) => s || null)
    .nullable()
    .optional(),
});

/** Lending a copy out. Only the borrower is required — "I lent it to Kari"
 *  is a complete thought, and the date defaults to today. */
export const loanSchema = z.object({
  borrower: z
    .string()
    .trim()
    .min(1, "Who has it?")
    .max(100, "Name must be at most 100 characters"),
  lentAt: z
    .string()
    .transform(parseDateOrNull)
    .nullable()
    .optional(),
  note: z
    .string()
    .trim()
    .max(500)
    .transform((s) => s || null)
    .nullable()
    .optional(),
});

export const shelfNameSchema = z
  .string()
  .trim()
  .min(1, "Shelf name is required")
  .max(50, "Shelf name must be at most 50 characters");

export type GameInput = z.infer<typeof gameSchema>;
export type PlayInput = z.infer<typeof playSchema>;
