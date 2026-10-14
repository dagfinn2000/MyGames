import { describe, expect, it } from "vitest";
import { ReadingStatus } from "@prisma/client";
import { isNextInSeries, nextInSeries, seriesKey } from "@/lib/series";

const { WANT_TO_READ, READING, READ, DNF } = ReadingStatus;
const game = (seriesNumber: number | null, status: ReadingStatus, timesRead = 0) => ({
  seriesNumber,
  status,
  timesRead,
});

describe("nextInSeries", () => {
  it("is the lowest-numbered game not read yet", () => {
    const games = [game(3, WANT_TO_READ), game(1, READ), game(2, WANT_TO_READ)];
    expect(nextInSeries(games)).toBe(games[2]);
  });

  it("is the game being read when that comes first", () => {
    const games = [game(1, READ), game(2, READING), game(3, WANT_TO_READ)];
    expect(nextInSeries(games)).toBe(games[1]);
  });

  it("skips a game put down or read before, and numbers read in another copy", () => {
    const games = [
      game(1, WANT_TO_READ),
      game(1, READ),
      game(2, DNF),
      game(3, READING, 1), // a re-read
      game(4, WANT_TO_READ),
    ];
    expect(nextInSeries(games)).toBe(games[4]);
  });

  it("ignores unnumbered games and is null when all are done", () => {
    expect(nextInSeries([game(null, WANT_TO_READ), game(1, READ)])).toBeNull();
    expect(nextInSeries([])).toBeNull();
  });
});

describe("isNextInSeries", () => {
  const series = [game(1, READ), game(2, WANT_TO_READ), game(3, WANT_TO_READ)];

  it("lets the next game through and holds back later ones", () => {
    expect(isNextInSeries(series[1], series)).toBe(true);
    expect(isNextInSeries(series[2], series)).toBe(false);
  });

  it("never holds back an unnumbered game or one already read", () => {
    expect(isNextInSeries(game(null, WANT_TO_READ), series)).toBe(true);
    expect(isNextInSeries(game(5, READ), series)).toBe(true);
  });

  it("works when the game isn't in the list it's given", () => {
    expect(isNextInSeries(game(2, WANT_TO_READ), [game(1, READ)])).toBe(true);
    expect(isNextInSeries(game(2, WANT_TO_READ), [game(1, READING)])).toBe(false);
  });
});

describe("seriesKey", () => {
  it("ignores case and stray spaces", () => {
    expect(seriesKey(" The Expanse ")).toBe(seriesKey("the expanse"));
  });
});
