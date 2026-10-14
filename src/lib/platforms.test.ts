import { describe, expect, it } from "vitest";
import { COMMON_PLATFORMS, normalizePlatform, normalizePlatforms } from "@/lib/platforms";

describe("normalizePlatform", () => {
  it("gives the catalogues' Windows and Mac names their everyday ones", () => {
    expect(normalizePlatform("PC (Microsoft Windows)")).toBe("PC");
    expect(normalizePlatform("Microsoft Windows")).toBe("PC");
    expect(normalizePlatform("macOS")).toBe("Mac");
    expect(normalizePlatform("Mac")).toBe("Mac");
    expect(normalizePlatform("Xbox Series X and Series S")).toBe("Xbox Series X|S");
    expect(normalizePlatform("Sega Mega Drive/Genesis")).toBe("Mega Drive");
  });

  it("keeps names that are already the everyday ones, tidying the spacing", () => {
    expect(normalizePlatform("Xbox Series X|S")).toBe("Xbox Series X|S");
    expect(normalizePlatform("PlayStation 4")).toBe("PlayStation 4");
    expect(normalizePlatform("  Nintendo   Switch ")).toBe("Nintendo Switch");
    expect(normalizePlatform("Atari 2600")).toBe("Atari 2600");
  });
});

describe("normalizePlatforms", () => {
  it("keeps the catalogue's order and drops the repeats renaming makes", () => {
    expect(
      normalizePlatforms(["Microsoft Windows", "PlayStation 3", "Windows", "macOS", "Xbox 360", " "]),
    ).toEqual(["PC", "PlayStation 3", "Mac", "Xbox 360"]);
  });
});

describe("COMMON_PLATFORMS", () => {
  it("starts with today's systems and suggests each name once, as normalized", () => {
    expect(COMMON_PLATFORMS.slice(0, 3)).toEqual(["PC", "PlayStation 5", "Xbox Series X|S"]);
    expect(new Set(COMMON_PLATFORMS).size).toBe(COMMON_PLATFORMS.length);
    for (const p of COMMON_PLATFORMS) expect(normalizePlatform(p)).toBe(p);
  });
});
