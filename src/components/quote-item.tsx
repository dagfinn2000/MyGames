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
  page: number | null;
  note: string | null;
  createdAt: Date;
  game: { id: string; title: string; authors: string[]; coverUrl: string | null };
}

/**
 * One quote on the quotes page, with the same pencil and trash as the game
 * page. Under a game heading (`showGame` off) the game line gives way to the
 * page and the date it was added.
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
                      {quote.game.authors.join(", ")}
                      {quote.page != null && ` · p. ${quote.page}`}
                      {` · ${added}`}
                    </span>
                  </span>
                </Link>
              ) : (
                <p className="min-w-0 flex-1 truncate text-xs text-muted-foreground tabular-nums">
                  {quote.page != null ? `p. ${quote.page} · ${added}` : added}
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
