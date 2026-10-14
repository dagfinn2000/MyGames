import { describe, expect, it } from "vitest";
import { canonicalViewQuery, canonicalViewQueryFromString } from "@/lib/saved-views";

describe("canonicalViewQuery", () => {
  it("keeps filters in a fixed order with the view last", () => {
    expect(
      canonicalViewQuery({ sort: "title", tag: "roguelike", shelf: "COMPLETED", dir: "asc" }),
    ).toBe("shelf=COMPLETED&tag=roguelike&group=none&sort=title&dir=asc");
  });

  it("leaves out defaults and parameters the library doesn't know", () => {
    expect(canonicalViewQuery({ shelf: "all", owned: "all", limit: "500", x: "1" })).toBe(
      "group=none&sort=createdAt&dir=desc",
    );
  });

  it("gives the same string for the same view however it was written", () => {
    expect(canonicalViewQueryFromString("dir=asc&sort=title&q=+zelda+&group=none")).toBe(
      canonicalViewQuery({ q: "zelda", sort: "title", dir: "asc" }),
    );
  });

  it("puts the newer filters in their place, before the view", () => {
    expect(
      canonicalViewQuery({
        missing: "cover",
        finished: "2024",
        notTag: "horror",
        platform: "Nintendo Switch",
        tagMatch: "all",
        tag: "platformer,classic",
        developer: "Team Cherry",
        minRating: "unrated",
        q: "knight",
        sort: "rating",
        dir: "desc",
      }),
    ).toBe(
      "q=knight&developer=Team+Cherry&tag=classic%2Cplatformer&tagMatch=all&notTag=horror" +
        "&platform=Nintendo+Switch&minRating=unrated&finished=2024&missing=cover" +
        "&group=none&sort=rating&dir=desc",
    );
  });

  it("treats the same tags in any order as one view", () => {
    expect(canonicalViewQuery({ tag: "b,a", notTag: "d,c" })).toBe(
      canonicalViewQuery({ tag: "a,b", notTag: "c,d" }),
    );
  });

  it("leaves out tag matching unless it's 'all' with tags to match", () => {
    expect(canonicalViewQuery({ tagMatch: "all" })).toBe("group=none&sort=createdAt&dir=desc");
    expect(canonicalViewQuery({ tag: "a", tagMatch: "any" })).toBe(
      "tag=a&group=none&sort=createdAt&dir=desc",
    );
  });

  it("opens a sort without a direction its natural way round, like the library", () => {
    expect(canonicalViewQuery({ sort: "title" })).toBe("group=none&sort=title&dir=asc");
    expect(canonicalViewQuery({ sort: "length" })).toBe("group=none&sort=length&dir=desc");
    expect(canonicalViewQuery({ sort: "developer" })).toBe("group=none&sort=developer&dir=asc");
    expect(canonicalViewQuery({ sort: "constructor" })).toBe("group=none&sort=createdAt&dir=desc");
  });
});
