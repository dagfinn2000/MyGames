"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { undoMoveFromPlaying } from "@/lib/actions/progress";
import { nowPlayingPaceText } from "@/lib/pace";
import { currentPassEntries } from "@/lib/progress";
import { progressFigure, progressPercent } from "@/lib/progress-units";
import type { UndoMove } from "@/lib/play-log";
import { usePreferences } from "@/components/preferences-provider";
import { GameCover } from "@/components/game-card";
import { GameLink } from "@/components/game-link";
import { RecentEntries, type LogGame } from "@/components/progress-log";
import { QuickLog, type MovedResult, type QuickLogGame } from "@/components/quick-log";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

export interface NowPlayingGame extends QuickLogGame, LogGame {
  developers: string[];
  platform: string | null;
  coverUrl: string | null;
  lengthMinutes: number | null;
  progress: { id: string; minutes: number; date: Date }[];
}

interface Moved {
  game: NowPlayingGame;
  message: string;
  undo: UndoMove;
}

/**
 * The rows of the Now playing page, one per game being played, with the
 * quick-log row, Finished and Stopped.
 *
 * Rows keep the order the page first had for this visit: logging time
 * makes a game the most recent, but moving it to the top under the
 * player's finger (and losing their focus) would be worse. A game moved to
 * Completed or Dropped leaves the page's list, so its row stays here in
 * place as a line with Undo until the visit ends.
 */
export function NowPlaying({
  games,
  empty,
}: {
  games: NowPlayingGame[];
  /** Shown when nothing is being played (and nothing was just moved). */
  empty: React.ReactNode;
}) {
  const [order] = useState(() => games.map((g) => g.id));
  const [moved, setMoved] = useState<Map<string, Moved>>(() => new Map());
  const [focusId, setFocusId] = useState<string | null>(null);

  const byId = new Map(games.map((g) => [g.id, g]));
  // Games started since the page loaded (another tab, say) go first.
  const ids = [...games.map((g) => g.id).filter((id) => !order.includes(id)), ...order].filter(
    (id) => byId.has(id) || moved.has(id),
  );
  if (ids.length === 0) return <>{empty}</>;

  // A game in the page's list always shows as a row, so whichever lands
  // first, the move's result or the refreshed list, nothing flickers: the
  // row stays until the list drops the game, and comes back as soon as an
  // undo returns it.
  return (
    <ul className="grid grid-cols-1 gap-3">
      {ids.map((id) => {
        const game = byId.get(id);
        if (game) {
          return (
            <li key={id}>
              <NowPlayingRow
                game={game}
                autoFocus={focusId === id}
                onMoved={(result) =>
                  setMoved((m) =>
                    new Map(m).set(id, { game, message: result.message, undo: result.undo }),
                  )
                }
              />
            </li>
          );
        }
        return (
          <li key={id}>
            <MovedRow moved={moved.get(id)!} onUndone={() => setFocusId(id)} />
          </li>
        );
      })}
    </ul>
  );
}

function NowPlayingRow({
  game,
  autoFocus,
  onMoved,
}: {
  game: NowPlayingGame;
  autoFocus: boolean;
  onMoved: (result: MovedResult) => void;
}) {
  const prefs = usePreferences();
  const pass = currentPassEntries(game.progress, game.dateStarted, prefs.timeZone);
  const pace = nowPlayingPaceText({
    pass,
    lengthMinutes: game.lengthMinutes,
    from: prefs.paceFrom,
    now: new Date(),
    prefs,
  });
  const pct = game.playedMinutes != null ? progressPercent(game.playedMinutes, game.lengthMinutes) : null;
  const byline = [game.developers.join(", "), game.platform].filter(Boolean).join(" · ");

  return (
    <Card size="sm">
      <CardContent className="grid grid-cols-[3.5rem_minmax(0,1fr)] gap-3 sm:grid-cols-[4.5rem_minmax(0,1fr)]">
        <GameLink gameId={game.id} className="lift-cover self-start" title={game.title}>
          <GameCover game={game} className="cover-shadow aspect-[2/3] w-full" />
        </GameLink>
        <div className="grid min-w-0 content-start gap-2">
          <div className="min-w-0">
            <h2 className="truncate font-heading text-base font-medium">
              <Link href={`/games/${game.id}`} className="hover:underline">
                {game.title}
              </Link>
            </h2>
            {byline && <p className="truncate text-sm text-muted-foreground">{byline}</p>}
          </div>
          {pct !== null && (
            <div className="h-2 rounded-full bg-muted">
              <div className="bar-grow h-full rounded-full bg-primary/80" style={{ width: `${pct}%` }} />
            </div>
          )}
          <div className="flex flex-wrap justify-between gap-x-3 gap-y-0.5 text-xs text-muted-foreground tabular-nums sm:text-sm">
            <span>
              {game.playedMinutes != null
                ? progressFigure(game.playedMinutes, game.lengthMinutes)
                : "No time logged yet"}
            </span>
            <span>{pace}</span>
          </div>
          <QuickLog game={game} showMoveButtons onMoved={onMoved} autoFocus={autoFocus} />
          <div className="grid gap-1">
            <RecentEntries entries={game.progress} game={game} />
            {game.progress.length > 0 && (
              <Link
                href={`/games/${game.id}#progress-log`}
                className="justify-self-start text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
              >
                Full log
              </Link>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

/** A game just moved to Completed or Dropped: what happened, and Undo. */
function MovedRow({ moved, onUndone }: { moved: Moved; onUndone: () => void }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const undoRef = useRef<HTMLButtonElement>(null);

  // The button that was pressed is gone with the row; Undo is the obvious
  // next stop for focus.
  useEffect(() => {
    undoRef.current?.focus();
  }, []);

  return (
    <div
      role="status"
      className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl px-3 py-3 text-sm text-muted-foreground ring-1 ring-foreground/10"
    >
      <span className="min-w-0">{moved.message}</span>
      <Button
        ref={undoRef}
        type="button"
        variant="ghost"
        size="sm"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            const result = await undoMoveFromPlaying(moved.game.id, moved.undo);
            if (result.error) setError(result.error);
            else onUndone();
          })
        }
      >
        {pending ? "Undoing…" : "Undo"}
      </Button>
      {error && <span className="w-full text-destructive">{error}</span>}
    </div>
  );
}
