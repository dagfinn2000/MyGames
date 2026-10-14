import { describe, expect, it } from "vitest";
import { dayKey, zonedDayStart } from "@/lib/dates";
import {
  anchorMoment,
  describeDay,
  editEntrySchema,
  lastLogged,
  logTimeSchema,
  loggedWhen,
  passAround,
  placeInLog,
  recentDays,
  resolveLogDay,
  subjectDay,
  undoMoveSchema,
} from "@/lib/play-log";

const OSLO = "Europe/Oslo";

describe("resolveLogDay", () => {
  // 12 Oct 2026, 10:00 in Oslo (summer time, UTC+2).
  const now = new Date("2026-10-12T08:00:00.000Z");

  it("stamps today's entry now", () => {
    expect(resolveLogDay("today", now, OSLO)).toEqual({ key: "2026-10-12", at: now });
  });

  it("puts yesterday's entry at the last moment of yesterday in the player's zone", () => {
    const r = resolveLogDay("yesterday", now, OSLO);
    expect(r).toEqual({
      key: "2026-10-11",
      at: new Date(zonedDayStart("2026-10-12", OSLO).getTime() - 1),
    });
    expect(r).toMatchObject({ at: new Date("2026-10-11T21:59:59.999Z") });
  });

  it("takes a picked day and refuses a future one", () => {
    expect(resolveLogDay("2026-10-09", now, OSLO)).toEqual({
      key: "2026-10-09",
      at: new Date("2026-10-09T21:59:59.999Z"),
    });
    expect(resolveLogDay("2026-10-13", now, OSLO)).toEqual({ error: "future" });
  });

  it("decides what today is in the player's zone", () => {
    const lateUtc = new Date("2026-10-12T23:30:00.000Z");
    expect(resolveLogDay("today", lateUtc, "America/Los_Angeles")).toMatchObject({ key: "2026-10-12" });
    expect(resolveLogDay("today", lateUtc, "Asia/Tokyo")).toMatchObject({ key: "2026-10-13" });
    // Tomorrow for Los Angeles is still the future even though it's today in Tokyo.
    expect(resolveLogDay("2026-10-13", lateUtc, "America/Los_Angeles")).toEqual({ error: "future" });
  });
});

const e = (id: string, minutes: number, iso: string) => ({ id, minutes, date: new Date(iso) });

