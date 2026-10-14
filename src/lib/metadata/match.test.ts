import { describe, expect, it } from "vitest";
import { releaseYear, titleKey } from "@/lib/metadata/match";

describe("titleKey", () => {
  it("ignores case, accents, punctuation and trademark signs", () => {
    expect(titleKey("The Witcher® 3: Wild Hunt")).toBe(titleKey("the witcher 3 wild hunt"));
    expect(titleKey("Pokémon Legends: Arceus")).toBe("pokemon legends arceus");
    expect(titleKey("Ratchet & Clank")).toBe(titleKey("Ratchet and Clank"));
    expect(titleKey("DOOM™")).toBe("doom");
  });

  it("still tells apart titles that differ in more than that", () => {
    expect(titleKey("Portal 2")).not.toBe(titleKey("Portal"));
    expect(titleKey("Hollow Knight: Silksong")).not.toBe(titleKey("Hollow Knight"));
  });
});

describe("releaseYear", () => {
  it("reads the year of a full or partial date", () => {
    expect(releaseYear("2017-02-24")).toBe("2017");
    expect(releaseYear("1998")).toBe("1998");
    expect(releaseYear("")).toBeNull();
    expect(releaseYear(null)).toBeNull();
  });
});
