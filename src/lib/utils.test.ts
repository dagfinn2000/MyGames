import { describe, expect, it } from "vitest";
import { buildSearchText, escapeLike, foldForSearch, searchTerms } from "@/lib/utils";

describe("buildSearchText", () => {
  it("joins title, developers, series and platform, lowercased", () => {
    expect(
      buildSearchText("Breath of the Wild", ["Nintendo EPD"], "The Legend of Zelda", "Nintendo Switch"),
    ).toBe("breath of the wild nintendo epd the legend of zelda nintendo switch");
  });

  it("takes every developer", () => {
    expect(buildSearchText("Portal 2", ["Valve", "Hidden Path Entertainment"])).toBe(
      "portal 2 valve hidden path entertainment",
    );
  });

  it("handles missing series, platform and developers without stray whitespace", () => {
    expect(buildSearchText("Tetris", [], null, null)).toBe("tetris");
    expect(buildSearchText("Celeste", ["Maddy Makes Games"], undefined)).toBe(
      "celeste maddy makes games",
    );
    expect(buildSearchText("Celeste", [], null, "PC")).toBe("celeste pc");
  });
});

describe("foldForSearch", () => {
  it("strips accents and spells out letters NFD keeps whole", () => {
    expect(foldForSearch("Pokémon")).toBe("pokemon");
    expect(foldForSearch("Ōkami")).toBe("okami");
    expect(foldForSearch("Bjørn Ærø")).toBe("bjorn aero");
    expect(foldForSearch("Straße, Łódź, Þór")).toBe("strasse, lodz, thor");
  });

  it("leaves scripts without Latin accents intact", () => {
    // NFD splits kana and hangul too; NFC puts them back together.
    expect(foldForSearch("がっこう 한국어")).toBe("がっこう 한국어");
  });
});

describe("buildSearchText folding", () => {
  it("stores the folded form, so accent-free searches match", () => {
    expect(buildSearchText("Pokémon Red", ["Game Freak"], "Pokémon", "Game Boy")).toBe(
      "pokemon red game freak pokemon game boy",
    );
  });
});

describe("searchTerms", () => {
  it("trims, splits into words, folds, and dedupes", () => {
    expect(searchTerms("   Cherry  KNIGHT cherry ")).toEqual(["cherry", "knight"]);
    expect(searchTerms("Pokémon")).toEqual(["pokemon"]);
    expect(searchTerms("   ")).toEqual([]);
  });

  it("escapes LIKE wildcards so they match literally", () => {
    expect(searchTerms("100% a_b c\\d")).toEqual(["100\\%", "a\\_b", "c\\\\d"]);
    expect(escapeLike("50%_off")).toBe("50\\%\\_off");
  });
});
