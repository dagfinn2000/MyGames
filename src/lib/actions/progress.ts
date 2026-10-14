"use server";

import { revalidatePath } from "next/cache";
import { PlayStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireUserId } from "@/lib/actions/helpers";
import { calendarDay, dayKey } from "@/lib/dates";
import { formatDate } from "@/lib/display";
import { parsePreferences, serverTimeZone, type Preferences } from "@/lib/preferences";
import { currentPassEntries } from "@/lib/progress";
import { formatPlaytime } from "@/lib/progress-units";
import {
  anchorMoment,
  describeDay,
  editEntrySchema,
  idSchema,
  lastLogged,
  loggedWhen,
  logTimeSchema,
  moveTargetSchema,
  passAround,
  placeInLog,
  resolveLogDay,
  undoMoveSchema,
  type EntryEditResult,
  type LogTimeResult,
  type MoveResult,
  type UndoMove,
} from "@/lib/play-log";
import { settlePlayState } from "@/lib/play-state";

/**
 * The play log outside the play form: quick logging for any day, fixing
 * and deleting entries, and Finished / Stopped from Now playing. The rules
 * for where an entry may go live in lib/play-log.ts; the form's own logging
 * is logProgress in actions/games.ts.
 *
 * Every time is the total played in the playthrough so far, never the
 * length of one session; messages say both where that helps. No time is
 * ever refused for being past the game's time to beat.
 */

/** Oldest first; minutes break same-instant ties, so a playthrough's
 *  0-minute anchor sorts before its first real entry (same order as
 *  stats). */
const LOG_ORDER = [{ date: "asc" as const }, { minutes: "asc" as const }];
const LOG_FIELDS = { id: true, minutes: true, date: true } as const;

function revalidatePlaying(gameId: string) {
  revalidatePath(`/games/${gameId}`);
  revalidatePath("/games");
  revalidatePath("/playing");
  revalidatePath("/stats");
}

/** The player's preferences with the zone filled in (the same rule as
 *  getPreferences, read straight from the row). */
async function playerPrefs(userId: string): Promise<Preferences> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { preferences: true },
  });
  const prefs = parsePreferences(user?.preferences);
  return { ...prefs, timeZone: prefs.timeZone || serverTimeZone() };
}

const NOT_PLAYING = "Only games you're playing can log time. Set this one to Playing first.";
const FUTURE = "That day hasn't happened yet.";
const CHANGED = "This game has changed since. Open it to set its status.";

function beforeStarted(dateStarted: Date, prefs: Preferences): string {
  return `You started this game on ${formatDate(dateStarted, prefs)}. Pick that day or later.`;
}

/**
 * Log the time played so far in a game you're playing, for today or an
 * earlier day. The newest entry moves the game's time played with it
 * (writing the playthrough's 0-minute anchor first if it has none, as the
 * play form does); an earlier day's entry slots in between the entries
 * around it and leaves the time played alone.
 */
