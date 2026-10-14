import { describe, expect, it } from "vitest";
import { isNavActive } from "./nav";

describe("isNavActive", () => {
  it("marks the library on the library, a game and its edit page", () => {
    expect(isNavActive("/games", "/games")).toBe(true);
    expect(isNavActive("/games", "/games/abc123")).toBe(true);
    expect(isNavActive("/games", "/games/abc123/edit")).toBe(true);
  });

  it("leaves adding and checking a game to their own links", () => {
    expect(isNavActive("/games", "/games/new")).toBe(false);
    expect(isNavActive("/games", "/games/check")).toBe(false);
    expect(isNavActive("/games/new", "/games/new")).toBe(true);
    expect(isNavActive("/games/check", "/games/check")).toBe(true);
  });

  it("marks a section on its pages below it, and nothing else", () => {
    expect(isNavActive("/stats", "/stats/year/2025")).toBe(true);
    expect(isNavActive("/stats", "/statsx")).toBe(false);
    expect(isNavActive("/quotes", "/games")).toBe(false);
  });
});
