import { describe, expect, it } from "vitest";
import { fillFindLink, findLinksFor } from "@/lib/find-links";

const knight = { title: "Hollow Knight", developers: ["Team Cherry"], platform: "Nintendo Switch" };

describe("fillFindLink", () => {
  it("fills in the title", () => {
    expect(fillFindLink("https://howlongtobeat.com/?q={title}", knight)).toBe(
      "https://howlongtobeat.com/?q=Hollow%20Knight",
    );
  });

  it("encodes the title so it can't break the query", () => {
    const game = { ...knight, title: "Q&A? #1 / Part 2" };
    expect(fillFindLink("https://shop.example/s?q={title}&x=1", game)).toBe(
      "https://shop.example/s?q=Q%26A%3F%20%231%20%2F%20Part%202&x=1",
    );
  });

  it("inserts a $& in a title as written", () => {
    const game = { ...knight, title: "$& and $1" };
    expect(fillFindLink("https://shop.example/?q={title}", game)).toBe(
      `https://shop.example/?q=${encodeURIComponent("$& and $1")}`,
    );
  });

  it("uses the first developer", () => {
    const game = { ...knight, developers: ["Valve", "Hidden Path Entertainment"] };
    expect(fillFindLink("https://shop.example/dev/{developer}", game)).toBe(
      "https://shop.example/dev/Valve",
    );
  });

  it("fills in the platform", () => {
    expect(fillFindLink("https://www.pricecharting.com/search-products?q={title}+{platform}", knight)).toBe(
      "https://www.pricecharting.com/search-products?q=Hollow%20Knight+Nintendo%20Switch",
    );
  });

  it("fills every placeholder in one pattern", () => {
    expect(
      fillFindLink("https://x.example/{platform}?t={title}&d={developer}&p={platform}", knight),
    ).toBe(
      "https://x.example/Nintendo%20Switch?t=Hollow%20Knight&d=Team%20Cherry&p=Nintendo%20Switch",
    );
  });

  it("is null when a placeholder has nothing to fill it with", () => {
    expect(fillFindLink("https://shop.example/?p={platform}", { ...knight, platform: null })).toBeNull();
    expect(fillFindLink("https://shop.example/?p={platform}", { ...knight, platform: " " })).toBeNull();
    expect(fillFindLink("https://shop.example/?d={developer}", { ...knight, developers: [] })).toBeNull();
  });

  it("keeps a pattern without placeholders as it is", () => {
    expect(fillFindLink("https://shop.example/", { ...knight, platform: null })).toBe(
      "https://shop.example/",
    );
  });

  it("leaves a placeholder it doesn't know as written", () => {
    // Only {title}, {developer} and {platform} are filled in.
    expect(fillFindLink("https://shop.example/?q={isbn}", knight)).toBe(
      "https://shop.example/?q={isbn}",
    );
  });

  it("refuses anything that isn't https", () => {
    expect(fillFindLink("http://shop.example/?q={title}", knight)).toBeNull();
    expect(fillFindLink("javascript:alert({title})", knight)).toBeNull();
    expect(fillFindLink("not a link {title}", knight)).toBeNull();
  });
});

describe("findLinksFor", () => {
  it("keeps the order and drops links this game can't fill", () => {
    const links = [
      { name: "Prices", url: "https://prices.example/?p={platform}" },
      { name: "Studio", url: "https://shop.example/?d={developer}" },
      { name: "HowLongToBeat", url: "https://howlongtobeat.com/?q={title}" },
    ];
    expect(findLinksFor(links, { ...knight, platform: null })).toEqual([
      { name: "Studio", href: "https://shop.example/?d=Team%20Cherry" },
      { name: "HowLongToBeat", href: "https://howlongtobeat.com/?q=Hollow%20Knight" },
    ]);
  });

  it("is empty with no links saved", () => {
    expect(findLinksFor([], knight)).toEqual([]);
  });
});