export async function logTime(
  gameId: string,
  input: { minutes: number; day: string },
): Promise<LogTimeResult> {
  const userId = await requireUserId();
  const id = idSchema.safeParse(gameId);
  if (!id.success) return { error: "Game not found" };
  const parsed = logTimeSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  const { minutes, day } = parsed.data;

  const game = await prisma.game.findFirst({
    where: { id: id.data, userId },
    select: { status: true, dateStarted: true },
  });
  if (!game) return { error: "Game not found" };
  if (game.status !== PlayStatus.PLAYING) return { error: NOT_PLAYING };

  const prefs = await playerPrefs(userId);
  const tz = prefs.timeZone;
  const typed = formatPlaytime(minutes);
  const now = new Date();
  const today = dayKey(now, tz);
  const resolved = resolveLogDay(day, now, tz);
  if ("error" in resolved) return { error: FUTURE };
  const { key, at } = resolved;
  if (game.dateStarted && key < calendarDay(game.dateStarted, tz)) {
    return { error: beforeStarted(game.dateStarted, prefs) };
  }
  const forDay = describeDay(key, today, prefs.dateFormat);

  const result = await prisma.$transaction(async (tx): Promise<LogTimeResult> => {
    const all = await tx.progressEntry.findMany({
      where: { gameId: id.data },
      orderBy: LOG_ORDER,
      select: LOG_FIELDS,
    });
    const pass = currentPassEntries(all, game.dateStarted, tz);
    const previous = pass.length > 0 ? (all[all.indexOf(pass[0]) - 1] ?? null) : null;
    const placement = placeInLog(pass, { minutes, date: at }, { timeZone: tz, previous });

    if (!placement.ok) {
      const n = placement.neighbour;
      if (placement.reason === "beforeStart") {
        return { error: `That's before this playthrough started (${formatDate(n.date, prefs)}).` };
      }
      const when = loggedWhen(calendarDay(n.date, tz), today, prefs.dateFormat);
      const theirs = formatPlaytime(n.minutes);
      return {
        error:
          placement.reason === "below"
            ? `${typed} for ${forDay} is less than the ${theirs} you logged ${when}. If that entry is wrong, fix it with its pencil.`
            : `${typed} for ${forDay} is more than the ${theirs} you logged ${when}. Log it for a later day, or fix that entry.`,
      };
    }

    if (placement.moveAnchor) {
      await tx.progressEntry.update({ where: { id: placement.moveAnchor.id }, data: { date: at } });
    }
    // A fresh playthrough's first entry counts from its anchor, written
    // below; anything else from the entry it follows.
    const from = pass.length === 0 ? 0 : (placement.before?.minutes ?? null);
    const gained = from === null ? 0 : minutes - from;
    const logged =
      gained > 0 && gained < minutes
        ? `Logged ${formatPlaytime(gained)} for ${forDay}, ${typed} in all.`
        : `Logged ${typed} for ${forDay}.`;

    if (placement.after) {
      // An earlier day, between two entries: one more point in the log. The
      // game's time played is still the newest entry's.
      await tx.progressEntry.create({ data: { gameId: id.data, minutes, date: at } });
      return { ok: true, message: logged, minutes };
    }

    // The newest entry. Compared with the log rather than
    // Game.playedMinutes, which can disagree with it (an entry deleted
    // before deleting resynced the time): logging the time the bar already
    // shows still has to reach the log, or that day's play is never
    // credited.
    await tx.game.update({ where: { id: id.data }, data: { playedMinutes: minutes } });
    if (lastLogged(pass)?.minutes === minutes) {
      return { ok: true, message: `Already at ${typed}.`, minutes };
    }
    const entries = [];
    if (pass.length === 0) {
      entries.push({ gameId: id.data, minutes: 0, date: anchorMoment(game.dateStarted, at) });
    }
    entries.push({ gameId: id.data, minutes, date: at });
    await tx.progressEntry.createMany({ data: entries });
    return { ok: true, message: logged, minutes };
  });

  if (!("error" in result)) revalidatePlaying(id.data);
  return result;
}

/**
 * Fix a log entry's time or day. It has to stay within its own playthrough
 * and fit between the entries around it; the game's time played follows
 * when the entry is the newest of the current playthrough.
 */