describe("placeInLog", () => {
  const pass = [
    e("a", 0, "2026-10-05T00:00:00.000Z"),
    e("b", 120, "2026-10-08T18:00:00.000Z"),
    e("c", 165, "2026-10-10T18:00:00.000Z"),
    e("d", 210, "2026-10-12T07:00:00.000Z"),
  ];
  const opts = { timeZone: OSLO };

  it("fits a backdated entry between its neighbours", () => {
    const r = placeInLog(pass, { minutes: 140, date: new Date("2026-10-09T21:59:59.999Z") }, opts);
    expect(r).toMatchObject({ ok: true, before: pass[1], after: pass[2], moveAnchor: null });
  });

  it("refuses less time than the entry before", () => {
    const r = placeInLog(pass, { minutes: 100, date: new Date("2026-10-09T21:59:59.999Z") }, opts);
    expect(r).toMatchObject({ ok: false, reason: "below", neighbour: pass[1] });
  });

  it("refuses more time than the entry after", () => {
    const r = placeInLog(pass, { minutes: 170, date: new Date("2026-10-09T21:59:59.999Z") }, opts);
    expect(r).toMatchObject({ ok: false, reason: "above", neighbour: pass[2] });
  });

  it("allows equal times on both sides", () => {
    expect(placeInLog(pass, { minutes: 120, date: new Date("2026-10-09T12:00:00Z") }, opts).ok).toBe(true);
    expect(placeInLog(pass, { minutes: 165, date: new Date("2026-10-09T12:00:00Z") }, opts).ok).toBe(true);
  });

  it("is the newest entry when nothing comes after, however long", () => {
    const r = placeInLog(pass, { minutes: 230, date: new Date("2026-10-12T09:00:00Z") }, opts);
    expect(r).toMatchObject({ ok: true, before: pass[3], after: null });
    const long = placeInLog(pass, { minutes: 600_000, date: new Date("2026-10-12T09:00:00Z") }, opts);
    expect(long).toMatchObject({ ok: true, before: pass[3], after: null });
    const low = placeInLog(pass, { minutes: 200, date: new Date("2026-10-12T09:00:00Z") }, opts);
    expect(low).toMatchObject({ ok: false, reason: "below", neighbour: pass[3] });
  });

  it("refuses a day before the anchor's day", () => {
    const r = placeInLog(pass, { minutes: 50, date: new Date("2026-10-03T12:00:00Z") }, opts);
    expect(r).toMatchObject({ ok: false, reason: "beforeStart", neighbour: pass[0] });
  });

  it("never reports beforeStart for a log with no anchor", () => {
    const added = pass.slice(1);
    const r = placeInLog(added, { minutes: 100, date: new Date("2026-10-01T12:00:00Z") }, opts);
    expect(r).toMatchObject({ ok: true, before: null, after: added[0] });
  });

  it("moves the anchor back for an entry earlier on the start day", () => {
    // Tokyo, 08:00 on the 12th: before the typed Started date's midnight UTC.
    const tokyo = [e("a", 0, "2026-10-12T00:00:00.000Z")];
    const r = placeInLog(tokyo, { minutes: 30, date: new Date("2026-10-11T23:00:00Z") }, { timeZone: "Asia/Tokyo" });
    expect(r).toMatchObject({ ok: true, before: tokyo[0], after: null, moveAnchor: tokyo[0] });
  });

  it("won't move the anchor over the playthrough before", () => {
    const tokyo = [e("a", 0, "2026-10-12T00:00:00.000Z")];
    const previous = e("z", 2400, "2026-10-11T23:30:00.000Z");
    const r = placeInLog(
      tokyo,
      { minutes: 30, date: new Date("2026-10-11T23:00:00Z") },
      { timeZone: "Asia/Tokyo", previous },
    );
    expect(r).toMatchObject({ ok: false, reason: "beforeStart" });
  });

  it("skips the entry being edited", () => {
    const r = placeInLog(pass, { minutes: 200, date: pass[2].date }, { ...opts, skipId: "c" });
    expect(r).toMatchObject({ ok: true, before: pass[1], after: pass[3] });
  });

  it("breaks same-instant ties by minutes, like the play calendar", () => {
    const at = pass[2].date;
    expect(placeInLog(pass, { minutes: 150, date: at }, opts)).toMatchObject({
      ok: true,
      before: pass[1],
      after: pass[2],
    });
    expect(placeInLog(pass, { minutes: 170, date: at }, opts)).toMatchObject({
      ok: true,
      before: pass[2],
      after: pass[3],
    });
  });
});

describe("passAround", () => {
  const log = [
    e("a0", 0, "2025-01-01T10:00:00Z"),
    e("a1", 2400, "2025-02-01T10:00:00Z"),
    e("b0", 0, "2025-06-01T10:00:00Z"),
    e("b1", 600, "2025-06-05T10:00:00Z"),
    e("b2", 2700, "2025-07-01T10:00:00Z"),
    e("c0", 0, "2026-03-01T10:00:00Z"),
    e("c1", 90, "2026-03-02T10:00:00Z"),
  ];

  it("finds a middle playthrough with its neighbours", () => {
    expect(passAround(log, "b1")).toEqual({
      pass: log.slice(2, 5),
      previous: log[1],
      nextAnchor: log[5],
      isCurrent: false,
    });
  });

  it("marks the last playthrough as current", () => {
    expect(passAround(log, "c1")).toMatchObject({ pass: log.slice(5), isCurrent: true, nextAnchor: null });
  });

  it("treats a log with no anchors as one playthrough", () => {
    const added = [e("x", 240, "2025-01-01T10:00:00Z"), e("y", 390, "2025-01-03T10:00:00Z")];
    expect(passAround(added, "x")).toEqual({ pass: added, previous: null, nextAnchor: null, isCurrent: true });
    expect(passAround(added, "nope")).toBeNull();
  });
});

