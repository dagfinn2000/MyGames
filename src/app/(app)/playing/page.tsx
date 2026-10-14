import Link from "next/link";
import { redirect } from "next/navigation";
import { PlayStatus } from "@prisma/client";
import { BookOpenText } from "lucide-react";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { getPreferences } from "@/lib/current-user";
import { formatWeekdayDay } from "@/lib/display";
import { upNext } from "@/lib/up-next";
import { GameCover } from "@/components/game-card";
import { GameLink } from "@/components/game-link";
import { NowPlaying } from "@/components/now-playing";
import { Button } from "@/components/ui/button";

export const dynamic = "force-dynamic";
export const metadata = { title: "Now reading · MyGames" };

const UP_NEXT = 10;

/**
 * Every game being read on one page, each with the quick-log row, so
 * telling the app where you are doesn't mean opening each game. Under them,
 * the Want to Read games that are up next.
 */
export default async function NowPlayingPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login"); // revoked session (see auth.ts)
  const userId = session.user.id;
  const prefs = await getPreferences();

  const [reading, wantToPlay, seriesGames] = await Promise.all([
    prisma.game.findMany({
      where: { userId, status: PlayStatus.PLAYING },
      select: {
        id: true,
        title: true,
        authors: true,
        coverUrl: true,
        status: true,
        format: true,
        pageCount: true,
        lengthMinutes: true,
        currentPage: true,
        dateStarted: true,
        // Oldest first, page breaking same-instant ties (the anchor first).
        progress: {
          orderBy: [{ date: "asc" }, { page: "asc" }],
          select: { id: true, page: true, date: true },
        },
      },
    }),
    prisma.game.findMany({
      where: { userId, status: PlayStatus.WANT_TO_PLAY },
      select: {
        id: true,
        title: true,
        authors: true,
        coverUrl: true,
        status: true,
        timesCompleted: true,
        seriesName: true,
        seriesNumber: true,
      },
      orderBy: [{ createdAt: "desc" }, { id: "asc" }],
    }),
    // For "next in the series": every game that has a series.
    prisma.game.findMany({
      where: { userId, seriesName: { not: null } },
      select: { seriesName: true, seriesNumber: true, status: true, timesCompleted: true },
    }),
  ]);

  // The game read most recently first: its newest log entry, or when it
  // was started.
  const lastTouched = (b: (typeof reading)[number]) =>
    (b.progress[b.progress.length - 1]?.date ?? b.dateStarted)?.getTime() ?? 0;
  reading.sort((a, b) => lastTouched(b) - lastTouched(a) || a.title.localeCompare(b.title));

  const next = upNext(wantToPlay, seriesGames, UP_NEXT);

  return (
    <div className="grid gap-6">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Now reading</h1>
        <span className="text-sm text-muted-foreground">{formatWeekdayDay(new Date(), prefs)}</span>
      </div>

      <NowPlaying
        games={reading}
        empty={
          <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed px-4 py-12 text-center">
            <BookOpenText className="size-10 text-muted-foreground/40" />
            <p className="text-muted-foreground">You&apos;re not reading anything right now.</p>
            {next.length > 0 ? (
              <p className="text-sm text-muted-foreground">
                Pick one from Up next below and set it to Currently Reading on its page.
              </p>
            ) : (
              <Button asChild size="sm">
                <Link href="/games/new">Add a game</Link>
              </Button>
            )}
          </div>
        }
      />

      {next.length > 0 && (
        <section className="grid min-w-0 gap-2">
          <div className="flex flex-wrap items-baseline justify-between gap-x-3">
            <h2 className="text-sm font-medium text-muted-foreground">Up next</h2>
            <Link
              href="/games?shelf=WANT_TO_PLAY"
              className="text-sm text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
            >
              All Want to Read
            </Link>
          </div>
          {/* Scrolls inside its own box on a phone, never the page. */}
          <ul className="relative flex gap-3 overflow-x-auto pb-1">
            {next.map((b) => (
              <li key={b.id} className="shrink-0">
                <GameLink gameId={b.id} className="lift-cover block w-16 sm:w-20" title={b.title}>
                  <GameCover game={b} className="cover-shadow aspect-[2/3] w-full" />
                  {/* A cover this small has no room for its own title. */}
                  <span aria-hidden="true" className="mt-1.5 line-clamp-2 text-[11px] leading-tight text-muted-foreground">
                    {b.title}
                  </span>
                  {/* A cover image is named by its alt text; a drawn one isn't. */}
                  {!b.coverUrl && <span className="sr-only">{b.title}</span>}
                </GameLink>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
