import { describe, expect, it } from "vitest";
import { catalogueLink, parseCatalogueId } from "@/lib/metadata/links";

describe("parseCatalogueId", () => {
  it("reads each catalogue's prefix and key", () => {
    expect(parseCatalogueId("igdb:portal-2")).toEqual({ source: "igdb", key: "portal-2" });
    expect(parseCatalogueId("steam:620")).toEqual({ source: "steam", key: "620" });
    expect(parseCatalogueId("wikidata:Q279744")).toEqual({ source: "wikipedia", key: "Q279744" });
  });

  it("refuses anything that isn't one", () => {
    expect(parseCatalogueId(null)).toBeNull();
    expect(parseCatalogueId("")).toBeNull();
    expect(parseCatalogueId("OL27482W")).toBeNull();
    expect(parseCatalogueId("steam:portal")).toBeNull();
    expect(parseCatalogueId("wikidata:279744")).toBeNull();
    expect(parseCatalogueId("igdb:../admin")).toBeNull();
  });
});

describe("catalogueLink", () => {
  it("links each catalogue's own page", () => {
    expect(catalogueLink("igdb:hollow-knight")).toEqual({
      label: "IGDB",
      url: "https://www.igdb.com/games/hollow-knight",
    });
    expect(catalogueLink("steam:620")).toEqual({
      label: "Steam",
      url: "https://store.steampowered.com/app/620",
    });
  });

  it("sends a Wikidata item to its English Wikipedia article", () => {
    expect(catalogueLink("wikidata:Q279744")).toEqual({
      label: "Wikipedia",
      url: "https://www.wikidata.org/wiki/Special:GoToLinkedPage/enwiki/Q279744",
    });
  });

  it("has no link without a valid id", () => {
    expect(catalogueLink(null)).toBeNull();
    expect(catalogueLink("isbn:9780261103344")).toBeNull();
  });
});
