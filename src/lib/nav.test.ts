import { describe, expect, it } from "vitest";
import { isNavActive } from "./nav";

describe("isNavActive", () => {
  it("marks the library on the library, a game and its edit page", () => {
    expect(isNavActive("/games", "/games")).toBe(true);
    expect(isNavActive("/games", "/games/abc123")).toBe(true);
    expect(isNavActive("/games", "/games/abc123/edit")).toBe(true);
  });

  it("leaves adding a game to its own link", () => {
    expect(isNavActive("/games", "/games/new")).toBe(false);
    expect(isNavActive("/games/new", "/games/new")).toBe(true);
    expect(isNavActive("/games/new", "/games")).toBe(false);
  });

  it("marks a section on its pages below it, and nothing else", () => {
    expect(isNavActive("/stats", "/stats/year/2025")).toBe(true);
    expect(isNavActive("/stats", "/statsx")).toBe(false);
    expect(isNavActive("/quotes", "/games")).toBe(false);
    expect(isNavActive("/playing", "/playing")).toBe(true);
    expect(isNavActive("/playing", "/games/abc123")).toBe(false);
  });
});
