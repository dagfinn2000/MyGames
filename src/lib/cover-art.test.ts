import { describe, expect, it } from "vitest";
import {
  BAND_LABEL_MAX,
  BAND_LABEL_MIN,
  BAND_LABEL_WIDTH,
  BAND_LETTER_WIDTH,
  bandLabel,
  coverArt,
} from "@/lib/cover-art";

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

describe("bandLabel", () => {
  it("leaves the band plain when there is no platform", () => {
    expect(bandLabel(null)).toBeNull();
    expect(bandLabel(undefined)).toBeNull();
    expect(bandLabel("")).toBeNull();
    expect(bandLabel("   ")).toBeNull();
  });

  it("keeps the platform as typed, with its spaces tidied", () => {
    expect(bandLabel("PS5")?.text).toBe("PS5");
    expect(bandLabel("  Nintendo   Switch ")?.text).toBe("Nintendo Switch");
    expect(bandLabel("Xbox Series X|S")?.text).toBe("Xbox Series X|S");
  });

  it("gives short names the full size", () => {
    expect(bandLabel("PC")?.size).toBe(BAND_LABEL_MAX);
    expect(bandLabel("PS5")?.size).toBe(BAND_LABEL_MAX);
  });

  it("shrinks a long name so it fits across the band on one line", () => {
    const switchLabel = bandLabel("Nintendo Switch")!;
    const nes = bandLabel("Nintendo Entertainment System")!;
    expect(nes.size).toBeLessThan(switchLabel.size);
    // Twenty-nine capitals at the estimated width each, within the share
    // of the cover's width the name may take.
    expect(nes.size * 29 * BAND_LETTER_WIDTH).toBeLessThanOrEqual(BAND_LABEL_WIDTH);
    expect(nes.size).toBeGreaterThanOrEqual(BAND_LABEL_MIN);
  });

  it("stops shrinking where a name would be too small to make out", () => {
    const label = bandLabel("Sega Mega Drive / Genesis with the Mega-CD and the 32X add-ons")!;
    expect(label.size).toBe(BAND_LABEL_MIN);
  });

  // Only a name's length counts here: the letters' widths are an average
  // (BAND_LETTER_WIDTH), so this checks the sizing against that estimate,
  // not how wide any one name really sets.
  it("sizes a name to the estimated share of the band, short of the smallest size", () => {
    for (let n = 1; n <= 60; n++) {
      const { size } = bandLabel("A".repeat(n))!;
      expect(size).toBeLessThanOrEqual(BAND_LABEL_MAX);
      expect(size).toBeGreaterThanOrEqual(BAND_LABEL_MIN);
      if (size > BAND_LABEL_MIN) {
        expect(size * n * BAND_LETTER_WIDTH).toBeLessThanOrEqual(BAND_LABEL_WIDTH);
      }
    }
  });

  it("leaves the estimate room to spare inside the band's padding", () => {
    // The band is padded 6% of the cover's width at each end
    // (globals.css, .drawn-cover-band).
    expect(BAND_LABEL_WIDTH).toBeLessThan(100 - 2 * 6);
  });
});
