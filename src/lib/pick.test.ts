import { describe, expect, it } from "vitest";
import { GameOwnership, PlayStatus } from "@prisma/client";
import {
  chooseRandom,
  pickButtonTitle,
  pickPool,
  tabStatus,
  type PickRow,
  type PickRules,
} from "@/lib/pick";

const { WANT_TO_PLAY, PLAYING, COMPLETED, DROPPED } = PlayStatus;
const { OWNED, WISHLIST, BORROWED, GIVEN_AWAY } = GameOwnership;

let n = 0;
function row(over: Partial<PickRow> = {}): PickRow {
  n += 1;
  return {
    id: `b${n}`,
    status: WANT_TO_PLAY,
    ownership: OWNED,
    seriesName: null,
    seriesNumber: null,
    timesCompleted: 0,
    lent: false,
    ...over,
  };
}

const ALL: PickRules = { tab: null, onlyHave: false, nextInSeries: false };
const ids = (rows: PickRow[]) => rows.map((r) => r.id);

describe("tabStatus", () => {
  it("knows the status tabs and nothing else", () => {
    expect(tabStatus("COMPLETED")).toBe(COMPLETED);
    expect(tabStatus("WANT_TO_PLAY")).toBe(WANT_TO_PLAY);
    expect(tabStatus("all")).toBeNull();
    expect(tabStatus("")).toBeNull();
    expect(tabStatus("playing")).toBeNull();
    expect(tabStatus(undefined)).toBeNull();
  });
});

describe("pickPool tabs", () => {
  it("prefers Want to Play on the All tab", () => {
    const want = row();
    const done = row({ status: COMPLETED });
    expect(pickPool([want, done], ALL)).toEqual([want]);
  });

  it("falls back to every game on the All tab when none are Want to Play", () => {
    const rows = [row({ status: COMPLETED }), row({ status: DROPPED })];
    expect(pickPool(rows, ALL)).toEqual(rows);
  });

  it("never swaps a status tab for Want to Play", () => {
    // The bug: on the Completed tab the old pick opened a Want to Play game.
    // The tab's own filter decides the rows; the pool must not narrow them.
    const rows = [row({ status: COMPLETED }), row({ status: COMPLETED })];
    expect(pickPool(rows, { ...ALL, tab: COMPLETED })).toEqual(rows);
  });
});

describe("pickPool: only games I have", () => {
  const rules = { ...ALL, tab: COMPLETED, onlyHave: true };

  it("keeps owned and borrowed games, drops wishlist and given away", () => {
    const owned = row({ ownership: OWNED });
    const borrowed = row({ ownership: BORROWED });
    const rows = [owned, borrowed, row({ ownership: WISHLIST }), row({ ownership: GIVEN_AWAY })];
    expect(ids(pickPool(rows, rules))).toEqual([owned.id, borrowed.id]);
  });

  it("drops a game that is lent out", () => {
    const home = row();
    expect(ids(pickPool([home, row({ lent: true })], rules))).toEqual([home.id]);
  });

  it("applies before the All tab's Want to Play preference", () => {
    // Every Want to Play game is on the wishlist, so the pick falls back to
    // the rest instead of opening one you don't have.
    const done = row({ status: COMPLETED });
    const rows = [row({ ownership: WISHLIST }), done];
    expect(pickPool(rows, { ...ALL, onlyHave: true })).toEqual([done]);
  });
});

