import { Fragment } from "react";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { PlayStatus } from "@prisma/client";
import { ExternalLink, Library, Pencil, Repeat } from "lucide-react";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { getPreferences } from "@/lib/current-user";
import { arrangeGameCards, FORCED_CARD_NOTES } from "@/lib/game-page";
import { orderByIds } from "@/lib/library-order";
import type { GamePageCard } from "@/lib/preferences";
import {
  formatDate,
  FORMAT_LABELS,
  OWNERSHIP_BADGE_LABELS,
  STATUS_BADGE_CLASS,
  STATUS_LABELS,
} from "@/lib/display";
import { catalogueLink } from "@/lib/metadata/links";
import { aboutLength, formatPlaytime } from "@/lib/progress-units";
import { DeveloperLinks } from "@/components/developer-links";
import { GameBackdrop, GameCover } from "@/components/game-card";
import { GameDescription } from "@/components/game-description";
import { GameLink } from "@/components/game-link";
import { GameShelvesCard } from "@/components/game-shelves-card";
import { CloseGameButton } from "@/components/close-game-button";
import { DeleteGameButton } from "@/components/delete-game-button";
import { FindItAt } from "@/components/find-it-at";
import { LendingCard } from "@/components/lending-card";
import { showsLendingCard } from "@/lib/loans";
import { PlaythroughHistoryCard } from "@/components/playthrough-history-card";
import { PlayingCard } from "@/components/playing-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

export const dynamic = "force-dynamic";

