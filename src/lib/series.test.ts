import { describe, expect, it } from "vitest";
import { PlayStatus } from "@prisma/client";
import { isNextInSeries, nextInSeries, seriesKey } from "@/lib/series";

const { WANT_TO_PLAY, PLAYING, COMPLETED, DROPPED } = PlayStatus;
const game = (seriesNumber: number | null, status: PlayStatus, timesCompleted = 0) => ({
  seriesNumber,
  status,
  timesCompleted,
});

describe("nextInSeries", () => {
  it("is the lowest-numbered game not completed yet", () => {
    const games = [game(3, WANT_TO_PLAY), game(1, COMPLETED), game(2, WANT_TO_PLAY)];
    expect(nextInSeries(games)).toBe(games[2]);
  });

  it("is the game being played when that comes first", () => {
    const games = [game(1, COMPLETED), game(2, PLAYING), game(3, WANT_TO_PLAY)];
    expect(nextInSeries(games)).toBe(games[1]);
  });

  it("skips a game dropped or completed before, and numbers completed in another copy", () => {
    const games = [
      game(1, WANT_TO_PLAY),
      game(1, COMPLETED),
      game(2, DROPPED),
      game(3, PLAYING, 1), // a replay
      game(4, WANT_TO_PLAY),
    ];
    expect(nextInSeries(games)).toBe(games[4]);
  });

  it("ignores unnumbered games and is null when all are done", () => {
    expect(nextInSeries([game(null, WANT_TO_PLAY), game(1, COMPLETED)])).toBeNull();
    expect(nextInSeries([])).toBeNull();
  });
});

describe("isNextInSeries", () => {
  const series = [game(1, COMPLETED), game(2, WANT_TO_PLAY), game(3, WANT_TO_PLAY)];

  it("lets the next game through and holds back later ones", () => {
    expect(isNextInSeries(series[1], series)).toBe(true);
    expect(isNextInSeries(series[2], series)).toBe(false);
  });

  it("never holds back an unnumbered game or one already completed", () => {
    expect(isNextInSeries(game(null, WANT_TO_PLAY), series)).toBe(true);
    expect(isNextInSeries(game(5, COMPLETED), series)).toBe(true);
  });

  it("works when the game isn't in the list it's given", () => {
    expect(isNextInSeries(game(2, WANT_TO_PLAY), [game(1, COMPLETED)])).toBe(true);
    expect(isNextInSeries(game(2, WANT_TO_PLAY), [game(1, PLAYING)])).toBe(false);
  });
});

describe("seriesKey", () => {
  it("ignores case and stray spaces", () => {
    expect(seriesKey(" Mass Effect ")).toBe(seriesKey("mass effect"));
  });
});