export async function updateProgressEntry(
  entryId: string,
  input: { minutes: number; day: string },
): Promise<EntryEditResult> {
  const userId = await requireUserId();
  const id = idSchema.safeParse(entryId);
  if (!id.success) return { error: "Entry not found" };
  const parsed = editEntrySchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  const { minutes, day } = parsed.data;

  const entry = await prisma.progressEntry.findFirst({
    where: { id: id.data, game: { userId } },
    select: {
      id: true,
      minutes: true,
      date: true,
      gameId: true,
      game: { select: { status: true, dateStarted: true } },
    },
  });
  if (!entry) return { error: "Entry not found" };
  // The 0-minute anchor marks where a playthrough starts; moving it would
  // hand one playthrough's time to another. The log doesn't offer it.
  if (entry.minutes === 0) return { error: "The start of a playthrough can't be changed." };
  const { game } = entry;

  const prefs = await playerPrefs(userId);
  const tz = prefs.timeZone;
  const now = new Date();
  const today = dayKey(now, tz);
  // Same day: keep the entry's own moment, so a time fix doesn't reorder it.
  let at = entry.date;
  const moved = day !== calendarDay(entry.date, tz);
  if (moved) {
    const resolved = resolveLogDay(day, now, tz);
    if ("error" in resolved) return { error: FUTURE };
    at = resolved.at;
  }

  const result = await prisma.$transaction(async (tx): Promise<EntryEditResult> => {
    const all = await tx.progressEntry.findMany({
      where: { gameId: entry.gameId },
      orderBy: LOG_ORDER,
      select: LOG_FIELDS,
    });
    const around = passAround(all, entry.id);
    if (!around) return { error: "Entry not found" };
    if (around.nextAnchor && at.getTime() >= around.nextAnchor.date.getTime()) {
      return {
        error: `That's after you started playing it again (${formatDate(around.nextAnchor.date, prefs)}).`,
      };
    }
    // Without a 0-minute anchor the playthrough starts on its Started day,
    // and an entry moved before that would drop out of it, taking the
    // game's time played with it (placeInLog only knows the anchor).
    if (
      moved &&
      around.isCurrent &&
      around.pass[0]?.minutes !== 0 &&
      game.dateStarted &&
      day < calendarDay(game.dateStarted, tz) &&
      currentPassEntries(all, game.dateStarted, tz).some((e) => e.id === entry.id)
    ) {
      return { error: beforeStarted(game.dateStarted, prefs) };
    }
    const placement = placeInLog(
      around.pass,
      { minutes, date: at },
      { timeZone: tz, skipId: entry.id, previous: around.previous },
    );
    if (!placement.ok) {
      if (placement.reason === "beforeStart") {
        return {
          error: `That's before this playthrough started (${formatDate(placement.neighbour.date, prefs)}).`,
        };
      }
      const lo = formatPlaytime(placement.before?.minutes ?? 0);
      return {
        error: placement.after
          ? `That entry has to stay between ${lo} and ${formatPlaytime(placement.after.minutes)}, to fit the days around it.`
          : `That entry can't be less than ${lo}, to fit the days around it.`,
      };
    }

    if (placement.moveAnchor) {
      await tx.progressEntry.update({ where: { id: placement.moveAnchor.id }, data: { date: at } });
    }
    await tx.progressEntry.update({ where: { id: entry.id }, data: { minutes, date: at } });

    // The game's time played follows the newest entry of the playthrough in
    // progress.
    if (
      around.isCurrent &&
      (game.status === PlayStatus.PLAYING || game.status === PlayStatus.DROPPED)
    ) {
      const fresh = await tx.progressEntry.findMany({
        where: { gameId: entry.gameId },
        orderBy: LOG_ORDER,
        select: LOG_FIELDS,
      });
      const pass = currentPassEntries(fresh, game.dateStarted, tz);
      await tx.game.update({
        where: { id: entry.gameId },
        data: { playedMinutes: lastLogged(pass)?.minutes ?? null },
      });
    }
    const forDay = describeDay(calendarDay(at, tz), today, prefs.dateFormat);
    return { message: `Fixed: ${formatPlaytime(minutes)} for ${forDay}.` };
  });

  if (!result.error) revalidatePlaying(entry.gameId);
  return result;
}

/**
 * Delete a play log entry (ownership checked through the game). Deleting
 * the newest entry of the playthrough in progress moves the game's time
 * played back to the entry before it, so the bar keeps matching the log.
 */
export async function deleteProgressEntry(entryId: string): Promise<{ error?: string }> {
  const userId = await requireUserId();
  const id = idSchema.safeParse(entryId);
  if (!id.success) return { error: "Entry not found" };

  const existing = await prisma.progressEntry.findFirst({
    where: { id: id.data, game: { userId } },
    select: {
      id: true,
      minutes: true,
      gameId: true,
      game: { select: { status: true, dateStarted: true } },
    },
  });
  if (!existing) return { error: "Entry not found" };
  // Without its anchor a playthrough would run on into the one before it.
  if (existing.minutes === 0) return { error: "The start of a playthrough can't be deleted." };
  const tz = (await playerPrefs(userId)).timeZone;

  await prisma.$transaction(async (tx) => {
    const all = await tx.progressEntry.findMany({
      where: { gameId: existing.gameId },
      orderBy: LOG_ORDER,
      select: LOG_FIELDS,
    });
    const pass = currentPassEntries(all, existing.game.dateStarted, tz);
    await tx.progressEntry.delete({ where: { id: existing.id } });
    const { status } = existing.game;
    if (
      pass[pass.length - 1]?.id === existing.id &&
      (status === PlayStatus.PLAYING || status === PlayStatus.DROPPED)
    ) {
      await tx.game.update({
        where: { id: existing.gameId },
        data: { playedMinutes: lastLogged(pass.slice(0, -1))?.minutes ?? null },
      });
    }
  });

  revalidatePlaying(existing.gameId);
  return {};
}

