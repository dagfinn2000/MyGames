import { describe, expect, it } from "vitest";
import { PlayStatus } from "@prisma/client";
import { upNext } from "@/lib/up-next";

const { COMPLETED, PLAYING, WANT_TO_PLAY } = PlayStatus;
const game = (
  id: string,
  status: PlayStatus,
  seriesName: string | null = null,
  seriesNumber: number | null = null,
) => ({ id, status, seriesName, seriesNumber, timesCompleted: status === COMPLETED ? 1 : 0 });

describe("upNext", () => {
  it("keeps the given order for games outside a series", () => {
    const want = [game("a", WANT_TO_PLAY), game("b", WANT_TO_PLAY)];
    expect(upNext(want, [], 10).map((g) => g.id)).toEqual(["a", "b"]);
  });

  it("puts the next game of a series under way first", () => {
    const want = [game("loose", WANT_TO_PLAY), game("me2", WANT_TO_PLAY, "Mass Effect", 2)];
    const series = [game("me1", COMPLETED, "Mass Effect", 1), want[1]];
    expect(upNext(want, series, 10).map((g) => g.id)).toEqual(["me2", "loose"]);
  });

  it("counts a game being played as under way, so the one after it is next", () => {
    const want = [game("ds2", WANT_TO_PLAY, "Dark Souls", 2)];
    const series = [game("ds1", PLAYING, "dark souls ", 1), want[0]];
    expect(upNext(want, series, 10).map((g) => g.id)).toEqual(["ds2"]);
  });

  it("leaves out a game waiting behind an earlier unplayed number", () => {
    const want = [game("three", WANT_TO_PLAY, "The Witcher", 3), game("two", WANT_TO_PLAY, "The Witcher", 2)];
    const series = [game("one", COMPLETED, "The Witcher", 1), ...want];
    expect(upNext(want, series, 10).map((g) => g.id)).toEqual(["two"]);
  });

  it("leaves out a second copy of a number already completed", () => {
    const want = [game("copy", WANT_TO_PLAY, "The Witcher", 1)];
    const series = [game("one", COMPLETED, "The Witcher", 1), want[0]];
    expect(upNext(want, series, 10)).toEqual([]);
  });

  it("stops at the limit", () => {
    const want = Array.from({ length: 5 }, (_, i) => game(`g${i}`, WANT_TO_PLAY));
    expect(upNext(want, [], 3)).toHaveLength(3);
  });
});
