import { NextResponse } from "next/server";
import { guardMetadataRequest } from "@/lib/api-guard";
import { getPreferences } from "@/lib/current-user";
import { getCoverCandidates } from "@/lib/metadata";

/**
 * GET /api/metadata/covers?id=<catalogueId>&title=…
 * Backs the cover picker in the game form — returns candidate covers: the
 * catalogue entry's own first, then what a title search finds in each of
 * the player's catalogues (IGDB, Wikipedia, Steam).
 */
export async function GET(req: Request) {
  const guard = await guardMetadataRequest();
  if (!guard.ok) return guard.response;

  const params = new URL(req.url).searchParams;
  const catalogueId = params.get("id")?.trim() || null;
  const title = params.get("title")?.trim() || null;

  if (!catalogueId && !title) {
    return NextResponse.json({ covers: [] });
  }

  const { catalogues } = await getPreferences();
  const covers = await getCoverCandidates({ catalogueId, title }, catalogues);
  return NextResponse.json({ covers });
}
