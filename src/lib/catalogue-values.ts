import type { GameDetails, GameMetadata } from "@/lib/metadata/types";
import { normalizePlatform } from "@/lib/platforms";
import { catalogueTags, type TagImportSettings } from "@/lib/tag-rules";

/**
 * Turning what the catalogues say about a game into game-form values, and
 * comparing those with what a form already holds. Pure and client-safe:
 * the import search and the edit page's "Look up details" both go through
 * here, so a game gets the same time to beat, tags and catalogue id
 * whichever way it came in.
 */

/** The catalogue's fields as the game form holds them: all strings. */
export interface CatalogueValues {
  title: string;
  developers: string; // comma-separated
  publisher: string;
  /** Only when the catalogue lists exactly one platform (see
   *  cataloguePlatforms). */
  platform: string;
  description: string;
  coverUrl: string;
  /** Time to beat in whole minutes, as text; "" = unknown. */
  lengthMinutes: string;
  releaseDate: string;
  tags: string; // comma-separated
  seriesName: string;
  catalogueId: string;
}

export type CatalogueField = keyof CatalogueValues;

/** Every platform the catalogue lists the game on: the details' list (the
 *  entry's full record), else the search row's. For the form's platform
 *  suggestions. */
export function cataloguePlatforms(
  row: Pick<GameMetadata, "platforms"> | null,
  details: Partial<Pick<GameDetails, "platforms">> | null,
): string[] {
  return details?.platforms?.length ? details.platforms : (row?.platforms ?? []);
}

/** A catalogue's time to beat as worth showing. The times are averages
 *  over many players, so from two hours up they are rounded to the hour:
 *  "about 27 h" rather than "about 26 h 50 min". */
export function roundTimeToBeat(minutes: number): number {
  return minutes >= 120 ? Math.round(minutes / 60) * 60 : Math.round(minutes);
}

/**
 * Form values for a catalogue's game: the search row (if there is one) plus
 * the details fetched for it, with the genres run through the player's tag
 * settings. The details are the entry's full record, so their values come
 * first: a Steam search row's cover is only a small landscape capsule, and
 * its developers and release date are missing until the details bring
 * them. The row fills in what the details lack (a row merged from several
 * catalogues can know more than its own entry).
 *
 * The platform is filled in only when the catalogue lists just one; with
 * several, which one is yours is for you to say (the list goes to the form
 * as suggestions, see cataloguePlatforms).
 */
export function catalogueGameValues(
  row: GameMetadata | null,
  details: Partial<GameDetails> | null,
  tagImport: TagImportSettings,
): CatalogueValues {
  const developers = details?.developers?.length ? details.developers : (row?.developers ?? []);
  const platforms = cataloguePlatforms(row, details);
  const length = details?.lengthMinutes ?? row?.lengthMinutes ?? null;
  return {
    title: row?.title ?? "",
    developers: developers.join(", "),
    publisher: details?.publisher ?? row?.publisher ?? "",
    platform: platforms.length === 1 ? platforms[0] : "",
    description: details?.description ?? row?.description ?? "",
    coverUrl: details?.coverUrl ?? row?.coverUrl ?? "",
    lengthMinutes: length && length > 0 ? String(Math.round(length)) : "",
    releaseDate: details?.releaseDate ?? row?.releaseDate ?? "",
    tags: catalogueTags([...(row?.tags ?? []), ...(details?.tags ?? [])], tagImport).join(", "),
    seriesName: details?.seriesName ?? row?.seriesName ?? "",
    catalogueId: row?.catalogueId ?? details?.catalogueId ?? "",
  };
}

export const CATALOGUE_FIELD_LABELS: Record<CatalogueField, string> = {
  title: "Title",
  developers: "Developer(s)",
  publisher: "Publisher",
  platform: "Platform",
  description: "Description",
  coverUrl: "Cover",
  lengthMinutes: "Time to beat",
  releaseDate: "Released",
  tags: "Tags",
  seriesName: "Series",
  catalogueId: "Catalogue entry",
};

/** One field the catalogue could fill in. */
export interface CatalogueDiffRow {
  field: CatalogueField;
  label: string;
  /** What the form holds now ("" = empty). */
  current: string;
  /** What filling it in would put there. For tags, only the new ones,
   *  which are added to the player's own. */
  value: string;
  /** Ticked to begin with: only when the form's field is empty. */
  checked: boolean;
}

function splitList(s: string): string[] {
  return s
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
}

/** A value as compared: equal after this means nothing to offer. */
function comparable(field: CatalogueField, value: string): string {
  const v = value.trim().replace(/\s+/g, " ");
  switch (field) {
    case "title":
    case "publisher":
    case "seriesName":
      return v.toLowerCase();
    case "developers":
      return splitList(v.toLowerCase()).join(",");
    case "platform":
      return v ? normalizePlatform(v).toLowerCase() : v;
    case "lengthMinutes": {
      const n = Number(v);
      return v && Number.isFinite(n) ? String(n) : v;
    }
    default:
      return v;
  }
}

/**
 * The fields the catalogue could fill in on a form, in form order. A field
 * is offered when the catalogue has a value and it differs from the form's
 * (ignoring case and spacing in names, the catalogues' spellings of a
 * platform — "Windows" is "PC" — and how a number is written). Empty
 * fields come ticked; ones that differ come unticked, so nothing the
 * player typed is overwritten by accident. Tags are only ever added to,
 * the cover is only offered for a game without one (the cover picker
 * changes covers), and the catalogue entry only when there is none.
 */
export function diffAgainstForm(
  current: CatalogueValues,
  catalogue: CatalogueValues,
): CatalogueDiffRow[] {
  const rows: CatalogueDiffRow[] = [];
  const order: CatalogueField[] = [
    "title",
    "developers",
    "publisher",
    "platform",
    "lengthMinutes",
    "releaseDate",
    "tags",
    "seriesName",
    "description",
    "coverUrl",
    "catalogueId",
  ];
  for (const field of order) {
    const now = current[field].trim();
    const offered = catalogue[field].trim();
    if (!offered) continue;
    const row = { field, label: CATALOGUE_FIELD_LABELS[field], current: now };

    if (field === "tags") {
      const have = new Set(splitList(now.toLowerCase()));
      const added = splitList(offered).filter((t) => !have.has(t.toLowerCase()));
      if (added.length > 0) rows.push({ ...row, value: added.join(", "), checked: !now });
      continue;
    }
    if ((field === "coverUrl" || field === "catalogueId") && now) continue;
    if (comparable(field, now) === comparable(field, offered)) continue;
    rows.push({ ...row, value: offered, checked: !now });
  }
  return rows;
}
