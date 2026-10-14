import { describe, expect, it } from "vitest";
import { coverArt } from "@/lib/cover-art";

describe("coverArt", () => {
  it("gives a title the same cover every time, whatever its case or spacing", () => {
    expect(coverArt("Hollow Knight")).toEqual(coverArt("Hollow Knight"));
    expect(coverArt("  hollow knight ")).toEqual(coverArt("Hollow Knight"));
  });

  it("keeps every colour in the band the cover text is readable on", () => {
    const titles = ["Portal 2", "Ico", "Castlevania: Symphony of the Night", "", "Æ Ø Å", "1942"];
    for (let i = 0; i < 200; i++) titles.push(`Game ${i}`);
    for (const title of titles) {
      const art = coverArt(title);
      expect(art.hue).toBeGreaterThanOrEqual(0);
      expect(art.hue).toBeLessThan(360);
      expect(art.saturation).toBeGreaterThanOrEqual(26);
      expect(art.saturation).toBeLessThanOrEqual(47);
      expect(art.lightness).toBeGreaterThanOrEqual(22);
      expect(art.lightness).toBeLessThanOrEqual(32);
      expect([0, 1, 2]).toContain(art.layout);
    }
  });

  it("shrinks the title when a word would not fit across the cover", () => {
    expect(coverArt("Ico").titleSize).toBe(11.5);
    // "Castlevania:" is twelve characters, too wide at full size.
    const castlevania = coverArt("Castlevania: Symphony of the Night");
    expect(castlevania.titleSize).toBeLessThan(11.5);
    expect(castlevania.titleSize * 12 * 0.6).toBeLessThanOrEqual(70);
  });

  it("spreads different titles around the colour wheel", () => {
    const hues = new Set(
      Array.from({ length: 50 }, (_, i) => Math.floor(coverArt(`Title ${i}`).hue / 30)),
    );
    // 50 titles should touch most of the twelve 30° slices.
    expect(hues.size).toBeGreaterThanOrEqual(9);
  });
});