export default async function GameDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login"); // revoked session (see auth.ts)
  const { id } = await params;
  const userId = session.user.id;
  const prefs = await getPreferences();

  // Kicked off before the game fetch so the two round-trips overlap. The
  // no-op catch keeps a 404'd render (which never awaits this) from turning
  // a failed shelf query into an unhandled rejection; the Promise.all below
  // still sees the original promise and surfaces the error normally.
  const shelvesPromise = prisma.shelf.findMany({
    where: { userId },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });
  shelvesPromise.catch(() => {});

  const game = await prisma.game.findFirst({
    where: { id, userId },
    // Search's folded copies of title, developers, platform, series and
    // review: the playing card is a client component and would carry them
    // to the page.
    omit: { searchText: true, reviewSearchText: true },
    include: {
      shelves: { select: { id: true } },
      // Oldest playthrough first; undated ones are presumed oldest.
      playthroughs: {
        orderBy: [
          { dateFinished: { sort: "asc", nulls: "first" } },
          { createdAt: "asc" },
        ],
      },
      // The automatic play log, oldest first (minutes break same-instant
      // ties — a playthrough's 0-minute anchor sorts before its first real
      // entry).
      progress: {
        orderBy: [{ date: "asc" }, { minutes: "asc" }],
      },
      // Newest first: the open loan (if any) leads, history follows.
      loans: { orderBy: { lentAt: "desc" } },
    },
  });
  if (!game) notFound();

  // Sidebar data: every shelf (for the assignment card) and, if this game is
  // part of a series, its siblings ordered by series number.
  const [allShelves, seriesGames] = await Promise.all([
    shelvesPromise,
    game.seriesName
      ? prisma.game.findMany({
          where: {
            userId,
            seriesName: { equals: game.seriesName, mode: "insensitive" },
            id: { not: game.id },
          },
          // Just what the cover strip renders — not the full rows. The
          // platform picks a drawn cover's band.
          select: { id: true, title: true, coverUrl: true, platform: true, seriesNumber: true },
          orderBy: { seriesNumber: "asc" },
        })
      : Promise.resolve([]),
  ]);

  const catalogue = catalogueLink(game.catalogueId);
  // "2017-03-03" and "2017-03" show as their year; catalogues rarely agree
  // on more than that anyway.
  const releaseYear = game.releaseDate?.match(/^\d{4}/)?.[0] ?? game.releaseDate;
  const finishedLabel =
    game.status === PlayStatus.DROPPED
      ? "Dropped"
      : game.status === PlayStatus.COMPLETED
        ? "Completed"
        : "Finished";

  const seriesHref = game.seriesName
    ? `/games?series=${encodeURIComponent(game.seriesName)}&group=series`
    : null;

  // The cards below the details, in the player's order (Preferences > Game
  // page). A hidden card still shows when it holds something written down
  // nowhere else on the page, with a line saying why.
  const cards: Record<GamePageCard, React.ReactNode> = {
    shelves: (
      <GameShelvesCard
        gameId={game.id}
        // In the player's own order, as the library's shelf chips are.
        shelves={orderByIds(allShelves, prefs.shelfOrder)}
        memberIds={game.shelves.map((s) => s.id)}
      />
    ),
    playing: <PlayingCard game={game} progress={game.progress} />,
    history: <PlaythroughHistoryCard game={game} playthroughs={game.playthroughs} />,
    // A wishlist, digital or subscription game with no loan history has
    // nothing to show.
    lending: showsLendingCard(game.ownership, game.format, game.loans.length) ? (
      <LendingCard
        gameId={game.id}
        ownership={game.ownership}
        format={game.format}
        loans={game.loans}
      />
    ) : null,
  };
  const arranged = arrangeGameCards(prefs, {
    playing: game.status === PlayStatus.PLAYING || !!game.review?.trim(),
    history: game.playthroughs.length > 0,
    lending: game.loans.some((l) => l.returnedAt === null),
  });

  return (
    <>
      {/* Outside the positioned page below, so the wash still runs the
          full width of the window. */}
      <GameBackdrop game={game} />
      {/* Both column definitions clamp their track minimums to 0 — with the
          default (auto) minimum, one unbreakable token in the description
          (a store URL, say) would stretch the whole page past the
          viewport. */}
      <div className="game-page relative grid grid-cols-1 gap-6 md:grid-cols-[240px_minmax(0,1fr)]">
        <CloseGameButton gameId={game.id} />
        <div className="grid content-start gap-3">
          <GameCover
            game={game}
            className="hero-cover aspect-[2/3] w-full max-w-60"
            loading="eager"
            flightTarget={game.id}
          />
          <div className="flex gap-2">
            <Button asChild variant="outline" size="sm">
              <Link href={`/games/${game.id}/edit`}>
                <Pencil data-slot="icon" />
                Edit
              </Link>
            </Button>
            <DeleteGameButton gameId={game.id} title={game.title} />
          </div>
        </div>

        <div className="grid grid-cols-1 content-start gap-4">
          {/* A title, developer or series with no spaces to break at wraps
              anywhere, instead of pushing the page sideways. */}
          <div className="game-title wrap-anywhere">
            <h1 className="text-3xl leading-tight font-semibold tracking-tight text-balance sm:text-4xl">
              {game.title}
            </h1>
            {game.developers.length > 0 && (
              <p className="mt-1.5 text-lg text-muted-foreground">
                <DeveloperLinks developers={game.developers} />
              </p>
            )}
            {game.seriesName && seriesHref && (
              <Link
                href={seriesHref}
                className="mt-1 inline-flex items-center gap-1.5 text-sm italic text-muted-foreground hover:text-foreground hover:underline"
              >
                <Library className="size-3.5" />
                {game.seriesName}
                {game.seriesNumber != null ? ` #${game.seriesNumber}` : ""}
              </Link>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Badge className={STATUS_BADGE_CLASS[game.status]}>
              {STATUS_LABELS[game.status]}
            </Badge>
            <Badge variant="secondary">{FORMAT_LABELS[game.format]}</Badge>
            <Badge variant="outline">
              {OWNERSHIP_BADGE_LABELS[game.ownership]}
            </Badge>
            {game.timesCompleted > 1 && (
              <Badge variant="outline">
                <Repeat data-slot="icon" className="size-3" />
                Completed {game.timesCompleted}×
              </Badge>
            )}
            {game.tags.map((tag) =>
              // The tag filter lists tags comma-separated, so an old tag with
              // a comma in it can't be linked to.
              tag.includes(",") ? (
                <Badge key={tag} variant="secondary">
                  {tag}
                </Badge>
              ) : (
                <Link key={tag} href={`/games?tag=${encodeURIComponent(tag)}`}>
                  <Badge variant="secondary" className="hover:bg-accent">
                    {tag}
                  </Badge>
                </Link>
              ),
            )}
          </div>

          {/* Each fact sits after a hairline, with its label in small
              capitals above the value (globals.css, `.game-facts`). */}
          <dl className="game-facts grid grid-cols-2 gap-x-6 gap-y-3 text-sm sm:grid-cols-4">
            {game.platform && (
              <div>
                <dt className="text-muted-foreground">Platform</dt>
                {/* Its other games on the same system, like the developer
                    and tag links above. */}
                <dd className="wrap-anywhere">
                  <Link
                    href={`/games?platform=${encodeURIComponent(game.platform)}`}
                    className="hover:underline"
                  >
                    {game.platform}
                  </Link>
                </dd>
              </div>
            )}
            {game.publisher && (
              <div>
                <dt className="text-muted-foreground">Publisher</dt>
                <dd className="wrap-anywhere">{game.publisher}</dd>
              </div>
            )}
            {releaseYear && (
              <div>
                <dt className="text-muted-foreground">Released</dt>
                <dd>{releaseYear}</dd>
              </div>
            )}
            {game.lengthMinutes != null && (
              <div>
                <dt className="text-muted-foreground">Time to beat</dt>
                <dd>{aboutLength(game.lengthMinutes)}</dd>
              </div>
            )}
            {game.dateFinished && (
              <div>
                <dt className="text-muted-foreground">{finishedLabel}</dt>
                <dd>{formatDate(game.dateFinished, prefs)}</dd>
              </div>
            )}
            {/* The time the playthrough took, or where it stopped. */}
            {game.playedMinutes != null && game.status === PlayStatus.COMPLETED && (
              <div>
                <dt className="text-muted-foreground">Completed in</dt>
                <dd>{formatPlaytime(game.playedMinutes)}</dd>
              </div>
            )}
            {game.playedMinutes != null && game.status === PlayStatus.DROPPED && (
              <div>
                <dt className="text-muted-foreground">Stopped at</dt>
                <dd>{formatPlaytime(game.playedMinutes)}</dd>
              </div>
            )}
            {catalogue && (
              <div>
                <dt className="text-muted-foreground">More on</dt>
                <dd>
                  <a
                    href={catalogue.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 rounded-sm underline-offset-4 outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
                  >
                    {catalogue.label}
                    <ExternalLink aria-hidden="true" className="size-3.5 shrink-0" />
                    <span className="sr-only"> (opens in a new tab)</span>
                  </a>
                </dd>
              </div>
            )}
          </dl>

          <FindItAt game={game} links={prefs.findLinks} />

          {game.description &&
            (prefs.gameDescription === "clamp" ? (
              <GameDescription text={game.description} />
            ) : (
              // break-words: imported descriptions can contain long raw URLs,
              // which would otherwise refuse to wrap and overflow on phones.
              <p className="long-text max-w-prose whitespace-pre-line break-words text-sm leading-relaxed text-muted-foreground">
                {game.description}
              </p>
            ))}

          {seriesGames.length > 0 && seriesHref && (
            <section className="grid gap-2">
              <h2 className="text-sm font-medium text-muted-foreground">
                More in{" "}
                <Link href={seriesHref} className="italic hover:underline">
                  {game.seriesName}
                </Link>
              </h2>
              {/* One row that scrolls, so a long series doesn't push the rest down. */}
              <div className="flex gap-3 overflow-x-auto pb-1">
                {seriesGames.map((g) => (
                  <GameLink
                    key={g.id}
                    gameId={g.id}
                    className="group w-20 shrink-0"
                    title={`${g.title}${g.seriesNumber != null ? ` (#${g.seriesNumber})` : ""}`}
                  >
                    <GameCover game={g} className="aspect-[2/3] w-20" />
                    <p className="mt-1 line-clamp-2 text-xs leading-tight text-muted-foreground group-hover:text-foreground">
                      {g.seriesNumber != null ? `#${g.seriesNumber} · ` : ""}
                      {g.title}
                    </p>
                  </GameLink>
                ))}
              </div>
            </section>
          )}

          {arranged.map(({ key, forced }) =>
            // A card left out here (null) gets no "shown although hidden" line.
            forced && cards[key] ? (
              <div key={key} className="grid grid-cols-1 gap-1.5">
                {cards[key]}
                <p className="text-xs text-amber-700 dark:text-amber-400">
                  {FORCED_CARD_NOTES[key]}{" "}
                  <Link
                    href="/account#game-page"
                    className="font-medium underline underline-offset-4 hover:text-foreground"
                  >
                    Game page settings
                  </Link>
                </p>
              </div>
            ) : (
              <Fragment key={key}>{cards[key]}</Fragment>
            ),
          )}
        </div>
      </div>
    </>
  );
}
