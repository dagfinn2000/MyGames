import { describe, expect, it } from "vitest";
import {
  copyLabels,
  isSameGame,
  libraryMatcher,
  timesPhrase,
  type LibraryGame,
} from "@/lib/library-match";

function game(over: Partial<LibraryGame> & Pick<LibraryGame, "id" | "title">): LibraryGame {
  return { platform: null, catalogueId: null, ...over };
}

describe("isSameGame", () => {
  it("goes by the entry when both are from the same catalogue", () => {
    // A title edited on one side doesn't hide it…
    expect(
      isSameGame(
        { title: "Hollow Knight (Voidheart Edition)", catalogueId: "igdb:hollow-knight" },
        { title: "Hollow Knight", catalogueId: "igdb:hollow-knight" },
      ),
    ).toBe(true);
    // …and a shared title doesn't make two entries one game.
    expect(
      isSameGame(
        { title: "Doom", catalogueId: "igdb:doom" },
        { title: "DOOM", catalogueId: "igdb:doom--1" },
      ),
    ).toBe(false);
  });

  it("goes by the title when the ids are from different catalogues", () => {
    expect(
      isSameGame(
        { title: "Hollow Knight", catalogueId: "steam:367520" },
        { title: "Hollow Knight", catalogueId: "igdb:hollow-knight" },
      ),
    ).toBe(true);
    expect(
      isSameGame(
        { title: "Hollow Knight: Silksong", catalogueId: "steam:1030300" },
        { title: "Hollow Knight", catalogueId: "igdb:hollow-knight" },
      ),
    ).toBe(false);
  });

  it("goes by the title when either side has no catalogue id", () => {
    expect(
      isSameGame(
        { title: "The Witcher® 3: Wild Hunt" },
        { title: "the witcher 3 wild hunt", catalogueId: "igdb:the-witcher-3-wild-hunt" },
      ),
    ).toBe(true);
    expect(
      isSameGame({ title: "Ratchet & Clank", catalogueId: null }, { title: "Ratchet and Clank" }),
    ).toBe(true);
    expect(isSameGame({ title: "Portal 2" }, { title: "Portal" })).toBe(false);
  });

  it("tells a remake from the original by the year, when both have one", () => {
    // Across catalogues, and with one side typed in by hand…
    expect(
      isSameGame(
        { title: "Resident Evil 4", catalogueId: "steam:2050650", releaseDate: "2023-03-24" },
        { title: "Resident Evil 4", catalogueId: "igdb:resident-evil-4", releaseDate: "2005-01-11" },
      ),
    ).toBe(false);
    expect(
      isSameGame(
        { title: "Doom", releaseDate: "1993" },
        { title: "DOOM", catalogueId: "steam:379720", releaseDate: "2016-05-13" },
      ),
    ).toBe(false);
    expect(
      isSameGame(
        { title: "Resident Evil 4", catalogueId: "steam:2050650", releaseDate: "2023-03-24" },
        { title: "Resident Evil 4", catalogueId: "igdb:resident-evil-4--1", releaseDate: "2023" },
      ),
    ).toBe(true);
    // …but within a catalogue the entry still decides, whatever the dates.
    expect(
      isSameGame(
        { title: "Doom", catalogueId: "igdb:doom", releaseDate: "1993" },
        { title: "Doom", catalogueId: "igdb:doom", releaseDate: "1994" },
      ),
    ).toBe(true);
  });

  it("goes by the title alone when either side has no year", () => {
    expect(
      isSameGame(
        { title: "Hollow Knight", catalogueId: "steam:367520" },
        { title: "Hollow Knight", catalogueId: "igdb:hollow-knight", releaseDate: "2017-02-24" },
      ),
    ).toBe(true);
    expect(isSameGame({ title: "Celeste", releaseDate: "" }, { title: "Celeste", releaseDate: "2018" })).toBe(
      true,
    );
  });

  it("treats an id that isn't a catalogue id as none", () => {
    expect(
      isSameGame(
        { title: "Celeste", catalogueId: "igdb:celeste" },
        { title: "Celeste", catalogueId: "goodreads:42" },
      ),
    ).toBe(true);
  });

  it("never matches on a title with nothing left to compare", () => {
    expect(isSameGame({ title: "" }, { title: "" })).toBe(false);
    expect(isSameGame({ title: "™" }, { title: "®" })).toBe(false);
  });
});

