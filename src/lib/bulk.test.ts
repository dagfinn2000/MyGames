import { describe, expect, it } from "vitest";
import {
  BULK_MAX_IDS,
  bulkDeleteSchema,
  bulkSchema,
  chunk,
  platformSuggestions,
  replatform,
  retag,
} from "@/lib/bulk";
import { COMMON_PLATFORMS } from "@/lib/platforms";
import { buildSearchText } from "@/lib/utils";

const firstError = (result: { success: boolean; error?: { issues: { message: string }[] } }) =>
  result.success ? null : result.error?.issues[0]?.message;

const ids = (n: number) => Array.from({ length: n }, (_, i) => `game${i}`);

describe("retag", () => {
  it("merges without duplicates and is null when nothing changes", () => {
    expect(retag(["rpg", "epic"], ["rpg", "replay"], [])).toEqual(["rpg", "epic", "replay"]);
    expect(retag(["rpg"], ["rpg"], [])).toBeNull();
    expect(retag(["rpg"], [], ["sci-fi"])).toBeNull();
    expect(retag([], [], [])).toBeNull();
  });

  it("removes tags, alone or together with adding", () => {
    expect(retag(["rpg", "epic", "owned"], [], ["epic"])).toEqual(["rpg", "owned"]);
    expect(retag(["rpg", "epic"], ["replay"], ["rpg"])).toEqual(["epic", "replay"]);
  });
});

describe("replatform", () => {
  const game = {
    title: "Pokémon Legends: Arceus",
    developers: ["Game Freak"],
    seriesName: "Pokémon",
    platform: "Switch",
    searchText: buildSearchText("Pokémon Legends: Arceus", ["Game Freak"], "Pokémon", "Switch"),
  };

  it("rebuilds searchText around the new platform", () => {
    expect(replatform(game, "Nintendo Switch 2")).toEqual({
      platform: "Nintendo Switch 2",
      searchText: "pokemon legends: arceus game freak pokemon nintendo switch 2",
    });
  });

  it("clears the platform out of searchText too", () => {
    expect(replatform(game, null)).toEqual({
      platform: null,
      searchText: "pokemon legends: arceus game freak pokemon",
    });
  });

  it("is null when the game already says exactly that", () => {
    expect(replatform(game, "Switch")).toBeNull();
    const none = {
      ...game,
      platform: null,
      searchText: buildSearchText(game.title, game.developers, game.seriesName),
    };
    expect(replatform(none, null)).toBeNull();
  });

  it("still writes a change of case, and a searchText out of step", () => {
    expect(replatform(game, "switch")?.platform).toBe("switch");
    expect(replatform({ ...game, searchText: "stale" }, "Switch")).toEqual({
      platform: "Switch",
      searchText: game.searchText,
    });
    // An empty string stored by an old import is not the same as no platform.
    expect(replatform({ ...game, platform: "" }, null)?.platform).toBeNull();
  });
});

describe("platformSuggestions", () => {
  it("puts the library's platforms first, then the common ones", () => {
    const list = platformSuggestions(["Amiga", "PS5"]);
    expect(list.slice(0, 3)).toEqual(["Amiga", "PS5", COMMON_PLATFORMS[0]]);
    expect(list).toHaveLength(2 + COMMON_PLATFORMS.length);
  });

  it("keeps the library's spelling over a common one in another case", () => {
    const list = platformSuggestions(["pc", "nintendo switch"]);
    expect(list.slice(0, 2)).toEqual(["pc", "nintendo switch"]);
    expect(list).not.toContain("PC");
    expect(list).not.toContain("Nintendo Switch");
    expect(list).toHaveLength(COMMON_PLATFORMS.length);
  });

  it("trims names and skips blanks and repeats", () => {
    expect(platformSuggestions([" Amiga ", "", "  ", "amiga"]).slice(0, 2)).toEqual([
      "Amiga",
      COMMON_PLATFORMS[0],
    ]);
  });

  it("offers the common platforms for an empty library", () => {
    expect(platformSuggestions([])).toEqual([...COMMON_PLATFORMS]);
  });
});