describe("pickPool: only the next game in a series", () => {
  const rules = { ...ALL, tab: WANT_TO_PLAY, nextInSeries: true };
  const halo = (seriesNumber: number | null, over: Partial<PickRow> = {}) =>
    row({ seriesName: "Halo", seriesNumber, ...over });

  it("keeps the next unplayed game and holds back later ones", () => {
    const one = halo(1, { status: COMPLETED });
    const two = halo(2);
    const three = halo(3);
    expect(ids(pickPool([two, three], rules, [one, two, three]))).toEqual([two.id]);
  });

  it("works from the candidate rows alone when no series list is given", () => {
    const two = halo(2);
    const three = halo(3);
    expect(ids(pickPool([two, three], rules))).toEqual([two.id]);
  });

  it("never holds back a game that isn't Want to Play", () => {
    const one = halo(1);
    const playing = halo(3, { status: PLAYING });
    expect(ids(pickPool([playing], { ...rules, tab: PLAYING }, [one, playing]))).toEqual([
      playing.id,
    ]);
  });

  it("counts a replay in progress as completed, and a game being played as not yet", () => {
    expect(pickPool([halo(2)], rules, [halo(1, { status: PLAYING, timesCompleted: 1 })])).toHaveLength(1);
    expect(pickPool([halo(2)], rules, [halo(1, { status: PLAYING })])).toHaveLength(0);
  });

  it("counts a number as completed when any copy of it is", () => {
    const two = halo(2);
    const series = [halo(1), halo(1, { status: COMPLETED }), two];
    expect(ids(pickPool([two], rules, series))).toEqual([two.id]);
  });

  it("matches series names whatever their case or stray spaces", () => {
    const two = halo(2);
    const series = [row({ seriesName: "  halo ", seriesNumber: 1 }), two];
    expect(pickPool([two], rules, series)).toHaveLength(0);
  });

  it("ignores unnumbered games both ways, and compares numbers as numbers", () => {
    const loose = halo(null);
    expect(pickPool([loose], rules, [halo(1)])).toEqual([loose]);
    expect(pickPool([halo(2)], rules, [halo(null)])).toHaveLength(1);

    const prequel = halo(0);
    const half = halo(1.5);
    expect(ids(pickPool([prequel, half, halo(2)], rules))).toEqual([prequel.id]);
  });

  it("leaves other series alone", () => {
    const other = row({ seriesName: "Mass Effect", seriesNumber: 2 });
    expect(pickPool([other], rules, [halo(1)])).toEqual([other]);
  });

  it("can leave nothing, with both switches on", () => {
    // #1 is only wishlisted: it isn't had, and it blocks #2.
    const one = halo(1, { ownership: WISHLIST });
    const two = halo(2);
    expect(pickPool([one, two], { ...rules, onlyHave: true }, [one, two])).toEqual([]);
  });

  it("falls back to other games on the All tab when every Want to Play waits", () => {
    const done = row({ status: COMPLETED });
    const rows = [halo(2), done];
    expect(pickPool(rows, { ...ALL, nextInSeries: true }, [halo(1)])).toEqual([done]);
  });
});

describe("chooseRandom", () => {
  it("covers the whole list and never runs off the end", () => {
    expect(chooseRandom(["a", "b", "c"], () => 0)).toBe("a");
    expect(chooseRandom(["a", "b", "c"], () => 0.999)).toBe("c");
    expect(chooseRandom(["a", "b", "c"], () => 1)).toBe("c");
  });

  it("is null for an empty list", () => {
    expect(chooseRandom([], () => 0.5)).toBeNull();
  });
});

describe("pickButtonTitle", () => {
  const off = { pickOnlyHave: false, pickNextInSeries: false };

  it("says where the pick comes from", () => {
    expect(pickButtonTitle(null, off)).toBe(
      "Open a random game, from Want to Play when there is one (respects your filters)",
    );
    expect(pickButtonTitle(COMPLETED, off)).toBe(
      "Open a random game from Completed (respects your filters)",
    );
  });

  it("lists the switches that are on", () => {
    expect(pickButtonTitle(PLAYING, { ...off, pickOnlyHave: true })).toBe(
      "Open a random game from Playing (respects your filters and only games you have)",
    );
    expect(pickButtonTitle(null, { pickOnlyHave: true, pickNextInSeries: true })).toBe(
      "Open a random game, from Want to Play when there is one (respects your filters, " +
        "only games you have and only the next game in each series)",
    );
  });
});
