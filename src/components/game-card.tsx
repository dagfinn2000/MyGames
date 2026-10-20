import type { Game } from "@prisma/client";
import { GameOwnership, PlayStatus } from "@prisma/client";
import {
  ArrowLeftRight,
  Gamepad2,
  Gift,
  HandHeart,
  Heart,
  type LucideIcon,
} from "lucide-react";
import { GameLink } from "@/components/game-link";
import { Badge } from "@/components/ui/badge";
import { Stars } from "@/components/stars";
import {
  OWNERSHIP_BADGE_LABELS,
  OWNERSHIP_LABELS,
  STATUS_BADGE_CLASS,
  STATUS_LABELS,
  formatDate,
  type FormatPrefs,
} from "@/lib/display";
import { bandLabel, coverArt } from "@/lib/cover-art";
import type { LibraryDisplay } from "@/lib/library-view";
import { formatPlaytime, progressFigure, progressPercent } from "@/lib/progress-units";
import { caseBand } from "@/lib/room";
import { cn } from "@/lib/utils";

/** Box art, or a stand-in when the game has none.
 *  Lazy by default — grids request hundreds of covers at once, and the
 *  below-the-fold ones shouldn't compete with the visible page. The detail
 *  page passes `loading="eager"` for its above-the-fold hero cover. */
export function GameCover({
  game,
  className,
  loading = "lazy",
  flightTarget,
}: {
  /** `platform` is required, null when there is none, so a page that
   *  forgets to fetch it fails to compile instead of drawing every case
   *  with the plain band. */
  game: Pick<Game, "title" | "coverUrl" | "platform"> & { developers?: string[] };
  className?: string;
  loading?: "eager" | "lazy";
  /** The game's id, on the game page's own cover: where a cover clicked
   *  elsewhere flies to (lib/cover-flight.ts). */
  flightTarget?: string;
}) {
  return (
    <div
      className={cn("game-cover relative overflow-hidden rounded-md bg-muted", className)}
      data-cover-for={flightTarget}
    >
      {game.coverUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={game.coverUrl}
          alt={`Cover of ${game.title}`}
          loading={loading}
          decoding="async"
          className="h-full w-full object-cover"
        />
      ) : (
        <MissingCover
          title={game.title}
          developer={game.developers?.[0]}
          platform={game.platform}
        />
      )}
    </div>
  );
}

/**
 * A soft wash of a game's cover colours behind the top of its page: the
 * cover itself, stretched across the page width, blurred until only its
 * colours are left, and faded out downwards (globals.css, `.game-backdrop`).
 * A game without a cover image gets its drawn cover's colour instead, unless
 * drawn covers are off. "Behind a game's page: Nothing" in Preferences hides
 * it, through `data-game-backdrop` on <html>.
 */
export function GameBackdrop({ game }: { game: Pick<Game, "title" | "coverUrl"> }) {
  if (game.coverUrl) {
    return (
      <div className="game-backdrop" aria-hidden="true">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={game.coverUrl} alt="" decoding="async" />
      </div>
    );
  }
  const art = coverArt(game.title);
  return (
    <div
      className="game-backdrop"
      data-drawn=""
      aria-hidden="true"
      style={
        {
          "--cover-hue": art.hue,
          "--cover-sat": `${art.saturation}%`,
          "--cover-light": `${art.lightness}%`,
        } as React.CSSProperties
      }
    />
  );
}

/**
 * The stand-in for a game without box art. Both kinds are rendered and CSS
 * shows one, following "Games without a cover" in Preferences
 * (`data-covers` on <html>; see globals.css) — so this stays a plain
 * component that server and client pages can share without passing the
 * setting down.
 *
 * The drawn cover is the front of a game case: across the top the band of
 * its system, in the colour the game room's shelves give it (caseBand in
 * lib/room.ts) with the platform's name on it, and under that an insert
 * with the title and first developer, coloured from the title
 * (lib/cover-art.ts). The plain one is a grey box with a controller.
 */
