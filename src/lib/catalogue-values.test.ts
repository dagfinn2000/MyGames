import { describe, expect, it } from "vitest";
import {
  catalogueGameValues,
  cataloguePlatforms,
  diffAgainstForm,
  roundTimeToBeat,
  type CatalogueValues,
} from "@/lib/catalogue-values";
import type { GameDetails, GameMetadata } from "@/lib/metadata/types";
import type { TagImportSettings } from "@/lib/tag-rules";

const all: TagImportSettings = { mode: "all", rules: { renames: [], skips: [] }, knownTags: [] };

function row(over: Partial<GameMetadata> = {}): GameMetadata {
  return {
    title: "Hollow Knight",
    developers: ["Team Cherry"],
    publisher: "Team Cherry",
    platforms: ["PC", "Nintendo Switch", "PlayStation 4"],
    coverUrl: "https://images.igdb.com/igdb/image/upload/t_cover_big_2x/co93cr.jpg",
    description: null,
    lengthMinutes: 1610,
    releaseDate: "2017-02-24",
    tags: [],
    seriesName: "Hollow Knight",
    catalogueId: "igdb:hollow-knight",
    source: "igdb",
    ...over,
  };
}

const empty: CatalogueValues = {
  title: "",
  developers: "",
  publisher: "",
  platform: "",
  description: "",
  coverUrl: "",
  lengthMinutes: "",
  releaseDate: "",
  tags: "",
  seriesName: "",
  catalogueId: "",
};

describe("catalogueGameValues", () => {
  it("fills the form from the search row", () => {
    expect(catalogueGameValues(row({ tags: ["Platform", "Adventure"] }), null, all)).toEqual({
      title: "Hollow Knight",
      developers: "Team Cherry",
      publisher: "Team Cherry",
      platform: "",
      description: "",
      coverUrl: "https://images.igdb.com/igdb/image/upload/t_cover_big_2x/co93cr.jpg",
      lengthMinutes: "1610",
      releaseDate: "2017-02-24",
      tags: "platform, adventure",
      seriesName: "Hollow Knight",
      catalogueId: "igdb:hollow-knight",
    });
  });

  it("lets the details fill in a Steam row, its portrait art over the row's capsule", () => {
    const steamRow = row({
      source: "steam",
      catalogueId: "steam:367520",
      developers: [],
      publisher: null,
      releaseDate: null,
      lengthMinutes: null,
      coverUrl: "https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/367520/capsule_231x87.jpg",
      platforms: ["PC", "Mac", "Linux"],
    });
    const details: Partial<GameDetails> = {
      developers: ["Team Cherry"],
      releaseDate: "2017-02-24",
      coverUrl: "https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/367520/library_600x900_2x.jpg",
      description: "Forge your own path in Hollow Knight!",
      lengthMinutes: 1610,
      catalogueId: "steam:367520",
    };
    expect(catalogueGameValues(steamRow, details, all)).toMatchObject({
      developers: "Team Cherry",
      releaseDate: "2017-02-24",
      coverUrl: details.coverUrl,
      description: "Forge your own path in Hollow Knight!",
      lengthMinutes: "1610",
    });
  });

  it("fills in the platform only when the catalogue lists just one", () => {
    expect(catalogueGameValues(row({ platforms: ["Nintendo Switch"] }), null, all).platform).toBe(
      "Nintendo Switch",
    );
    expect(catalogueGameValues(row(), null, all).platform).toBe("");
    expect(catalogueGameValues(row(), { platforms: ["PC"] }, all).platform).toBe("PC");
  });

  it("falls back to the details' entry for a row without one", () => {
    const v = catalogueGameValues(row({ catalogueId: null }), { catalogueId: "igdb:hollow-knight" }, all);
    expect(v.catalogueId).toBe("igdb:hollow-knight");
    expect(catalogueGameValues(null, { catalogueId: "steam:367520" }, all).catalogueId).toBe("steam:367520");
  });

  it("runs the genres through the tag settings", () => {
    const v = catalogueGameValues(row({ tags: ["Platform"] }), { tags: ["Adventure, Indie"] }, {
      ...all,
      rules: { renames: [], skips: ["indie"] },
    });
    expect(v.tags).toBe("platform, adventure");
    expect(catalogueGameValues(row({ tags: ["Platform"] }), null, { ...all, mode: "off" }).tags).toBe("");
  });
});

describe("roundTimeToBeat", () => {
  it("rounds to the hour from two hours up, and keeps the minutes below", () => {
    expect(roundTimeToBeat(1610)).toBe(1620);
    expect(roundTimeToBeat(150)).toBe(180);
    expect(roundTimeToBeat(119)).toBe(119);
    expect(roundTimeToBeat(45.4)).toBe(45);
  });
});

describe("cataloguePlatforms", () => {
  it("prefers the details' list, else the row's", () => {
    expect(cataloguePlatforms(row(), { platforms: ["PC", "Mac"] })).toEqual(["PC", "Mac"]);
    expect(cataloguePlatforms(row(), { platforms: [] })).toEqual(["PC", "Nintendo Switch", "PlayStation 4"]);
    expect(cataloguePlatforms(null, null)).toEqual([]);
  });
});

describe("diffAgainstForm", () => {
  const catalogue = catalogueGameValues(
    row({ tags: ["metroidvania"], platforms: ["PC"] }),
    { description: "A 2D action-adventure." },
    all,
  );

  it("offers empty fields ticked and different ones unticked", () => {
    const rows = diffAgainstForm(
      { ...empty, title: "Hollow Night", developers: "Cherry", platform: "Nintendo Switch", tags: "indie" },
      catalogue,
    );
    const byField = Object.fromEntries(rows.map((r) => [r.field, r]));
    expect(byField.title).toMatchObject({ value: "Hollow Knight", current: "Hollow Night", checked: false });
    expect(byField.developers.checked).toBe(false);
    expect(byField.platform).toMatchObject({ value: "PC", checked: false });
    expect(byField.lengthMinutes).toMatchObject({ value: "1610", label: "Time to beat", checked: true });
    expect(byField.publisher.checked).toBe(true);
    expect(byField.description.checked).toBe(true);
    expect(byField.coverUrl.checked).toBe(true);
  });

  it("skips values that only differ in case, spacing, platform spelling or number form", () => {
    const rows = diffAgainstForm(
      {
        ...empty,
        title: "hollow  KNIGHT",
        developers: "team cherry",
        publisher: "TEAM CHERRY",
        platform: "Windows",
        lengthMinutes: "01610",
        releaseDate: "2017-02-24",
        description: "A  2D action-adventure.",
        tags: "Metroidvania",
        seriesName: "hollow knight",
      },
      catalogue,
    );
    expect(rows.map((r) => r.field)).toEqual(["coverUrl", "catalogueId"]);
  });

  it("offers only new tags, and the cover and catalogue entry only when empty", () => {
    const rows = diffAgainstForm(
      { ...empty, tags: "Indie, metroidvania", coverUrl: "/api/covers/a.jpg", catalogueId: "steam:367520" },
      catalogueGameValues(row({ tags: ["metroidvania", "souls-like"] }), null, all),
    );
    const tags = rows.find((r) => r.field === "tags");
    expect(tags).toMatchObject({ value: "souls-like", checked: false });
    expect(rows.some((r) => r.field === "coverUrl" || r.field === "catalogueId")).toBe(false);
  });
});
