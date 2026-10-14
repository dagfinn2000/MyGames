import { notFound, redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { updateGame } from "@/lib/actions/games";
import { getPreferences } from "@/lib/current-user";
import { tagImportFor } from "@/lib/user-tags";
import { GameForm } from "@/components/game-form";

export const dynamic = "force-dynamic";
export const metadata = { title: "Edit game · MyGames" };

export default async function EditGamePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login"); // revoked session (see auth.ts)
  const { id } = await params;

  const [game, seriesRows, platformRows] = await Promise.all([
    prisma.game.findFirst({
      where: { id, userId: session.user.id },
    }),
    // Existing series names, for the form's autocomplete suggestions.
    prisma.game.findMany({
      where: { userId: session.user.id, seriesName: { not: null } },
      select: { seriesName: true },
      distinct: ["seriesName"],
      orderBy: { seriesName: "asc" },
    }),
    // The platforms already in the library, suggested before the common
    // ones, so each is spelt the same way on every game.
    prisma.game.findMany({
      where: { userId: session.user.id, platform: { not: null } },
      select: { platform: true },
      distinct: ["platform"],
      orderBy: { platform: "asc" },
    }),
  ]);
  if (!game) notFound();
  const seriesNames = seriesRows
    .map((r) => r.seriesName)
    .filter((s): s is string => !!s);
  const platformNames = platformRows
    .map((r) => r.platform)
    .filter((p): p is string => !!p);

  // Bind the id server-side so the client form can't target another row.
  const action = updateGame.bind(null, game.id);
  // How "Look up details" turns catalogue genres into tags.
  const lookup = await tagImportFor(session.user.id, await getPreferences());

  return (
    <div className="mx-auto grid max-w-3xl gap-4">
      <h1 className="text-2xl font-semibold tracking-tight wrap-anywhere">
        Edit “{game.title}”
      </h1>
      <GameForm
        action={action}
        submitLabel="Save changes"
        seriesNames={seriesNames}
        platformOptions={platformNames}
        lookup={lookup}
        initial={{
          title: game.title,
          developers: game.developers.join(", "),
          publisher: game.publisher ?? "",
          platform: game.platform ?? "",
          description: game.description ?? "",
          coverUrl: game.coverUrl ?? "",
          lengthMinutes: game.lengthMinutes?.toString() ?? "",
          releaseDate: game.releaseDate ?? "",
          tags: game.tags.join(", "),
          seriesName: game.seriesName ?? "",
          seriesNumber: game.seriesNumber?.toString() ?? "",
          format: game.format,
          ownership: game.ownership,
          catalogueId: game.catalogueId ?? "",
        }}
      />
    </div>
  );
}
