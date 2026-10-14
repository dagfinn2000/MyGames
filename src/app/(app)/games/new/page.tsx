import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { getPreferences } from "@/lib/current-user";
import { ownershipParam } from "@/lib/check-verdict";
import { tagImportFor } from "@/lib/user-tags";
import { AddGameClient } from "@/components/add-game-client";

export const dynamic = "force-dynamic";
export const metadata = { title: "Add game · MyGames" };

export default async function NewGamePage({
  searchParams,
}: {
  searchParams: Promise<{ isbn?: string; ownership?: string | string[] }>;
}) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login"); // revoked session (see auth.ts)
  // Handoff from the "do I own this?" page: ?isbn= seeds the import search,
  // and "Add to wishlist" adds ?ownership=WISHLIST over the usual default.
  const { isbn, ownership } = await searchParams;

  // Existing series names, for the form's autocomplete suggestions.
  const seriesRows = await prisma.game.findMany({
    where: { userId: session.user.id, seriesName: { not: null } },
    select: { seriesName: true },
    distinct: ["seriesName"],
    orderBy: { seriesName: "asc" },
  });
  const seriesNames = seriesRows
    .map((r) => r.seriesName)
    .filter((s): s is string => !!s);
  const prefs = await getPreferences();
  // How catalogue subjects become tags: the import mode and tag rules, plus
  // the library's own tags when only those are wanted.
  const tagImport = await tagImportFor(session.user.id, prefs);

  return (
    <div className="mx-auto grid max-w-3xl gap-4">
      <h1 className="text-2xl font-semibold tracking-tight">Add game</h1>
      <AddGameClient
        seriesNames={seriesNames}
        initialIsbn={isbn}
        defaults={{
          format: prefs.newGameFormat,
          status: prefs.newGameStatus,
          ownership: ownershipParam(ownership) ?? prefs.newGameOwnership,
        }}
        tagImport={tagImport}
      />
    </div>
  );
}