function MissingCover({
  title,
  developer,
  platform,
}: {
  title: string;
  developer?: string;
  platform: string | null;
}) {
  const art = coverArt(title);
  const label = bandLabel(platform);
  return (
    <>
      <div
        className="drawn-cover"
        data-layout={art.layout}
        data-band={caseBand(platform)}
        style={
          {
            "--cover-hue": art.hue,
            "--cover-sat": `${art.saturation}%`,
            "--cover-light": `${art.lightness}%`,
            "--cover-title": `${art.titleSize}cqi`,
          } as React.CSSProperties
        }
        aria-hidden="true"
      >
        <div className="drawn-cover-band">
          {label && (
            <span
              className="drawn-cover-system"
              style={{ "--band-label": `${label.size}cqi` } as React.CSSProperties}
            >
              {label.text}
            </span>
          )}
        </div>
        <div className="drawn-cover-frame">
          <span className="drawn-cover-title">{title}</span>
          <span className="drawn-cover-rule" />
          {developer && <span className="drawn-cover-developer">{developer}</span>}
        </div>
      </div>
      <div className="plain-cover h-full w-full items-center justify-center">
        <Gamepad2 className="size-10 text-muted-foreground/40" />
      </div>
    </>
  );
}

/** The slice of a Game the library grid actually renders. The games page
 *  fetches exactly this (plus its sort keys) instead of full rows, so large
 *  text fields (description, review, searchText) never reach the client. */
export type GameCardGame = Pick<
  Game,
  | "id"
  | "title"
  | "developers"
  | "platform"
  | "coverUrl"
  | "status"
  | "rating"
  | "playedMinutes"
  | "lengthMinutes"
  | "seriesName"
  | "seriesNumber"
> & {
  /** True when an unreturned loan exists. Passed as a flag rather than the
   *  loan rows so the grid payload stays the card's fields only. */
  lentOut?: boolean;
  /** For the details the View menu can add: an ownership badge, and a list
   *  row's date. */
  ownership?: GameOwnership;
  createdAt?: Date;
  dateFinished?: Date | null;
};

/** Which details a card or row shows (the library's View menu). */
export type CardDetails = Pick<
  LibraryDisplay,
  | "showRating"
  | "showStatus"
  | "showSeries"
  | "showPlatform"
  | "showOwnership"
  | "rowDate"
  | "showLength"
  | "showPlayed"
>;

const ALL_DETAILS: CardDetails = {
  showRating: true,
  showStatus: true,
  showSeries: true,
  showPlatform: true,
  showOwnership: false,
  rowDate: "none",
  showLength: false,
  showPlayed: true,
};

/**
 * The progress bar on a game being played: how far through its usual time
 * to beat (0–100, full once past it), and the figure behind it for the
 * tooltip. Null when nothing is being played, or the time to beat isn't
 * known, since a bar needs an end.
 */
function playProgress(game: GameCardGame): { percent: number; label: string } | null {
  if (game.status !== PlayStatus.PLAYING || game.playedMinutes == null) return null;
  const percent = progressPercent(game.playedMinutes, game.lengthMinutes);
  return percent === null
    ? null
    : { percent, label: progressFigure(game.playedMinutes, game.lengthMinutes) };
}

/** The thin bar under a cover or in a row. */
function ProgressBar({
  progress,
  className,
}: {
  progress: { percent: number; label: string };
  className: string;
}) {
  return (
    <div className={cn("rounded-full bg-muted", className)} title={progress.label}>
      <div
        className="bar-grow h-full rounded-full bg-primary/80"
        style={{ width: `${progress.percent}%` }}
      />
    </div>
  );
}

function LentBadge() {
  return (
    <Badge
      variant="outline"
      className="border-amber-400 text-[10px] text-amber-700 dark:text-amber-300"
      title="Lent out"
    >
      <HandHeart className="size-3" />
      Lent
    </Badge>
  );
}

const OWNERSHIP_ICONS: Record<Exclude<GameOwnership, "OWNED">, LucideIcon> = {
  WISHLIST: Heart,
  BORROWED: ArrowLeftRight,
  GIVEN_AWAY: Gift,
};

