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

  const [game, seriesRows] = await Promise.all([
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
  ]);
  if (!game) notFound();
  const seriesNames = seriesRows
    .map((r) => r.seriesName)
    .filter((s): s is string => !!s);

  // Bind the id server-side so the client form can't target another row.
  const action = updateGame.bind(null, game.id);
  // How "Look up details" turns catalogue subjects into tags.
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
        lookup={lookup}
        initial={{
          title: game.title,
          authors: game.authors.join(", "),
          isbn: game.isbn ?? "",
          description: game.description ?? "",
          coverUrl: game.coverUrl ?? "",
          pageCount: game.pageCount?.toString() ?? "",
          lengthMinutes: game.lengthMinutes?.toString() ?? "",
          publishedDate: game.publishedDate ?? "",
          tags: game.tags.join(", "),
          seriesName: game.seriesName ?? "",
          seriesNumber: game.seriesNumber?.toString() ?? "",
          format: game.format,
          ownership: game.ownership,
          openLibraryId: game.openLibraryId ?? "",
        }}
      />
    </div>
  );
}
