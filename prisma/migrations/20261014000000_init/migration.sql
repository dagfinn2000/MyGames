-- MyGames schema, first version.
-- Trigram indexes on the search text and series name need pg_trgm.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "PlayStatus" AS ENUM ('WANT_TO_PLAY', 'PLAYING', 'COMPLETED', 'DROPPED');

-- CreateEnum
CREATE TYPE "GameFormat" AS ENUM ('PHYSICAL', 'DIGITAL', 'SUBSCRIPTION');

-- CreateEnum
CREATE TYPE "GameOwnership" AS ENUM ('OWNED', 'WISHLIST', 'BORROWED', 'GIVEN_AWAY');

-- CreateEnum
CREATE TYPE "GoalUnit" AS ENUM ('GAMES', 'HOURS');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "tokenVersion" INTEGER NOT NULL DEFAULT 0,
    "theme" TEXT,
    "libraryView" JSONB,
    "preferences" JSONB,
    "lastBackupAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SavedView" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "query" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SavedView_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlayGoal" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "target" INTEGER NOT NULL,
    "unit" "GoalUnit" NOT NULL DEFAULT 'GAMES',
    "countReplays" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlayGoal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Shelf" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Shelf_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Game" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "developers" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "publisher" TEXT,
    "platform" TEXT,
    "description" TEXT,
    "coverUrl" TEXT,
    "lengthMinutes" INTEGER,
    "releaseDate" TEXT,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "format" "GameFormat" NOT NULL DEFAULT 'PHYSICAL',
    "ownership" "GameOwnership" NOT NULL DEFAULT 'OWNED',
    "seriesName" TEXT,
    "seriesNumber" DOUBLE PRECISION,
    "catalogueId" TEXT,
    "status" "PlayStatus" NOT NULL DEFAULT 'WANT_TO_PLAY',
    "rating" INTEGER,
    "review" TEXT,
    "dateStarted" TIMESTAMP(3),
    "dateFinished" TIMESTAMP(3),
    "timesCompleted" INTEGER NOT NULL DEFAULT 0,
    "playedMinutes" INTEGER,
    "searchText" TEXT NOT NULL DEFAULT '',
    "reviewSearchText" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Game_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Playthrough" (
    "id" TEXT NOT NULL,
    "gameId" TEXT NOT NULL,
    "dateStarted" TIMESTAMP(3),
    "dateFinished" TIMESTAMP(3),
    "rating" INTEGER,
    "playedMinutes" INTEGER,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Playthrough_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProgressEntry" (
    "id" TEXT NOT NULL,
    "gameId" TEXT NOT NULL,
    "minutes" INTEGER NOT NULL,
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProgressEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Loan" (
    "id" TEXT NOT NULL,
    "gameId" TEXT NOT NULL,
    "borrower" TEXT NOT NULL,
    "lentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "returnedAt" TIMESTAMP(3),
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Loan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Quote" (
    "id" TEXT NOT NULL,
    "gameId" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "speaker" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Quote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MetadataCache" (
    "id" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "query" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MetadataCache_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "_GameToShelf" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_GameToShelf_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");

-- CreateIndex
CREATE UNIQUE INDEX "SavedView_userId_name_key" ON "SavedView"("userId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "PlayGoal_userId_year_key" ON "PlayGoal"("userId", "year");

-- CreateIndex
CREATE UNIQUE INDEX "Shelf_userId_name_key" ON "Shelf"("userId", "name");

-- CreateIndex
CREATE INDEX "Game_userId_status_idx" ON "Game"("userId", "status");

-- CreateIndex
CREATE INDEX "Game_userId_createdAt_idx" ON "Game"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "Game_userId_dateFinished_idx" ON "Game"("userId", "dateFinished");

-- CreateIndex
CREATE INDEX "Game_tags_idx" ON "Game" USING GIN ("tags");

-- CreateIndex
CREATE INDEX "Game_searchText_trgm_idx" ON "Game" USING GIN ("searchText" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "Game_seriesName_trgm_idx" ON "Game" USING GIN ("seriesName" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "Playthrough_gameId_dateFinished_idx" ON "Playthrough"("gameId", "dateFinished");

-- CreateIndex
CREATE INDEX "ProgressEntry_gameId_date_idx" ON "ProgressEntry"("gameId", "date");

-- CreateIndex
CREATE INDEX "Loan_gameId_returnedAt_idx" ON "Loan"("gameId", "returnedAt");

-- CreateIndex
CREATE INDEX "Loan_gameId_lentAt_idx" ON "Loan"("gameId", "lentAt");

-- CreateIndex
CREATE INDEX "Quote_gameId_idx" ON "Quote"("gameId");

-- CreateIndex
CREATE INDEX "Quote_gameId_createdAt_idx" ON "Quote"("gameId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "MetadataCache_source_query_key" ON "MetadataCache"("source", "query");

-- CreateIndex
CREATE INDEX "_GameToShelf_B_index" ON "_GameToShelf"("B");

-- AddForeignKey
ALTER TABLE "SavedView" ADD CONSTRAINT "SavedView_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlayGoal" ADD CONSTRAINT "PlayGoal_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Shelf" ADD CONSTRAINT "Shelf_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Game" ADD CONSTRAINT "Game_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Playthrough" ADD CONSTRAINT "Playthrough_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "Game"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProgressEntry" ADD CONSTRAINT "ProgressEntry_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "Game"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Loan" ADD CONSTRAINT "Loan_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "Game"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Quote" ADD CONSTRAINT "Quote_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "Game"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_GameToShelf" ADD CONSTRAINT "_GameToShelf_A_fkey" FOREIGN KEY ("A") REFERENCES "Game"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_GameToShelf" ADD CONSTRAINT "_GameToShelf_B_fkey" FOREIGN KEY ("B") REFERENCES "Shelf"("id") ON DELETE CASCADE ON UPDATE CASCADE;

