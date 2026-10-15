import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { getPreferences } from "@/lib/current-user";
import { formatNumber } from "@/lib/display";
import { sortGames } from "@/lib/library-sort";
import { caseCount, fileByPlatform, shelve, spineFor, type RoomGame } from "@/lib/room";
import { RoomView } from "@/components/room-view";
import { RoomSwitch } from "@/components/room-switch";

export const dynamic = "force-dynamic";
export const metadata = { title: "Game room · MyGames" };

/**
 * The game room: the whole library as a little pixel-art house, every game
 * a case standing spine out on a shelf, filed by platform the way a games
 * shelf usually is. The house grows with the library
 * (components/game-room.tsx), and is decorated as the player likes
 * (components/room-view.tsx).
 */
export default async function GameRoomPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login"); // revoked session (see auth.ts)
  const userId = session.user.id;
  const prefs = await getPreferences();
  if (prefs.hiddenNav.includes("room")) {
    // Turned off in Preferences: no house, just the way back to it.
    return (
      <div className="mx-auto grid max-w-md justify-items-center gap-3 py-16 text-center">
        <h1 className="text-2xl font-semibold tracking-tight">Game room</h1>
        <p className="text-sm text-muted-foreground">
          The game room is turned off, so your games aren&apos;t drawn as a house here, and the Room tab is
          hidden.
        </p>
        <RoomSwitch hiddenNav={prefs.hiddenNav} on />
      </div>
    );
  }

  const rows = await prisma.game.findMany({
    where: { userId },
    select: {
      id: true,
      title: true,
      platform: true,
      format: true,
      coverUrl: true,
      playedMinutes: true,
      lengthMinutes: true,
      status: true,
      ownership: true,
      // The rest of what sortGames reads; only the developer order is used.
      developers: true,
      seriesName: true,
      seriesNumber: true,
      rating: true,
      dateFinished: true,
      dateStarted: true,
      releaseDate: true,
      createdAt: true,
      updatedAt: true,
      loans: {
        where: { returnedAt: null },
        select: { borrower: true },
        orderBy: { lentAt: "desc" },
        take: 1,
      },
    },
  });

  // By platform, and within a platform by developer, a series together.
  const sorted = fileByPlatform(
    sortGames(rows, "developer", "asc", { ignoreArticles: prefs.ignoreArticles, alphabet: prefs.sortAlphabet }),
    prefs.sortAlphabet,
  );
  // Only what the room draws goes to the browser.
  const games: RoomGame[] = sorted.map((g) => ({
    id: g.id,
    title: g.title,
    platform: g.platform,
    format: g.format,
    coverUrl: g.coverUrl,
    playedMinutes: g.playedMinutes,
    lengthMinutes: g.lengthMinutes,
    status: g.status,
    ownership: g.ownership,
    lentTo: g.loans[0]?.borrower ?? null,
  }));
  const cases = caseCount(shelve(games.map((g) => spineFor(g).width)).length);

  return (
    <div className="grid gap-4">
      <RoomView
        games={games}
        decor={{
          style: prefs.roomStyle,
          walls: prefs.roomWalls,
          wood: prefs.roomWood,
          fabric: prefs.roomFabric,
          hanging: prefs.roomHanging,
          paper: prefs.roomPaper,
          floor: prefs.roomFloor,
          ceiling: prefs.roomCeiling,
          own: prefs.roomOwn,
          cat: prefs.roomCat,
          dog: prefs.roomDog,
        }}
        layout={prefs.roomLayout}
        avatar={prefs.avatar}
        avatarShown={prefs.avatarShown}
        avatarLooks={prefs.avatarLooks}
        pet={prefs.avatarPet}
        hiddenNav={prefs.hiddenNav}
        away={prefs.roomAway}
        rooms={prefs.roomRooms}
        extras={prefs.roomExtras}
        summary={
          games.length > 0
            ? `${games.length === 1 ? "1 game" : `${formatNumber(games.length, prefs)} games`} on ${
                cases === 1 ? "1 shelving unit" : `${formatNumber(cases, prefs)} shelving units`
              }`
            : null
        }
      />
      {games.length === 0 ? (
        <p className="text-center text-sm text-muted-foreground">
          <Link href="/games/new" className="underline underline-offset-2 hover:text-foreground">
            Add games
          </Link>{" "}
          and they&apos;ll appear on the shelves.
        </p>
      ) : (
        <p className="mx-auto max-w-prose text-center text-xs text-muted-foreground">
          Games are filed by platform, then by developer. Handheld games stand in slim cases and boxed PC
          games in big boxes. An outline keeps the place of a game that isn&apos;t on the shelf right now:
          wished for, lent out, or sold or traded. A red ribbon marks a game you&apos;re playing. The room gets
          more furniture as your library grows, and Decorate changes its style and colours, adds rooms and
          furniture, moves it about, and makes the little you who lives there.
        </p>
      )}
    </div>
  );
}