/** Wishlist, Borrowed or Given away. Owned is the usual case and gets no
 *  badge, so the ones worth noticing stand out. */
function OwnershipBadge({ ownership }: { ownership: GameOwnership }) {
  if (ownership === GameOwnership.OWNED) return null;
  const Icon = OWNERSHIP_ICONS[ownership];
  return (
    <Badge
      variant="outline"
      className="text-[10px] text-muted-foreground"
      title={OWNERSHIP_LABELS[ownership]}
    >
      <Icon className="size-3" aria-hidden="true" />
      {OWNERSHIP_BADGE_LABELS[ownership]}
    </Badge>
  );
}

function seriesLabel(game: GameCardGame): string {
  return `${game.seriesName}${game.seriesNumber != null ? ` #${game.seriesNumber}` : ""}`;
}

/** The platform when the View menu shows it and the game has one. */
function shownPlatform(game: GameCardGame, details: CardDetails): string | null {
  return details.showPlatform ? game.platform?.trim() || null : null;
}

/** How long you've played a game, when the View menu shows it and there
 *  is a time: "12 h 30 min played". */
function shownPlayed(game: GameCardGame, details: CardDetails): string | null {
  return details.showPlayed && game.playedMinutes ? `${formatPlaytime(game.playedMinutes)} played` : null;
}

/** A list row's extra line: the date added or finished, the time played
 *  and the time to beat, as the View menu asks. Empty when there is
 *  nothing to show (a date finished for a game not finished, say). */
function rowFacts(game: GameCardGame, details: CardDetails, formatPrefs?: FormatPrefs): string {
  const facts: string[] = [];
  if (details.rowDate === "added" && game.createdAt) {
    facts.push(`Added ${formatDate(game.createdAt, formatPrefs)}`);
  }
  if (details.rowDate === "finished" && game.dateFinished) {
    facts.push(`Finished ${formatDate(game.dateFinished, formatPrefs)}`);
  }
  const played = shownPlayed(game, details);
  if (played) facts.push(played);
  if (details.showLength && game.lengthMinutes) {
    facts.push(`About ${formatPlaytime(game.lengthMinutes)} to beat`);
  }
  return facts.join(" · ");
}

/**
 * One line per game for the library's list layout: a small cover, title,
 * developers, platform and series, then rating and badges on the right.
 * For long libraries, where scanning titles beats scanning covers.
 */
export function GameRow({
  game,
  details = ALL_DETAILS,
  formatPrefs,
}: {
  game: GameCardGame;
  details?: CardDetails;
  /** The player's date format, for the date line. Passed in so this file
   *  stays free of hooks: server pages import GameCover from it. */
  formatPrefs?: FormatPrefs;
}) {
  const progress = playProgress(game);
  const facts = rowFacts(game, details, formatPrefs);
  const byline = [game.developers.join(", "), shownPlatform(game, details)]
    .filter(Boolean)
    .join(" · ");
  const series = details.showSeries && game.seriesName ? seriesLabel(game) : null;
  return (
    <GameLink
      gameId={game.id}
      className="surface lift group flex items-center gap-3 rounded-lg border bg-card p-2 shadow-(--surface-shadow) transition-colors hover:border-ring/60"
    >
      <GameCover game={game} className="aspect-[2/3] w-10 shrink-0" />
      <div className="grid min-w-0 flex-1 gap-0.5">
        <p className="truncate font-heading text-sm font-medium group-hover:underline">
          {game.title}
        </p>
        <p className="truncate text-xs text-muted-foreground">
          {byline}
          {series && (
            <span className="italic text-muted-foreground/80">
              {byline && " · "}
              {series}
            </span>
          )}
        </p>
        {facts && <p className="truncate text-xs text-muted-foreground tabular-nums">{facts}</p>}
        {progress && <ProgressBar progress={progress} className="mt-0.5 h-1 max-w-40" />}
      </div>
      <div className="flex shrink-0 flex-wrap items-center justify-end gap-1.5">
        {details.showRating && game.rating ? <Stars value={game.rating} /> : null}
        {details.showOwnership && game.ownership && <OwnershipBadge ownership={game.ownership} />}
        {game.lentOut && <LentBadge />}
        {details.showStatus && (
          <Badge className={`${STATUS_BADGE_CLASS[game.status]} hidden text-[10px] sm:inline-flex`}>
            {STATUS_LABELS[game.status]}
          </Badge>
        )}
      </div>
    </GameLink>
  );
}

