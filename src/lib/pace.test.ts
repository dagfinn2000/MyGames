import { describe, expect, it } from "vitest";
import { PlayStatus } from "@prisma/client";
import {
  DAY_MS,
  chartPaceText,
  forecast,
  minutesPerDay,
  nowPlayingPaceText,
  paceAmount,
} from "@/lib/pace";

const TZ = "Europe/Oslo";
const p = (minutes: number, iso: string) => ({ minutes, date: new Date(iso) });
// Noon in Oslo, 12 Oct 2026.
const now = new Date("2026-10-12T10:00:00Z");
const prefs = { timeZone: TZ };

describe("minutesPerDay over the whole playthrough", () => {
  it("divides the time gained by the days the playthrough has run", () => {
    const pass = [p(0, "2026-10-01T10:00:00Z"), p(360, "2026-10-04T10:00:00Z"), p(900, "2026-10-11T10:00:00Z")];
    expect(minutesPerDay(pass, "playthrough", now, TZ)).toBe(90); // 15 hours over 10 days
  });

  it("floors a same-day playthrough to one day", () => {
    const pass = [p(0, "2026-10-12T08:00:00Z"), p(40, "2026-10-12T09:00:00Z")];
    expect(minutesPerDay(pass, "playthrough", now, TZ)).toBe(40);
  });

  it("has no pace with one entry or nothing gained", () => {
    expect(minutesPerDay([p(0, "2026-10-12T08:00:00Z")], "playthrough", now, TZ)).toBeNull();
    expect(
      minutesPerDay([p(500, "2026-10-01T08:00:00Z"), p(400, "2026-10-02T08:00:00Z")], "playthrough", now, TZ),
    ).toBeNull();
  });
});

describe("minutesPerDay over recent days", () => {
  const pass = [
    p(0, "2026-09-01T10:00:00Z"),
    p(600, "2026-09-20T10:00:00Z"),
    // The last 7 days in Oslo run 6–12 Oct.
    p(690, "2026-10-05T21:30:00Z"), // 23:30 on the 5th in Oslo: outside
    p(780, "2026-10-06T08:00:00Z"),
    p(750, "2026-10-08T08:00:00Z"), // a correction downwards credits nothing
    p(870, "2026-10-11T08:00:00Z"),
  ];

  it("sums only increases inside the window, in the player's zone", () => {
    // 90 (6th) + 120 (11th) = 210 minutes over 7 days
    expect(minutesPerDay(pass, "7d", now, TZ)).toBe(30);
  });

  it("divides a young playthrough by its own age", () => {
    const young = [p(0, "2026-10-10T06:00:00Z"), p(270, "2026-10-12T06:00:00Z")];
    expect(minutesPerDay(young, "14d", now, TZ)).toBe(90); // 3 days
  });

  it("reads a typed start date as its calendar day", () => {
    const typed = [p(0, "2026-10-10T00:00:00Z"), p(270, "2026-10-12T06:00:00Z")];
    expect(minutesPerDay(typed, "7d", now, "America/Los_Angeles")).toBe(90);
  });

  it("is 0 after a break", () => {
    const paused = [p(0, "2026-08-01T10:00:00Z"), p(300, "2026-08-10T10:00:00Z")];
    expect(minutesPerDay(paused, "7d", now, TZ)).toBe(0);
  });
});

describe("forecast", () => {
  const last = new Date("2026-10-10T10:00:00Z");

  it("counts from the last entry for the whole playthrough and from now for a window", () => {
    expect(forecast(600, 900, 30, "playthrough", last, now)).toEqual({
      daysLeft: 10,
      reach: new Date(last.getTime() + 10 * DAY_MS),
      overAYear: false,
    });
    expect(forecast(600, 900, 30, "7d", last, now)?.reach).toEqual(new Date(now.getTime() + 10 * DAY_MS));
  });

  it("flags a time to beat more than a year out instead of dropping it", () => {
    expect(forecast(0, 6000, 15, "playthrough", last, now)).toMatchObject({ daysLeft: 400, overAYear: true });
  });

  it("has nothing to say without a time to beat, a pace, or time left to it", () => {
    expect(forecast(10, null, 5, "playthrough", last, now)).toBeNull();
    expect(forecast(10, 300, 0, "7d", last, now)).toBeNull();
    expect(forecast(300, 300, 5, "playthrough", last, now)).toBeNull();
    // Past the usual time: nothing to count down to, and no complaint either.
    expect(forecast(2710, 2400, 5, "playthrough", last, now)).toBeNull();
  });
});

