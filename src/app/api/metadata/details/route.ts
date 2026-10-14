import { NextResponse } from "next/server";
import { guardMetadataRequest } from "@/lib/api-guard";
import { getPreferences } from "@/lib/current-user";
import { getGameDetails } from "@/lib/metadata";

/**
 * GET /api/metadata/details?id=<catalogueId>&title=…
 * Called when the player picks a search result, and by "Look up details"
 * on the edit page — fetches the entry's full record (description,
 * studios, platforms, genres; the time to beat from IGDB when it is set
 * up) for the form.
 */
export async function GET(req: Request) {
  const guard = await guardMetadataRequest();
  if (!guard.ok) return guard.response;

  const params = new URL(req.url).searchParams;
  const details = await getGameDetails(
    {
      catalogueId: params.get("id"),
      title: params.get("title"),
    },
    (await getPreferences()).catalogues,
  );

  return NextResponse.json({ details });
}
