import { afterEach, describe, expect, it, vi } from "vitest";
import {
  isLibraryHref,
  noteAction,
  parseLibraryReturn,
  previousEntryIs,
} from "./library-return";

describe("isLibraryHref", () => {
  it("accepts the library, with or without a query, and the reading room", () => {
    expect(isLibraryHref("/games")).toBe(true);
    expect(isLibraryHref("/games?sort=title&shelf=COMPLETED")).toBe(true);
    expect(isLibraryHref("/room")).toBe(true);
  });

  it("rejects game pages, other pages and other sites", () => {
    expect(isLibraryHref("/games/abc123")).toBe(false);
    expect(isLibraryHref("/games/new")).toBe(false);
    expect(isLibraryHref("/booksx")).toBe(false);
    expect(isLibraryHref("/playing")).toBe(false);
    expect(isLibraryHref("/room/x")).toBe(false);
    expect(isLibraryHref("//evil.example/games")).toBe(false);
    expect(isLibraryHref("https://evil.example/games")).toBe(false);
  });
});

describe("noteAction", () => {
  it("writes a note when a game is opened from the library or the reading room", () => {
    expect(noteAction("/games")).toBe("write");
    expect(noteAction("/room")).toBe("write");
  });

  it("keeps it when one game's series strip opens another", () => {
    expect(noteAction("/games/abc123")).toBe("keep");
  });

  it("forgets it when a game is opened from anywhere else", () => {
    expect(noteAction("/playing")).toBe("forget");
    expect(noteAction("/stats/year/2026")).toBe("forget");
    expect(noteAction("/games/new")).toBe("forget");
    expect(noteAction("/games/check")).toBe("forget");
    expect(noteAction("/games/abc123/edit")).toBe("forget");
  });
});

describe("parseLibraryReturn", () => {
  const note = { gameId: "b1", href: "/games?sort=title", scrollY: 1200, coverY: 1460 };

  it("reads a note for this game", () => {
    expect(parseLibraryReturn(JSON.stringify(note), "b1")).toEqual(note);
  });

  it("ignores a note for another game, or none at all", () => {
    expect(parseLibraryReturn(JSON.stringify(note), "b2")).toBeNull();
    expect(parseLibraryReturn(null, "b1")).toBeNull();
  });

  it("ignores a note that isn't JSON, or points anywhere but the library", () => {
    expect(parseLibraryReturn("{not json", "b1")).toBeNull();
    expect(parseLibraryReturn("null", "b1")).toBeNull();
    expect(parseLibraryReturn(JSON.stringify({ ...note, href: "/games/b1" }), "b1")).toBeNull();
    expect(parseLibraryReturn(JSON.stringify({ ...note, href: "https://x.example" }), "b1")).toBeNull();
    expect(parseLibraryReturn(JSON.stringify({ ...note, href: 7 }), "b1")).toBeNull();
  });

  it("falls back to the top for scroll positions it can't use", () => {
    const parsed = parseLibraryReturn(
      JSON.stringify({ gameId: "b1", href: "/games", scrollY: "far", coverY: null }),
      "b1",
    );
    expect(parsed).toEqual({ gameId: "b1", href: "/games", scrollY: 0, coverY: 0 });
    expect(
      parseLibraryReturn(JSON.stringify({ ...note, scrollY: -40 }), "b1")?.scrollY,
    ).toBe(0);
  });
});

describe("previousEntryIs", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function stubHistory(urls: string[], index: number, withNavigation = true) {
    vi.stubGlobal("location", { origin: "https://reads.example" });
    vi.stubGlobal(
      "window",
      withNavigation
        ? { navigation: { currentEntry: { index }, entries: () => urls.map((url) => ({ url })) } }
        : {},
    );
  }

  it("is true when the entry before this one is that library page", () => {
    stubHistory(["https://reads.example/games?sort=title", "https://reads.example/games/b1"], 1);
    expect(previousEntryIs("/games?sort=title")).toBe(true);
  });

  it("is false when the library's filters were different", () => {
    stubHistory(["https://reads.example/games?sort=author", "https://reads.example/games/b1"], 1);
    expect(previousEntryIs("/games?sort=title")).toBe(false);
  });

  it("is false when something came in between, like the edit page", () => {
    stubHistory(
      [
        "https://reads.example/games",
        "https://reads.example/games/b1",
        "https://reads.example/games/b1/edit",
        "https://reads.example/games/b1",
      ],
      3,
    );
    expect(previousEntryIs("/games")).toBe(false);
  });

  it("is false on the first entry, or without the Navigation API", () => {
    stubHistory(["https://reads.example/games/b1"], 0);
    expect(previousEntryIs("/games")).toBe(false);
    stubHistory(["https://reads.example/games", "https://reads.example/games/b1"], 1, false);
    expect(previousEntryIs("/games")).toBe(false);
  });
});
