import { describe, expect, it } from "vitest";
import {
  DEFAULT_LIBRARY_VIEW,
  LIBRARY_GROUPS,
  LIBRARY_SORTS,
  NATURAL_DIRS,
  cleanLibraryViewPatch,
  naturalDir,
  parseLibraryView,
} from "@/lib/library-view";

describe("parseLibraryView", () => {
  it("passes a fully valid stored view through", () => {
    expect(
      parseLibraryView({ sort: "developer", dir: "asc", group: "series" }),
    ).toEqual({ ...DEFAULT_LIBRARY_VIEW, sort: "developer", dir: "asc", group: "series" });
  });

  it("returns defaults for null/undefined (never-saved accounts)", () => {
    expect(parseLibraryView(null)).toEqual(DEFAULT_LIBRARY_VIEW);
    expect(parseLibraryView(undefined)).toEqual(DEFAULT_LIBRARY_VIEW);
  });

  it("defaults each unknown field individually", () => {
    // e.g. a sort option removed in a later version — the rest must survive.
    expect(parseLibraryView({ sort: "bogus", dir: "asc", group: "platform" })).toEqual({
      ...DEFAULT_LIBRARY_VIEW,
      sort: DEFAULT_LIBRARY_VIEW.sort,
      dir: "asc",
      group: "platform",
    });
  });

  it("survives non-object garbage", () => {
    expect(parseLibraryView("title")).toEqual(DEFAULT_LIBRARY_VIEW);
    expect(parseLibraryView(42)).toEqual(DEFAULT_LIBRARY_VIEW);
    expect(parseLibraryView([])).toEqual(DEFAULT_LIBRARY_VIEW);
  });

  it("ignores non-string field values", () => {
    expect(parseLibraryView({ sort: 3, dir: null, group: {} })).toEqual(
      DEFAULT_LIBRARY_VIEW,
    );
  });

  it("keeps display settings and defaults bad ones", () => {
    expect(
      parseLibraryView({
        cardSize: "small",
        layout: "list",
        showRating: false,
        showStatus: "no",
        showSeries: false,
      }),
    ).toEqual({
      ...DEFAULT_LIBRARY_VIEW,
      cardSize: "small",
      layout: "list",
      showRating: false,
      showSeries: false,
    });
    expect(parseLibraryView({ cardSize: "huge", layout: 1 })).toEqual(DEFAULT_LIBRARY_VIEW);
  });

  it("keeps the card style and 3D covers and defaults bad ones", () => {
    expect(parseLibraryView({ cardStyle: "shelf", cover3d: true })).toEqual({
      ...DEFAULT_LIBRARY_VIEW,
      cardStyle: "shelf",
      cover3d: true,
    });
    expect(parseLibraryView({ cardStyle: "tiles", cover3d: "yes" })).toEqual(
      DEFAULT_LIBRARY_VIEW,
    );
  });
});

describe("cleanLibraryViewPatch", () => {
  it("keeps only the fields given, made valid", () => {
    expect(cleanLibraryViewPatch({ layout: "list" })).toEqual({ layout: "list" });
    expect(cleanLibraryViewPatch({ cardSize: "huge", sort: "title" })).toEqual({
      cardSize: "medium",
      sort: "title",
    });
  });

  it("cleans the card style and 3D switch like the other display fields", () => {
    expect(cleanLibraryViewPatch({ cardStyle: "covers" })).toEqual({ cardStyle: "covers" });
    expect(cleanLibraryViewPatch({ cardStyle: "tiles", cover3d: 1 })).toEqual({
      cardStyle: "cards",
      cover3d: false,
    });
  });

  it("drops unknown keys and garbage", () => {
    expect(cleanLibraryViewPatch({ evil: 1 })).toEqual({});
    expect(cleanLibraryViewPatch(JSON.parse('{"constructor": 1, "toString": "x"}'))).toEqual({});
    expect(cleanLibraryViewPatch(null)).toEqual({});
    expect(cleanLibraryViewPatch("list")).toEqual({});
  });
});

describe("the newer sorts, groupings and display options", () => {
  it("accepts each sort and grouping", () => {
    for (const sort of LIBRARY_SORTS) expect(parseLibraryView({ sort }).sort).toBe(sort);
    for (const group of LIBRARY_GROUPS) expect(parseLibraryView({ group }).group).toBe(group);
  });

  it("gives every sort a natural direction", () => {
    for (const sort of LIBRARY_SORTS) expect(NATURAL_DIRS[sort]).toMatch(/^(asc|desc)$/);
    expect(naturalDir("title")).toBe("asc");
    expect(naturalDir("developer")).toBe("asc");
    expect(naturalDir("rating")).toBe("desc");
    expect(naturalDir("length")).toBe("desc");
    expect(naturalDir("released")).toBe("desc");
    expect(naturalDir("bogus")).toBe("desc");
    // Straight from the URL: never a property of Object.prototype.
    expect(naturalDir("constructor")).toBe("desc");
    expect(naturalDir("__proto__")).toBe("desc");
    expect(naturalDir("toString")).toBe("desc");
  });

  it("parses the list-row, platform and ownership options", () => {
    expect(parseLibraryView({})).toMatchObject({
      showPlatform: true,
      showOwnership: false,
      rowDate: "none",
      showLength: false,
    });
    expect(
      parseLibraryView({
        showPlatform: false,
        showOwnership: true,
        rowDate: "finished",
        showLength: true,
      }),
    ).toMatchObject({ showPlatform: false, showOwnership: true, rowDate: "finished", showLength: true });
    expect(
      parseLibraryView({ rowDate: "started", showLength: "yes", showPlatform: 0 }),
    ).toMatchObject({
      rowDate: "none",
      showLength: false,
      showPlatform: true,
    });
    expect(cleanLibraryViewPatch({ rowDate: "added" })).toEqual({ rowDate: "added" });
    expect(cleanLibraryViewPatch({ showPlatform: false })).toEqual({ showPlatform: false });
  });

  it("shows the time played unless it was turned off, and sorts by it", () => {
    expect(parseLibraryView({}).showPlayed).toBe(true);
    expect(parseLibraryView({ showPlayed: false }).showPlayed).toBe(false);
    expect(parseLibraryView({ showPlayed: "no" }).showPlayed).toBe(true);
    expect(cleanLibraryViewPatch({ showPlayed: false })).toEqual({ showPlayed: false });
    expect(parseLibraryView({ sort: "played" }).sort).toBe("played");
    expect(naturalDir("played")).toBe("desc");
  });
});