describe("anchorMoment and lastLogged", () => {
  it("anchors at the start date unless the entry is earlier", () => {
    const start = new Date("2026-10-12T00:00:00Z");
    expect(anchorMoment(start, new Date("2026-10-12T05:00:00Z"))).toBe(start);
    const early = new Date("2026-10-11T23:00:00Z");
    expect(anchorMoment(start, early)).toBe(early);
    expect(anchorMoment(null, early)).toBe(early);
  });

  it("finds the last real time", () => {
    expect(lastLogged([{ minutes: 0 }])).toBeNull();
    expect(lastLogged([])).toBeNull();
    expect(lastLogged([{ minutes: 0 }, { minutes: 40 }])).toEqual({ minutes: 40 });
  });
});

describe("day words", () => {
  const today = "2026-10-12";

  it("says today, yesterday or the date", () => {
    expect(describeDay("2026-10-12", today)).toBe("today");
    expect(describeDay("2026-10-11", today)).toBe("yesterday");
    expect(describeDay("2026-10-09", today)).toBe("9 Oct 2026");
    expect(describeDay("2026-10-09", today, "mmm-d-y")).toBe("Oct 9, 2026");
    expect(subjectDay("2026-10-11", today)).toBe("Yesterday");
    expect(subjectDay("2026-10-09", today, "iso")).toBe("2026-10-09");
    expect(loggedWhen("2026-10-12", today)).toBe("today");
    expect(loggedWhen("2026-10-09", today)).toBe("for 9 Oct 2026");
  });

  it("offers recent days back to the start of the playthrough", () => {
    expect(recentDays(today, null)).toEqual({
      days: [
        { value: "today", label: "Today" },
        { value: "yesterday", label: "Yesterday" },
        { value: "2026-10-10", label: "Sat 10 Oct" },
        { value: "2026-10-09", label: "Fri 9 Oct" },
      ],
      more: true,
    });
    expect(recentDays(today, "2026-10-11")).toEqual({
      days: [
        { value: "today", label: "Today" },
        { value: "yesterday", label: "Yesterday" },
      ],
      more: false,
    });
    expect(recentDays(today, "2026-10-12").days).toHaveLength(1);
    expect(recentDays(today, "2026-10-09").more).toBe(false);
    expect(recentDays(today, "2026-10-08").more).toBe(true);
  });

  it("names days month first for month-first date styles", () => {
    expect(recentDays(today, null, "mm/dd/y").days[2].label).toBe("Sat, Oct 10");
  });
});

describe("schemas", () => {
  it("checks a quick log", () => {
    expect(logTimeSchema.parse({ minutes: 750 })).toEqual({ minutes: 750, day: "today" });
    expect(logTimeSchema.parse({ minutes: "750", day: "2026-10-09" })).toEqual({
      minutes: 750,
      day: "2026-10-09",
    });
    // Ten thousand hours is the most one playthrough can hold.
    expect(logTimeSchema.safeParse({ minutes: 600_000 }).success).toBe(true);
    for (const bad of [
      { minutes: 0 },
      { minutes: 1.5 },
      { minutes: 600_001 },
      { minutes: 10, day: "2026-02-30" },
      { minutes: 10, day: "tomorrow" },
    ]) {
      expect(logTimeSchema.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
    }
    expect(logTimeSchema.safeParse({ minutes: 0 }).error?.issues[0]?.message).toBe("Log at least a minute");
  });

  it("wants a real day for an entry fix", () => {
    expect(editEntrySchema.safeParse({ minutes: 5, day: "today" }).success).toBe(false);
    expect(editEntrySchema.safeParse({ minutes: 5, day: "2026-10-01" }).success).toBe(true);
  });

  it("checks an undo", () => {
    const ok = { from: "COMPLETED", finishedAt: "2026-10-12T08:00:00.000Z" };
    expect(undoMoveSchema.safeParse(ok).success).toBe(true);
    expect(undoMoveSchema.safeParse({ from: "DROPPED", finishedAt: null }).success).toBe(true);
    expect(undoMoveSchema.safeParse({ ...ok, from: "WANT_TO_PLAY" }).success).toBe(false);
    expect(undoMoveSchema.safeParse({ ...ok, finishedAt: "last Tuesday" }).success).toBe(false);
  });
});

describe("dayKey sanity for the zones above", () => {
  it("puts the Tokyo morning on the 12th", () => {
    expect(dayKey(new Date("2026-10-11T23:00:00Z"), "Asia/Tokyo")).toBe("2026-10-12");
  });
});