describe("chunk", () => {
  it("splits into runs of the given size", () => {
    const parts = chunk(ids(2500), 1000);
    expect(parts.map((p) => p.length)).toEqual([1000, 1000, 500]);
    expect(parts.flat()).toEqual(ids(2500));
  });

  it("gives nothing for nothing", () => {
    expect(chunk([], 1000)).toEqual([]);
  });
});

describe("bulkSchema", () => {
  it("takes 2,000 ids and refuses 2,001 with a readable message", () => {
    expect(BULK_MAX_IDS).toBe(2000);
    expect(bulkSchema.safeParse({ gameIds: ids(2000), status: "COMPLETED" }).success).toBe(true);
    expect(firstError(bulkSchema.safeParse({ gameIds: ids(2001), status: "COMPLETED" }))).toBe(
      "That's more than 2,000 games. Use “Select all games that match” instead.",
    );
  });

  it("wants exactly one of ids or filters", () => {
    const message = "Select some games first.";
    expect(firstError(bulkSchema.safeParse({ status: "COMPLETED" }))).toBe(message);
    expect(firstError(bulkSchema.safeParse({ gameIds: [], status: "COMPLETED" }))).toBe(message);
    expect(
      firstError(bulkSchema.safeParse({ gameIds: ["a"], matching: { tag: "x" }, status: "COMPLETED" })),
    ).toBe(message);
    expect(bulkSchema.safeParse({ matching: { tag: "x" }, status: "COMPLETED" }).success).toBe(true);
  });

  it("names a tag that is both added and removed", () => {
    expect(
      firstError(bulkSchema.safeParse({ gameIds: ["a"], addTags: ["Epic"], removeTags: ["epic "] })),
    ).toBe("“epic” is in both Add tags and Remove tags.");
  });

  it("trims and lowercases tags, and explains a tag that is too long", () => {
    const parsed = bulkSchema.parse({ gameIds: ["a"], addTags: ["  Roguelike "], removeTags: ["OLD"] });
    expect(parsed.addTags).toEqual(["roguelike"]);
    expect(parsed.removeTags).toEqual(["old"]);
    expect(firstError(bulkSchema.safeParse({ gameIds: ["a"], removeTags: ["x".repeat(51)] }))).toBe(
      "Tags can be at most 50 characters.",
    );
  });

  it("trims a platform, turns an empty one into clearing it, and leaves it out when not given", () => {
    expect(bulkSchema.parse({ gameIds: ["a"], platform: "  Steam Deck " }).platform).toBe("Steam Deck");
    expect(bulkSchema.parse({ gameIds: ["a"], platform: "   " }).platform).toBeNull();
    expect(bulkSchema.parse({ gameIds: ["a"], platform: null }).platform).toBeNull();
    expect(bulkSchema.parse({ gameIds: ["a"], status: "COMPLETED" }).platform).toBeUndefined();
  });

  it("explains a platform that is too long", () => {
    expect(bulkSchema.safeParse({ gameIds: ["a"], platform: "x".repeat(100) }).success).toBe(true);
    expect(firstError(bulkSchema.safeParse({ gameIds: ["a"], platform: "x".repeat(101) }))).toBe(
      "A platform can be at most 100 characters.",
    );
  });

  it("explains a search too long to send", () => {
    expect(
      firstError(bulkSchema.safeParse({ matching: { q: "x".repeat(2001) }, status: "COMPLETED" })),
    ).toBe("That search is too long to apply to every match.");
  });
});

describe("bulkDeleteSchema", () => {
  it("needs the count shown when deleting every match", () => {
    expect(bulkDeleteSchema.safeParse({ matching: { tag: "x" } }).success).toBe(false);
    expect(bulkDeleteSchema.safeParse({ matching: { tag: "x" }, expectedCount: 3 }).success).toBe(true);
    expect(bulkDeleteSchema.safeParse({ gameIds: ["a", "b"] }).success).toBe(true);
  });
});
