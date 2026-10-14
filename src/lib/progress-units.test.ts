import { describe, expect, it } from "vitest";
import {
  aboutLength,
  addStep,
  boxText,
  completedFigure,
  formatDuration,
  formatHoursPlayed,
  formatPlaytime,
  parseDuration,
  parseTimeText,
  progressFigure,
  progressPercent,
  stepsFor,
} from "@/lib/progress-units";

describe("parseDuration", () => {
  it("reads the ways a player types a time", () => {
    expect(parseDuration("12:30")).toBe(750);
    expect(parseDuration("0:45")).toBe(45);
    expect(parseDuration("5.12")).toBe(312);
    expect(parseDuration("5,12")).toBe(312);
    expect(parseDuration("5:05")).toBe(305);
    expect(parseDuration("12h 30m")).toBe(750);
    expect(parseDuration("12 h 30 min")).toBe(750);
    expect(parseDuration("12h30")).toBe(750);
    expect(parseDuration("2 hours 15 minutes")).toBe(135);
    expect(parseDuration("12h")).toBe(720);
    expect(parseDuration("45m")).toBe(45);
    expect(parseDuration("45 min")).toBe(45);
    expect(parseDuration("45 mins")).toBe(45);
    expect(parseDuration("90")).toBe(90);
    expect(parseDuration(" 3H ")).toBe(180);
  });

  it("takes the play time a save screen shows, seconds and all", () => {
    expect(parseDuration("42:13:07")).toBe(2533);
    expect(parseDuration("1:02:30")).toBe(63);
  });

  it("reads decimal hours only with an h", () => {
    expect(parseDuration("1.5h")).toBe(90);
    expect(parseDuration("1,5 h")).toBe(90);
    expect(parseDuration("0.25 hours")).toBe(15);
    expect(parseDuration("2.75h")).toBe(165);
    // Without the h, two digits after the point are minutes: 5:12, not 5.12 hours.
    expect(parseDuration("5.12")).toBe(312);
  });

  it("takes long play times", () => {
    expect(parseDuration("1204:00")).toBe(72_240);
    expect(parseDuration("600000")).toBe(600_000);
  });

  it("refuses what isn't a time", () => {
    for (const s of ["5:75", "", "abc", "-3", "5.5", "5,7", "5:12:99", "a while", "12h 75m", "1.5"]) {
      expect(parseDuration(s), s).toBeNull();
    }
  });
});

describe("formatting a time", () => {
  it("fills a box clock style", () => {
    expect(formatDuration(750)).toBe("12:30");
    expect(formatDuration(5)).toBe("0:05");
    expect(formatDuration(60000)).toBe("1000:00");
    expect(boxText(312)).toBe("5:12");
    expect(boxText(null)).toBe("");
  });

  it("writes a time out in running text", () => {
    expect(formatPlaytime(750)).toBe("12 h 30 min");
    expect(formatPlaytime(45)).toBe("45 min");
    expect(formatPlaytime(180)).toBe("3 h");
    expect(formatPlaytime(0)).toBe("0 min");
    expect(aboutLength(2400)).toBe("about 40 h");
  });

  it("rounds a long total to whole hours", () => {
    expect(formatHoursPlayed(45)).toBe("45 min");
    expect(formatHoursPlayed(200)).toBe("3 h 20 min");
    expect(formatHoursPlayed(18_740)).toBe("312 hours");
    expect(formatHoursPlayed(72_240)).toBe("1,204 hours");
    expect(formatHoursPlayed(72_240, { numberFormat: "space" })).toBe("1 204 hours");
  });
});

describe("progressPercent and progressFigure", () => {
  it("shows a share of the time to beat when it is known", () => {
    expect(progressFigure(750, 2400)).toBe("12 h 30 min of about 40 h · 31%");
    expect(progressPercent(750, 2400)).toBe(31);
  });

  it("says plainly that the time played is past the usual", () => {
    expect(progressFigure(2710, 2400)).toBe("45 h 10 min · past the usual 40 h");
    expect(progressPercent(2710, 2400)).toBe(100);
    expect(progressFigure(2400, 2400)).toBe("40 h of about 40 h · 100%");
  });

  it("gives the time alone without a time to beat", () => {
    expect(progressFigure(750, null)).toBe("12 h 30 min played");
    expect(progressPercent(750, null)).toBeNull();
  });

  it("says how long a completed playthrough took", () => {
    expect(completedFigure(2520, null)).toBe("Completed in 42 h");
    expect(completedFigure(2100, 2400)).toBe("Completed in 35 h · usually about 40 h");
  });

  it("never shows 100% too early or 0% once started", () => {
    expect(progressPercent(2399, 2400)).toBe(99);
    expect(progressPercent(1, 2400)).toBe(1);
    expect(progressPercent(0, 2400)).toBe(0);
  });
});

describe("parseTimeText", () => {
  it("reads a box", () => {
    expect(parseTimeText("12:30")).toEqual({ minutes: 750 });
    expect(parseTimeText("  ")).toBeNull();
    expect(parseTimeText("soon")).toEqual({ error: "Type a time, like 12:30, 12h 30m or 45m." });
  });

  it("takes a time past any time to beat", () => {
    expect(parseTimeText("250:00")).toEqual({ minutes: 15_000 });
  });
});

describe("stepsFor and addStep", () => {
  it("gives the two step buttons from Preferences", () => {
    expect(stepsFor("30m-1h")).toEqual([
      { amount: 30, label: "+30 min", ariaLabel: "Add 30 minutes" },
      { amount: 60, label: "+1 h", ariaLabel: "Add an hour" },
    ]);
    expect(stepsFor("1h-2h").map((s) => [s.label, s.ariaLabel])).toEqual([
      ["+1 h", "Add an hour"],
      ["+2 h", "Add 2 hours"],
    ]);
    expect(stepsFor("15m-30m").map((s) => s.amount)).toEqual([15, 30]);
  });

  it("adds a step to the box, or to the time played so far", () => {
    expect(addStep("12:30", 30, 600)).toBe("13:00");
    expect(addStep("", 60, 750)).toBe("13:30");
    expect(addStep("nonsense", 15, 750)).toBe("12:45");
    expect(addStep("", 30, null)).toBe("0:30");
    expect(addStep("1.5h", 60, null)).toBe("2:30");
  });
});