describe("paceAmount", () => {
  it("speaks time a day", () => {
    expect(paceAmount(80.4)).toBe("about 1 h 20 min a day");
    expect(paceAmount(45)).toBe("about 45 min a day");
    expect(paceAmount(120.2)).toBe("about 2 h a day");
    expect(paceAmount(15)).toBe("about 15 min a day");
  });

  it("goes by the week for a slow pace, and never says nothing", () => {
    expect(paceAmount(10)).toBe("about 1 h 10 min a week");
    expect(paceAmount(3)).toBe("about 21 min a week");
    expect(paceAmount(0.01)).toBe("about 1 min a week");
  });
});

describe("chartPaceText", () => {
  const pass = [p(0, "2026-10-01T10:00:00Z"), p(900, "2026-10-11T10:00:00Z")];
  const playing = { status: PlayStatus.PLAYING, pass, now, prefs };

  it("gives the pace and when it reaches the time to beat while playing", () => {
    expect(chartPaceText({ ...playing, lengthMinutes: 1800, from: "playthrough" })).toBe(
      "about 1 h 30 min a day · at this pace you'll reach the usual 30 h around 21 Oct 2026",
    );
  });

  it("names the window and says when nothing was played in it", () => {
    expect(chartPaceText({ ...playing, lengthMinutes: 1800, from: "7d" })).toMatch(
      /^about 2 h 9 min a day, last 7 days · at this pace you'll reach the usual 30 h around /,
    );
    const old = [p(0, "2026-08-01T10:00:00Z"), p(300, "2026-08-10T10:00:00Z")];
    expect(chartPaceText({ ...playing, pass: old, lengthMinutes: 1800, from: "7d" })).toBe(
      "Not played in the last 7 days",
    );
  });

  it("says more than a year rather than nothing", () => {
    const slow = [p(0, "2026-01-01T10:00:00Z"), p(60, "2026-10-11T10:00:00Z")];
    expect(chartPaceText({ ...playing, pass: slow, lengthMinutes: 6000, from: "playthrough" })).toBe(
      "about 1 min a week · more than a year to the usual 100 h at this pace",
    );
  });

  it("leaves out the forecast without a time to beat, or once past it", () => {
    expect(chartPaceText({ ...playing, lengthMinutes: null, from: "playthrough" })).toBe(
      "about 1 h 30 min a day",
    );
    expect(chartPaceText({ ...playing, lengthMinutes: 600, from: "playthrough" })).toBe(
      "about 1 h 30 min a day",
    );
  });

  it("always uses the whole playthrough for a completed game", () => {
    expect(
      chartPaceText({ status: PlayStatus.COMPLETED, pass, lengthMinutes: 900, from: "7d", now, prefs }),
    ).toBe("about 1 h 30 min a day over 10 days");
    const oneDay = [p(0, "2026-10-11T08:00:00Z"), p(300, "2026-10-11T20:00:00Z")];
    expect(
      chartPaceText({ status: PlayStatus.COMPLETED, pass: oneDay, lengthMinutes: null, from: "playthrough", now, prefs }),
    ).toBe("about 5 h a day over 1 day");
  });

  it("has no line for the other statuses", () => {
    expect(
      chartPaceText({ status: PlayStatus.DROPPED, pass, lengthMinutes: 1800, from: "playthrough", now, prefs }),
    ).toBeNull();
  });
});

describe("nowPlayingPaceText", () => {
  const pass = [p(0, "2026-10-01T10:00:00Z"), p(900, "2026-10-11T10:00:00Z")];

  it("counts the days to the usual time to beat", () => {
    expect(nowPlayingPaceText({ pass, lengthMinutes: 1890, from: "playthrough", now, prefs })).toBe(
      "about 1 h 30 min a day · 11 days to the usual 31 h 30 min",
    );
    expect(nowPlayingPaceText({ pass, lengthMinutes: 960, from: "playthrough", now, prefs })).toBe(
      "about 1 h 30 min a day · 1 day to the usual 16 h",
    );
  });

  it("says over a year, and asks for entries when there's no pace", () => {
    const slow = [p(0, "2026-01-01T10:00:00Z"), p(60, "2026-10-11T10:00:00Z")];
    expect(nowPlayingPaceText({ pass: slow, lengthMinutes: 6000, from: "playthrough", now, prefs })).toBe(
      "about 1 min a week · over a year to the usual 100 h",
    );
    expect(
      nowPlayingPaceText({ pass: [p(0, "2026-10-11T10:00:00Z")], lengthMinutes: 600, from: "playthrough", now, prefs }),
    ).toBe("No pace yet. Log a session or two.");
  });
});
