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
    expect(upNext(want, [], 10).map((b) => b.id)).toEqual(["a", "b"]);
  });

  it("puts the next game of a series under way first", () => {
    const want = [game("loose", WANT_TO_PLAY), game("mist2", WANT_TO_PLAY, "Mistborn", 2)];
    const series = [game("mist1", COMPLETED, "Mistborn", 1), want[1]];
    expect(upNext(want, series, 10).map((b) => b.id)).toEqual(["mist2", "loose"]);
  });

  it("counts a game being read as under way, so the one after it is next", () => {
    const want = [game("atuan", WANT_TO_PLAY, "Earthsea", 2)];
    const series = [game("wizard", PLAYING, "earthsea ", 1), want[0]];
    expect(upNext(want, series, 10).map((b) => b.id)).toEqual(["atuan"]);
  });

  it("leaves out a game waiting behind an earlier unplayed number", () => {
    const want = [game("three", WANT_TO_PLAY, "Dune", 3), game("two", WANT_TO_PLAY, "Dune", 2)];
    const series = [game("one", COMPLETED, "Dune", 1), ...want];
    expect(upNext(want, series, 10).map((b) => b.id)).toEqual(["two"]);
  });

  it("leaves out a second copy of a number already read", () => {
    const want = [game("copy", WANT_TO_PLAY, "Dune", 1)];
    const series = [game("one", COMPLETED, "Dune", 1), want[0]];
    expect(upNext(want, series, 10)).toEqual([]);
  });

  it("stops at the limit", () => {
    const want = Array.from({ length: 5 }, (_, i) => game(`b${i}`, WANT_TO_PLAY));
    expect(upNext(want, [], 3)).toHaveLength(3);
  });
});
