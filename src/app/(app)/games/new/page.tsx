import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { getPreferences } from "@/lib/current-user";
import { tagImportFor } from "@/lib/user-tags";
import { AddGameClient } from "@/components/add-game-client";

export const dynamic = "force-dynamic";
export const metadata = { title: "Add game · MyGames" };

export default async function NewGamePage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login"); // revoked session (see auth.ts)
  const userId = session.user.id;

  const [seriesRows, platformRows, prefs] = await Promise.all([
    // Existing series names, for the form's autocomplete suggestions.
    prisma.game.findMany({
      where: { userId, seriesName: { not: null } },
      select: { seriesName: true },
      distinct: ["seriesName"],
      orderBy: { seriesName: "asc" },
    }),
    // The platforms the player already has games on, most used first: the
    // ones they are likeliest to pick again.
    prisma.game.groupBy({
      by: ["platform"],
      where: { userId, platform: { not: null } },
      _count: { platform: true },
      orderBy: [{ _count: { platform: "desc" } }, { platform: "asc" }],
    }),
    getPreferences(),
  ]);
  const seriesNames = seriesRows
    .map((r) => r.seriesName)
    .filter((s): s is string => !!s);
  const libraryPlatforms = platformRows
    .map((r) => r.platform)
    .filter((p): p is string => !!p);
  // How catalogue genres become tags: the import mode and tag rules, plus
  // the library's own tags when only those are wanted.
  const tagImport = await tagImportFor(userId, prefs);

  return (
    <div className="mx-auto grid max-w-3xl gap-4">
      <h1 className="text-2xl font-semibold tracking-tight">Add game</h1>
      <AddGameClient
        seriesNames={seriesNames}
        libraryPlatforms={libraryPlatforms}
        defaults={{
          format: prefs.newGameFormat,
          status: prefs.newGameStatus,
          ownership: prefs.newGameOwnership,
        }}
        tagImport={tagImport}
      />
    </div>
  );
}
