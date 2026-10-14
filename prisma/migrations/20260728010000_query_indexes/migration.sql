-- Indexes for the filters and sorts the app actually issues. Game previously
-- had only (userId, status) and (userId, createdAt), so everything else was a
-- sequential scan over the user's whole library.

-- Tag filter: `tags: { has: … }` is array containment, which a btree cannot
-- serve at all.
CREATE INDEX "Game_tags_idx" ON "Game" USING GIN ("tags");

-- The year pages and the per-year stats filter and order by finish date.
CREATE INDEX "Game_userId_dateFinished_idx" ON "Game" ("userId", "dateFinished");


-- "Do I own this?" looks games up by ISBN in both 10- and 13-digit forms.
CREATE INDEX "Game_userId_isbn_idx" ON "Game" ("userId", "isbn");

-- Quotes are always read newest-first, scoped to a game.
CREATE INDEX "Quote_gameId_createdAt_idx" ON "Quote" ("gameId", "createdAt");
