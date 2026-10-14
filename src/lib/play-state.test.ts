import { describe, expect, it } from "vitest";
import { PlayStatus } from "@prisma/client";
import { settlePlayState } from "@/lib/play-state";

const now = new Date("2026-10-11T12:00:00.000Z");
const earlier = new Date("2026-09-01T00:00:00.000Z");
const blank = { dateStarted: null, dateFinished: null, playedMinutes: null };

describe("settlePlayState", () => {
  it("dates and counts a game marked Completed without a finish date", () => {
    const s = settlePlayState(PlayStatus.PLAYING, { ...blank, status: PlayStatus.COMPLETED }, 2, now);
    expect(s.dateFinished).toBe(now);
    expect(s.timesCompleted).toBe(3);
  });

  it("keeps a finish date that was given", () => {
    const s = settlePlayState(
      null,
      { ...blank, status: PlayStatus.COMPLETED, dateFinished: earlier },
      0,
      now,
    );
    expect(s.dateFinished).toBe(earlier);
    expect(s.timesCompleted).toBe(1);
  });

  it("uncounts the current playthrough when a game leaves Completed", () => {
    const s = settlePlayState(
      PlayStatus.COMPLETED,
      { ...blank, status: PlayStatus.WANT_TO_PLAY, dateFinished: earlier },
      1,
      now,
    );
    expect(s.timesCompleted).toBe(1);
  });

  it("starts today when a game moves from Want to Play (or is new) to Playing", () => {
    for (const prev of [PlayStatus.WANT_TO_PLAY, null]) {
      const s = settlePlayState(prev, { ...blank, status: PlayStatus.PLAYING }, 0, now);
      expect(s.dateStarted).toBe(now);
    }
  });

  it("does not move the start date of a game picked up again from Dropped", () => {
    // Its log entries are placed relative to the start date; moving it to
    // today would re-credit them.
    const s = settlePlayState(PlayStatus.DROPPED, { ...blank, status: PlayStatus.PLAYING }, 0, now);
    expect(s.dateStarted).toBeNull();
  });

  it("leaves a game marked Completed undated when asked to, and still counts it", () => {
    const s = settlePlayState(
      PlayStatus.WANT_TO_PLAY,
      { ...blank, status: PlayStatus.COMPLETED },
      0,
      now,
      { undatedFinish: true },
    );
    expect(s.dateFinished).toBeNull();
    expect(s.timesCompleted).toBe(1);
  });

  it("keeps a given finish date over an undated finish", () => {
    const s = settlePlayState(
      null,
      { ...blank, status: PlayStatus.COMPLETED, dateFinished: earlier },
      0,
      now,
      { undatedFinish: true },
    );
    expect(s.dateFinished).toBe(earlier);
  });

  it("keeps an already-Completed game undated when it is saved without a date", () => {
    // A later save (a new rating) must not stamp today on it.
    const s = settlePlayState(PlayStatus.COMPLETED, { ...blank, status: PlayStatus.COMPLETED }, 0, now);
    expect(s.dateFinished).toBeNull();
    expect(s.timesCompleted).toBe(1);
  });

  it("still finishes today when a game moves to Completed without a date", () => {
    const s = settlePlayState(PlayStatus.PLAYING, { ...blank, status: PlayStatus.COMPLETED }, 0, now, {});
    expect(s.dateFinished).toBe(now);
  });

  it("ignores an undated finish for the other statuses", () => {
    for (const status of [PlayStatus.PLAYING, PlayStatus.DROPPED, PlayStatus.WANT_TO_PLAY]) {
      const s = settlePlayState(
        PlayStatus.WANT_TO_PLAY,
        { ...blank, status, dateFinished: earlier },
        0,
        now,
        { undatedFinish: true },
      );
      expect(s.dateFinished).toBe(earlier);
      expect(s.timesCompleted).toBe(0);
    }
    const playing = settlePlayState(null, { ...blank, status: PlayStatus.PLAYING }, 0, now, {
      undatedFinish: true,
    });
    expect(playing.dateStarted).toBe(now);
  });

  it("keeps the time played while Playing, Completed and Dropped", () => {
    const played = { ...blank, playedMinutes: 750 };
    for (const status of [PlayStatus.PLAYING, PlayStatus.COMPLETED, PlayStatus.DROPPED]) {
      expect(settlePlayState(PlayStatus.PLAYING, { ...played, status }, 0, now).playedMinutes, status).toBe(750);
    }
  });

  it("clears the time played back on Want to Play", () => {
    const played = { ...blank, playedMinutes: 750 };
    for (const prev of [PlayStatus.PLAYING, PlayStatus.COMPLETED, PlayStatus.DROPPED]) {
      expect(
        settlePlayState(prev, { ...played, status: PlayStatus.WANT_TO_PLAY }, 0, now).playedMinutes,
        prev,
      ).toBeNull();
    }
  });

  it("stores no time as none", () => {
    const s = settlePlayState(null, { ...blank, status: PlayStatus.DROPPED, playedMinutes: 0 }, 0, now);
    expect(s.playedMinutes).toBeNull();
  });
});
