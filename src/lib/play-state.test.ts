import { describe, expect, it } from "vitest";
import { PlayStatus } from "@prisma/client";
import { settlePlayState } from "@/lib/play-state";

const now = new Date("2026-10-11T12:00:00.000Z");
const earlier = new Date("2026-09-01T00:00:00.000Z");
const blank = { dateStarted: null, dateFinished: null, currentPage: null };

describe("settlePlayState", () => {
  it("dates and counts a game marked Read without a finish date", () => {
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

  it("uncounts the current pass when a game leaves Read", () => {
    const s = settlePlayState(
      PlayStatus.COMPLETED,
      { ...blank, status: PlayStatus.WANT_TO_PLAY, dateFinished: earlier },
      1,
      now,
    );
    expect(s.timesCompleted).toBe(1);
  });

  it("starts today when a game moves from Want to Read (or is new) to Reading", () => {
    for (const prev of [PlayStatus.WANT_TO_PLAY, null]) {
      const s = settlePlayState(prev, { ...blank, status: PlayStatus.PLAYING }, 0, now);
      expect(s.dateStarted).toBe(now);
    }
  });

  it("does not move the start date of a game resumed from Did Not Finish", () => {
    // Its log entries are placed relative to the start date; moving it to
    // today would re-credit them.
    const s = settlePlayState(PlayStatus.DROPPED, { ...blank, status: PlayStatus.PLAYING }, 0, now);
    expect(s.dateStarted).toBeNull();
  });

  it("leaves a game marked Read undated when asked to, and still counts the read", () => {
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

  it("keeps an already-Read game undated when it is saved without a date", () => {
    // A later save (a new rating) must not stamp today on it.
    const s = settlePlayState(PlayStatus.COMPLETED, { ...blank, status: PlayStatus.COMPLETED }, 0, now);
    expect(s.dateFinished).toBeNull();
    expect(s.timesCompleted).toBe(1);
  });

  it("still finishes today when a game moves to Read without a date", () => {
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
    const reading = settlePlayState(null, { ...blank, status: PlayStatus.PLAYING }, 0, now, {
      undatedFinish: true,
    });
    expect(reading.dateStarted).toBe(now);
  });

  it("keeps the page for Reading and Did Not Finish only", () => {
    const page = { ...blank, currentPage: 120 };
    expect(settlePlayState(null, { ...page, status: PlayStatus.PLAYING }, 0, now).currentPage).toBe(120);
    expect(settlePlayState(null, { ...page, status: PlayStatus.DROPPED }, 0, now).currentPage).toBe(120);
    expect(settlePlayState(null, { ...page, status: PlayStatus.COMPLETED }, 0, now).currentPage).toBeNull();
    expect(settlePlayState(null, { ...page, status: PlayStatus.WANT_TO_PLAY }, 0, now).currentPage).toBeNull();
  });
});
