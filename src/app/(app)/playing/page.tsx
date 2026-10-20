import Link from "next/link";
import { redirect } from "next/navigation";
import { PlayStatus } from "@prisma/client";
import { Gamepad2 } from "lucide-react";
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
export const metadata = { title: "Now playing · MyGames" };

const UP_NEXT = 10;

/**
 * Every game being played on one page, each with the quick-log row, so
 * logging an evening's play doesn't mean opening each game. Under them,
 * the Want to Play games that are up next.
 */
export default async function NowPlayingPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login"); // revoked session (see auth.ts)
  const userId = session.user.id;
  const prefs = await getPreferences();

  const [playing, wantToPlay, seriesGames] = await Promise.all([
    prisma.game.findMany({
      where: { userId, status: PlayStatus.PLAYING },
      select: {
        id: true,
        title: true,
        developers: true,
        platform: true,
        coverUrl: true,
        status: true,
        lengthMinutes: true,
        playedMinutes: true,
        dateStarted: true,
        // Oldest first, minutes breaking same-instant ties (the anchor first).
        progress: {
          orderBy: [{ date: "asc" }, { minutes: "asc" }],
          select: { id: true, minutes: true, date: true },
        },
      },
    }),
    prisma.game.findMany({
      where: { userId, status: PlayStatus.WANT_TO_PLAY },
      select: {
        id: true,
        title: true,
        developers: true,
        // For a drawn cover's band.
        platform: true,
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

  // The game played most recently first: its newest log entry, or when it
  // was started.
  const lastTouched = (g: (typeof playing)[number]) =>
    (g.progress[g.progress.length - 1]?.date ?? g.dateStarted)?.getTime() ?? 0;
  playing.sort((a, b) => lastTouched(b) - lastTouched(a) || a.title.localeCompare(b.title));

  const next = upNext(wantToPlay, seriesGames, UP_NEXT);

  return (
    <div className="grid gap-6">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Now playing</h1>
        <span className="text-sm text-muted-foreground">{formatWeekdayDay(new Date(), prefs)}</span>
      </div>

      <NowPlaying
        games={playing}
        empty={
          <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed px-4 py-12 text-center">
            <Gamepad2 className="size-10 text-muted-foreground/40" />
            <p className="text-muted-foreground">You&apos;re not playing anything right now.</p>
            {next.length > 0 ? (
              <p className="text-sm text-muted-foreground">
                Pick one from Up next below and set it to Playing on its page.
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
              All Want to Play
            </Link>
          </div>
          {/* Scrolls inside its own box on a phone, never the page. */}
          <ul className="relative flex gap-3 overflow-x-auto pb-1">
            {next.map((g) => (
              <li key={g.id} className="shrink-0">
                <GameLink gameId={g.id} className="lift-cover block w-16 sm:w-20" title={g.title}>
                  <GameCover game={g} className="cover-shadow aspect-[2/3] w-full" />
                  {/* A cover this small has no room for its own title. */}
                  <span aria-hidden="true" className="mt-1.5 line-clamp-2 text-[11px] leading-tight text-muted-foreground">
                    {g.title}
                  </span>
                  {/* A cover image is named by its alt text; a drawn one isn't. */}
                  {!g.coverUrl && <span className="sr-only">{g.title}</span>}
                </GameLink>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