/**
 * Finished or Stopped, from Now playing: the same status change as picking
 * Completed or Dropped on the playing card, with the same dates and
 * completion count (settlePlayState). The time played stays on the game
 * either way ("completed in 42 h", "stopped at 12 h"), and the log gets no
 * closing entry: a game has no last minute to close it at, so what was
 * logged is the time it took. Finished always means today.
 */
export async function moveFromPlaying(gameId: string, to: "COMPLETED" | "DROPPED"): Promise<MoveResult> {
  const userId = await requireUserId();
  const id = idSchema.safeParse(gameId);
  if (!id.success) return { error: "Game not found" };
  const target = moveTargetSchema.safeParse(to);
  if (!target.success) return { error: "Invalid input" };

  const game = await prisma.game.findFirst({
    where: { id: id.data, userId },
    select: {
      title: true,
      status: true,
      playedMinutes: true,
      dateStarted: true,
      dateFinished: true,
      _count: { select: { playthroughs: true } },
    },
  });
  if (!game) return { error: "Game not found" };
  if (game.status !== PlayStatus.PLAYING) {
    return { error: "This game isn't in Playing any more." };
  }

  const finishing = target.data === "COMPLETED";
  const next = settlePlayState(
    PlayStatus.PLAYING,
    {
      status: finishing ? PlayStatus.COMPLETED : PlayStatus.DROPPED,
      dateStarted: game.dateStarted,
      dateFinished: finishing ? null : game.dateFinished,
      playedMinutes: game.playedMinutes,
    },
    game._count.playthroughs,
  );

  await prisma.game.update({
    where: { id: id.data },
    data: {
      status: next.status,
      dateStarted: next.dateStarted,
      dateFinished: next.dateFinished,
      timesCompleted: next.timesCompleted,
      playedMinutes: next.playedMinutes,
    },
  });

  revalidatePlaying(id.data);
  const played = next.playedMinutes ? formatPlaytime(next.playedMinutes) : null;
  return {
    ok: true,
    finished: finishing,
    message: finishing
      ? `${game.title} moved to Completed. Finished today${played ? `, in ${played}` : ""}.`
      : `${game.title} moved to Dropped${played ? ` at ${played}` : ""}.`,
    undo: {
      from: target.data,
      finishedAt: finishing ? next.dateFinished!.toISOString() : null,
    },
  };
}

/**
 * Undo Finished or Stopped: back to Playing as it was. Worked out from the
 * game itself, not the client, and only while the game is still where the
 * move put it (for Completed, finished at that same moment). The move
 * changed nothing else, so nothing else needs putting back: the time
 * played and the log are as they were.
 */
export async function undoMoveFromPlaying(
  gameId: string,
  undo: UndoMove,
): Promise<{ error?: string }> {
  const userId = await requireUserId();
  const id = idSchema.safeParse(gameId);
  if (!id.success) return { error: "Game not found" };
  const parsed = undoMoveSchema.safeParse(undo);
  if (!parsed.success) return { error: "Invalid input" };
  const { from, finishedAt } = parsed.data;

  const game = await prisma.game.findFirst({
    where: { id: id.data, userId },
    select: {
      status: true,
      dateFinished: true,
      _count: { select: { playthroughs: true } },
    },
  });
  if (!game) return { error: "Game not found" };
  if (game.status !== PlayStatus[from]) return { error: CHANGED };
  if (from === "COMPLETED" && (!game.dateFinished || game.dateFinished.toISOString() !== finishedAt)) {
    return { error: CHANGED };
  }

  await prisma.game.update({
    where: { id: id.data },
    data: {
      status: PlayStatus.PLAYING,
      dateFinished: from === "COMPLETED" ? null : game.dateFinished,
      timesCompleted: game._count.playthroughs,
    },
  });

  revalidatePlaying(id.data);
  return {};
}