describe("libraryMatcher", () => {
  const library: LibraryGame[] = [
    game({ id: "a", title: "Hollow Knight", platform: "Nintendo Switch", catalogueId: "igdb:hollow-knight" }),
    game({ id: "b", title: "Celeste", platform: "PC" }),
    game({ id: "c", title: "Hollow Knight", platform: "PC", catalogueId: "steam:367520" }),
    game({ id: "d", title: "Doom", platform: "PC", catalogueId: "igdb:doom", releaseDate: "1993-12-10" }),
    game({ id: "e", title: "Untitled goose (my notes)", catalogueId: "igdb:untitled-goose-game" }),
  ];
  const find = libraryMatcher(library);
  const ids = (found: LibraryGame[]) => found.map((g) => g.id);

  it("finds the game on every platform it's in the library on, in library order", () => {
    expect(ids(find({ title: "Hollow Knight", catalogueId: "igdb:hollow-knight" }))).toEqual(["a", "c"]);
    expect(ids(find({ title: "HOLLOW KNIGHT™" }))).toEqual(["a", "c"]);
  });

  it("finds a game by its entry even under another title", () => {
    expect(ids(find({ title: "Untitled Goose Game", catalogueId: "igdb:untitled-goose-game" }))).toEqual(["e"]);
  });

  it("finds a game typed in by hand by its title", () => {
    expect(ids(find({ title: "Celeste", catalogueId: "steam:504230" }))).toEqual(["b"]);
  });

  it("leaves out another entry of the same catalogue that shares the title", () => {
    expect(ids(find({ title: "DOOM", catalogueId: "igdb:doom--1" }))).toEqual([]);
  });

  it("leaves out a game of the same title from another year, from any catalogue", () => {
    // Doom (2016) as Steam's entry gives it once picked, and as Wikipedia lists it.
    expect(ids(find({ title: "DOOM", catalogueId: "steam:379720", releaseDate: "2016-05-13" }))).toEqual([]);
    expect(ids(find({ title: "Doom", catalogueId: "wikidata:Q20647981", releaseDate: "2016" }))).toEqual([]);
    expect(ids(find({ title: "Doom", catalogueId: "wikidata:Q513867", releaseDate: "1993" }))).toEqual(["d"]);
  });

  it("can't tell a result without a year from the game of its title", () => {
    // The trade-off, not a wish: Steam's search gives no year, and its
    // "DOOM" (2016) could as well be the library's 1993 game. Only picking
    // it, which brings the entry's date, tells them apart (above).
    expect(ids(find({ title: "DOOM", catalogueId: "steam:379720" }))).toEqual(["d"]);
  });

  it("finds nothing for a game that isn't there", () => {
    expect(find({ title: "Hollow Knight: Silksong", catalogueId: "igdb:hollow-knight-silksong" })).toEqual([]);
    expect(find({ title: "" })).toEqual([]);
    expect(libraryMatcher([])({ title: "Celeste" })).toEqual([]);
  });

  it("agrees with isSameGame", () => {
    const candidates = [
      { title: "Hollow Knight", catalogueId: "steam:367520" },
      { title: "doom", catalogueId: "igdb:doom" },
      { title: "Doom", catalogueId: "wikidata:Q513867" },
      { title: "Doom", catalogueId: "wikidata:Q20647981", releaseDate: "2016" },
      { title: "Hollow Knight", releaseDate: "2018" },
      { title: "Celeste", releaseDate: "2018" },
      { title: "Untitled goose (my notes)", catalogueId: "igdb:something-else" },
    ];
    for (const c of candidates) {
      expect(ids(find(c))).toEqual(ids(library.filter((g) => isSameGame(c, g))));
    }
  });
});

describe("copyLabels", () => {
  it("names each copy by its platform, or by the caller's phrase for none", () => {
    expect(
      copyLabels([{ platform: "Nintendo Switch" }, { platform: " PC " }, { platform: null }], "no platform"),
    ).toEqual(["Nintendo Switch", "PC", "no platform"]);
    expect(copyLabels([{ platform: "  " }, { platform: "PC" }], "one without a platform")).toEqual([
      "one without a platform",
      "PC",
    ]);
  });

  it("numbers copies that would share a name, in order", () => {
    expect(
      copyLabels(
        [{ platform: "PC" }, { platform: "Nintendo Switch" }, { platform: "PC " }, { platform: null }, { platform: "" }],
        "no platform",
      ),
    ).toEqual(["PC (1)", "Nintendo Switch", "PC (2)", "no platform (1)", "no platform (2)"]);
  });
});

describe("timesPhrase", () => {
  it("says twice, then counts", () => {
    expect(timesPhrase(2)).toBe("twice");
    expect(timesPhrase(3)).toBe("3 times");
  });
});