/** Grid tile for the library view. */
export function GameCard({
  game,
  details = ALL_DETAILS,
  compact = false,
}: {
  game: GameCardGame;
  details?: CardDetails;
  /** Small covers: tighter padding, no developer or platform line. */
  compact?: boolean;
}) {
  const progress = playProgress(game);
  const platform = shownPlatform(game, details);
  const played = shownPlayed(game, details);

  return (
    <GameLink
      gameId={game.id}
      className={cn(
        "surface lift group flex flex-col rounded-lg border bg-card shadow-(--surface-shadow) transition-colors hover:border-ring/60",
        compact ? "gap-1.5 p-2" : "gap-2 p-3",
      )}
    >
      <GameCover game={game} className="aspect-[2/3] w-full" />
      {progress && <ProgressBar progress={progress} className="-mt-1 h-1.5" />}
      <div className="flex flex-1 flex-col gap-1">
        <p
          className={cn(
            "line-clamp-2 font-heading font-medium leading-snug group-hover:underline",
            compact ? "text-xs" : "text-sm",
          )}
        >
          {game.title}
        </p>
        {!compact && game.developers.length > 0 && (
          <p className="line-clamp-1 text-xs text-muted-foreground">
            {game.developers.join(", ")}
          </p>
        )}
        {!compact && platform && (
          <p className="line-clamp-1 text-xs text-muted-foreground">{platform}</p>
        )}
        {details.showSeries && game.seriesName && (
          <p className="line-clamp-1 text-xs italic text-muted-foreground/80">
            {seriesLabel(game)}
          </p>
        )}
        {played && <p className="line-clamp-1 text-xs text-muted-foreground tabular-nums">{played}</p>}
        {/* flex-wrap: on narrow cards the badge drops below the stars
            instead of overflowing the card. */}
        <div className="mt-auto flex flex-wrap items-center justify-between gap-1 pt-1">
          {details.showRating && game.rating ? <Stars value={game.rating} /> : <span />}
          <span className="flex flex-wrap items-center gap-1">
            {details.showOwnership && game.ownership && (
              <OwnershipBadge ownership={game.ownership} />
            )}
            {game.lentOut && <LentBadge />}
            {details.showStatus && (
              <Badge className={`${STATUS_BADGE_CLASS[game.status]} text-[10px]`}>
                {STATUS_LABELS[game.status]}
              </Badge>
            )}
          </span>
        </div>
      </div>
    </GameLink>
  );
}

/** "Covers only": the cover and title with no frame, details or badges. */
export function GameCoverTile({ game, compact = false }: { game: GameCardGame; compact?: boolean }) {
  const progress = playProgress(game);
  return (
    <GameLink gameId={game.id} className="lift-cover group flex flex-col gap-1.5">
      <GameCover game={game} className="cover-shadow aspect-[2/3] w-full" />
      {progress && <ProgressBar progress={progress} className="h-1" />}
      <p
        className={cn(
          "line-clamp-2 font-heading leading-snug text-muted-foreground group-hover:text-foreground group-hover:underline",
          compact ? "text-[11px]" : "text-xs",
        )}
      >
        {game.title}
      </p>
    </GameLink>
  );
}

/** "Shelf": just the cover, standing on the shelf its slot draws
 *  (globals.css). The title shows on hover and to screen readers. */
export function GameOnShelf({ game }: { game: GameCardGame }) {
  const byline = game.developers.length ? ` by ${game.developers.join(", ")}` : "";
  return (
    <GameLink gameId={game.id} className="lift-cover block" title={`${game.title}${byline}`}>
      <GameCover game={game} className="cover-shadow aspect-[2/3] w-full" />
      <span className="sr-only">{game.title}</span>
    </GameLink>
  );
}
