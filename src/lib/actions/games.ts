"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { Prisma } from "@prisma/client";
import { PlayStatus } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { gameSchema, playSchema } from "@/lib/validation";
import { deleteCachedCover } from "@/lib/covers";
import { localizeCoverAfterResponse } from "@/lib/cover-localize";
import { getPreferences } from "@/lib/current-user";
import { requireUserId } from "@/lib/actions/helpers";
import type { ActionState } from "@/lib/actions/helpers";
import { calendarDay, dayKey, zonedDayStart } from "@/lib/dates";
import { currentPassEntries } from "@/lib/progress";
import { anchorMoment } from "@/lib/play-log";
import { settlePlayState } from "@/lib/play-state";
import { buildSearchText, foldForSearch } from "@/lib/utils";
import { AFTER_ADD } from "@/lib/preferences";

const statusField = z.nativeEnum(PlayStatus).catch(PlayStatus.WANT_TO_PLAY);

/** Create a game from the add form (typed in, or filled from a catalogue). */
export async function createGame(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const userId = await requireUserId();

  const fields = Object.fromEntries(formData);
  const parsed = gameSchema.safeParse(fields);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  // Each status's own fields: Finished, Don't remember and Rating for
  // Completed; Started and time played for Playing; time played for
  // Dropped. Same checks as the playing card (no dates in the future, none
  // backwards, a time that reads as a time).
  const status = statusField.parse(formData.get("status"));
  const playParsed = playSchema.safeParse({ ...fields, status });
  if (!playParsed.success) {
    return { error: playParsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const r = playParsed.data;
  const prefs = await getPreferences();
  // Which submit button was pressed; a form without one follows Preferences.
  const afterAdd = z.enum(AFTER_ADD).catch(prefs.afterAdd).parse(formData.get("afterAdd"));

  // Adding a game straight onto Completed or Playing gets the same dates
  // and completion count as moving it there from the playing card. Without
  // a date, Completed means today unless the player said they don't
  // remember (or chose undated finishes in Preferences).
  const now = new Date();
  const play = settlePlayState(
    null,
    {
      status,
      dateStarted: status === PlayStatus.PLAYING ? (r.dateStarted ?? null) : null,
      dateFinished:
        status === PlayStatus.COMPLETED && !r.finishedUnknown ? (r.dateFinished ?? null) : null,
      playedMinutes: r.playedMinutes ?? null,
    },
    0,
    now,
    { undatedFinish: r.finishedUnknown || prefs.addedAsCompletedFinished === "undated" },
  );

  const data = parsed.data;
  const startKey = play.dateStarted ? calendarDay(play.dateStarted, prefs.timeZone) : null;
  const game = await prisma.game.create({
    data: {
      userId,
      title: data.title,
      developers: data.developers,
      publisher: data.publisher ?? null,
      platform: data.platform ?? null,
      description: data.description ?? null,
      coverUrl: data.coverUrl ?? null,
      lengthMinutes: data.lengthMinutes ?? null,
      releaseDate: data.releaseDate ?? null,
      tags: data.tags,
      seriesName: data.seriesName ?? null,
      seriesNumber: data.seriesNumber ?? null,
      format: data.format,
      ownership: data.ownership,
      catalogueId: data.catalogueId ?? null,
      status: play.status,
      rating: r.rating || null, // 0 = unrated
      dateStarted: play.dateStarted,
      dateFinished: play.dateFinished,
      timesCompleted: play.timesCompleted,
      playedMinutes: play.playedMinutes,
      searchText: buildSearchText(data.title, data.developers, data.seriesName, data.platform),
      // A game added part-way through starts its log at the time given: one
      // entry and no 0-minute anchor before it, so no day is credited with
      // the hours played before the game was added (see logProgress). Dated
      // now, not at the Started date: typed today, that is midnight UTC,
      // which east of UTC is still to come, and the day's next log would
      // sort before it. The pass goes by Started's calendar day, so the
      // entry is still part of the playthrough; only a start on a later day
      // (the date field allows a day's slack) moves it to the start of that
      // day.
      ...(play.playedMinutes && {
        progress: {
          create: {
            minutes: play.playedMinutes,
            date:
              startKey && dayKey(now, prefs.timeZone) < startKey
                ? zonedDayStart(startKey, prefs.timeZone)
                : now,
          },
        },
      }),
    },
  });

  localizeCoverAfterResponse(game.id, game.coverUrl);

  revalidatePath("/games");
  revalidatePath("/stats");
  if (afterAdd === "another") {
    return { success: true, added: { id: game.id, title: game.title } };
  }
  redirect(afterAdd === "library" ? "/games" : `/games/${game.id}`);
}

/** Update a game's own details (everything but play data) from the edit
 *  form. */
export async function updateGame(
  gameId: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const userId = await requireUserId();

  const existing = await prisma.game.findFirst({
    where: { id: gameId, userId },
    select: { coverUrl: true },
  });
  if (!existing) return { error: "Game not found" };

  const parsed = gameSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const data = parsed.data;
  const newCover = data.coverUrl ?? null;

  await prisma.game.update({
    where: { id: gameId },
    data: {
      title: data.title,
      developers: data.developers,
      publisher: data.publisher ?? null,
      platform: data.platform ?? null,
      description: data.description ?? null,
      coverUrl: newCover,
      lengthMinutes: data.lengthMinutes ?? null,
      releaseDate: data.releaseDate ?? null,
      tags: data.tags,
      seriesName: data.seriesName ?? null,
      seriesNumber: data.seriesNumber ?? null,
      format: data.format,
      ownership: data.ownership,
      // Every field of the schema is saved: the form sends the catalogue id
      // back on every save, so "Look up details" and the catalogue link
      // keep finding the same game.
      catalogueId: data.catalogueId ?? null,
      searchText: buildSearchText(data.title, data.developers, data.seriesName, data.platform),
    },
  });

  // Only after the update lands: clean up the replaced cached file (doing
  // it earlier would leave the row pointing at a deleted image if the
  // update failed) and pull a new remote cover into the cache.
  if (existing.coverUrl !== newCover) {
    await deleteCachedCover(existing.coverUrl);
    localizeCoverAfterResponse(gameId, newCover);
  }

  revalidatePath("/games");
  revalidatePath(`/games/${gameId}`);
  redirect(`/games/${gameId}`);
}

/** Update personal play data (status, rating, review, dates, time played). */
export async function updatePlay(
  gameId: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const userId = await requireUserId();

  const existing = await prisma.game.findFirst({
    where: { id: gameId, userId },
    select: {
      status: true,
      playedMinutes: true,
      dateStarted: true,
      _count: { select: { playthroughs: true } },
    },
  });
  if (!existing) return { error: "Game not found" };

  const parsed = playSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const data = parsed.data;
  const prefs = await getPreferences();

  // Fills in "finished today" / "started today" when the dates were left
  // empty, derives timesCompleted, and drops the time played once the game
  // is back on Want to Play. Shared with createGame and bulk edit.
  const { dateStarted, dateFinished, timesCompleted, playedMinutes } = settlePlayState(
    existing.status,
    {
      status: data.status,
      dateStarted: data.dateStarted ?? null,
      dateFinished: data.finishedUnknown ? null : (data.dateFinished ?? null),
      // A game being played logs its time through the quick row; the card
      // has no time box then, and sends back the time it was rendered with,
      // which a log since (in another tab, say) has left behind. A form
      // with no time field at all leaves the time as it is too, so saving a
      // rating can't wipe how long a completed game took.
      playedMinutes:
        existing.status === PlayStatus.PLAYING || data.playedMinutes === undefined
          ? existing.playedMinutes
          : data.playedMinutes,
    },
    existing._count.playthroughs,
    new Date(),
    { undatedFinish: data.finishedUnknown },
  );

  // The game update and its automatic play-log entries land together — a
  // 0-minute anchor without the time change it anchors (or vice versa)
  // would corrupt the pass bookkeeping.
  await prisma.$transaction(async (tx) => {
    await tx.game.update({
      where: { id: gameId },
      data: {
        status: data.status,
        rating: data.rating || null, // 0 = cleared
        review: data.review ?? null,
        reviewSearchText: foldForSearch(data.review ?? ""),
        dateStarted,
        dateFinished,
        timesCompleted,
        playedMinutes,
      },
    });

    await logProgress(
      tx,
      gameId,
      existing,
      { status: data.status, playedMinutes, dateStarted },
      prefs.timeZone,
    );
  });

  revalidatePath("/games");
  revalidatePath(`/games/${gameId}`);
  revalidatePath("/stats");
  return {
    success: true,
    finished: existing.status !== PlayStatus.COMPLETED && data.status === PlayStatus.COMPLETED,
  };
}

/**
 * The automatic play log: every change to `playedMinutes` becomes a dated
 * ProgressEntry. Consumers (sparkline, pace, heatmap, hours played) count
 * time as the delta between *consecutive* entries, so the first entry of a
 * playthrough is preceded by a 0-minute anchor at the pass start — "2 h"
 * logged into a fresh game credits 2 hours, while a lone entry with no
 * predecessor (like a game added part-way through) credits none. Replays
 * get their anchor from playAgain (see lib/actions/playthroughs.ts).
 *
 * Completing a game writes nothing extra: there is no last minute to close
 * the log at. The time played when it was completed is whatever was
 * logged, and it stays on the game ("Completed in 42 h").
 */
async function logProgress(
  db: Prisma.TransactionClient,
  gameId: string,
  prev: {
    status: PlayStatus;
    playedMinutes: number | null;
    dateStarted: Date | null;
  },
  next: {
    status: PlayStatus;
    playedMinutes: number | null;
    dateStarted: Date | null;
  },
  /** The player's zone. */
  timeZone: string,
): Promise<void> {
  const now = new Date();

  // The latest entry of the current pass. A personal log is small, so
  // fetching it whole and slicing beats encoding the pass rule in SQL.
  const all = await db.progressEntry.findMany({
    where: { gameId },
    orderBy: [{ date: "asc" }, { minutes: "asc" }],
    select: { id: true, minutes: true, date: true },
  });
  const pass = currentPassEntries(all, next.dateStarted, timeZone);
  const last = pass[pass.length - 1] ?? null;

  // Started moved earlier on a game being played: its anchor moves back
  // too, or the days in between would still be refused as before the
  // playthrough started. Never onto or over the playthrough before it.
  const anchor = pass[0]?.minutes === 0 ? pass[0] : null;
  if (
    anchor &&
    next.status === PlayStatus.PLAYING &&
    prev.status === PlayStatus.PLAYING &&
    next.dateStarted &&
    next.dateStarted.getTime() !== prev.dateStarted?.getTime() &&
    next.dateStarted < anchor.date
  ) {
    const before = all[all.indexOf(anchor) - 1];
    const floor = before ? before.date.getTime() + 1 : -Infinity;
    const date = new Date(Math.max(next.dateStarted.getTime(), floor));
    if (date < anchor.date) {
      await db.progressEntry.update({ where: { id: anchor.id }, data: { date } });
    }
  }

  if (next.playedMinutes != null && next.playedMinutes !== prev.playedMinutes) {
    const entries: { gameId: string; minutes: number; date: Date }[] = [];
    if (!last) {
      entries.push({ gameId, minutes: 0, date: anchorMoment(next.dateStarted, now) });
    }
    entries.push({ gameId, minutes: next.playedMinutes, date: now });
    await db.progressEntry.createMany({ data: entries });
  }
}

/** Delete a game and its cached cover image. */
export async function deleteGame(gameId: string): Promise<void> {
  const userId = await requireUserId();

  const existing = await prisma.game.findFirst({
    where: { id: gameId, userId },
    select: { coverUrl: true },
  });
  if (!existing) return;

  await prisma.game.delete({ where: { id: gameId } });
  await deleteCachedCover(existing.coverUrl);

  revalidatePath("/games");
  redirect("/games");
}
