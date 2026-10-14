"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Pencil } from "lucide-react";
import { formatDate } from "@/lib/display";
import { GameCover } from "@/components/game-card";
import { usePreferences } from "@/components/preferences-provider";
import { DeleteQuoteButton, QuoteForm } from "@/components/quotes-card";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

export interface QuoteItemQuote {
  id: string;
  text: string;
  speaker: string | null;
  note: string | null;
  createdAt: Date;
  game: {
    id: string;
    title: string;
    developers: string[];
    platform: string | null;
    coverUrl: string | null;
  };
}

/**
 * One quote on the quotes page, with the same pencil and trash as the game
 * page: the line, who says it, your note, then the game it's from. Under a
 * game heading (`showGame` off) the game line gives way to the date it was
 * added.
 */
export function QuoteItem({ quote, showGame }: { quote: QuoteItemQuote; showGame: boolean }) {
  const prefs = usePreferences();
  const [editing, setEditing] = useState(false);
  const editRef = useRef<HTMLButtonElement>(null);
  const wasEditing = useRef(false);
  const close = useCallback(() => setEditing(false), []);

  // Back to the pencil once the edit closes, saved or cancelled.
  useEffect(() => {
    if (editing) {
      wasEditing.current = true;
    } else if (wasEditing.current) {
      wasEditing.current = false;
      editRef.current?.focus();
    }
  }, [editing]);

  const added = `added ${formatDate(quote.createdAt, prefs)}`;
  // "Team Cherry · PC · added 3 Oct 2026": the platform tells apart two
  // copies of one game.
  const gameLine = [quote.game.developers.join(", "), quote.game.platform, added]
    .filter(Boolean)
    .join(" · ");

  return (
    <Card>
      {/* grid-cols-1 here too: the card's inner track must also clamp, or
          the truncate on the game line never engages. */}
      <CardContent className="grid grid-cols-1 gap-3 pt-0">
        {editing ? (
          <QuoteForm quote={quote} onDone={close} />
        ) : (
          <>
            <blockquote className="long-text whitespace-pre-line break-words border-l-2 border-primary/50 pl-3 text-sm leading-relaxed">
              {quote.text}
            </blockquote>
            {quote.speaker && (
              <p className="break-words pl-3 text-sm text-muted-foreground">— {quote.speaker}</p>
            )}
            {quote.note && (
              <p className="long-text break-words text-sm italic text-muted-foreground">
                {quote.note}
              </p>
            )}
            <div className="flex min-w-0 items-center gap-2">
              {showGame ? (
                <Link
                  href={`/games/${quote.game.id}`}
                  className="group flex min-w-0 flex-1 items-center gap-2.5 text-sm"
                >
                  <GameCover game={quote.game} className="aspect-[2/3] w-7 shrink-0" />
                  <span className="min-w-0">
                    <span className="block truncate font-medium group-hover:underline">
                      {quote.game.title}
                    </span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {gameLine}
                    </span>
                  </span>
                </Link>
              ) : (
                <p className="min-w-0 flex-1 truncate text-xs text-muted-foreground tabular-nums">
                  {added}
                </p>
              )}
              <span className="flex shrink-0 items-center gap-1">
                <Button
                  ref={editRef}
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Edit quote"
                  data-quote-edit={quote.id}
                  onClick={() => setEditing(true)}
                >
                  <Pencil className="size-3.5" />
                </Button>
                <DeleteQuoteButton quoteId={quote.id} />
              </span>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
