-- CreateTable
CREATE TABLE "ProgressEntry" (
    "id" TEXT NOT NULL,
    "gameId" TEXT NOT NULL,
    "page" INTEGER NOT NULL,
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProgressEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProgressEntry_gameId_date_idx" ON "ProgressEntry"("gameId", "date");

-- AddForeignKey
ALTER TABLE "ProgressEntry" ADD CONSTRAINT "ProgressEntry_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "Game"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Seed: every game with a reading position (READING and DNF keep currentPage)
-- gets its position as an anchor entry dated now. Deltas are only counted
-- between consecutive entries, so the anchor itself credits no pages to
-- upgrade day — it just gives pace and the sparkline a starting point, and
-- makes the first post-upgrade update count only the pages read since.
INSERT INTO "ProgressEntry" ("id", "gameId", "page", "date")
SELECT gen_random_uuid()::text, b."id", b."currentPage", CURRENT_TIMESTAMP
FROM "Game" b
WHERE b."currentPage" IS NOT NULL;
