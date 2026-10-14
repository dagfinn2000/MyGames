import { describe, expect, it } from "vitest";
import { calendarDay } from "@/lib/dates";
import { formatNumber } from "@/lib/display";
import { goalProgress, markReplays } from "@/lib/goals";
import {
  NO_PLATFORM,
  buildPasses,
  countWindow,
  gamesCompletedAllTime,
  gamesLabel,
  goalRuleLine,
  inWindow,
  perYear,
  platformCounts,
  ruleNotes,
  tally,
  type CountGame,
  type CountPlaythrough,
  type CountRules,
  type GameDayMinutes,
  type StatsInputs,
} from "@/lib/stats-count";
import { ALL_TIME, yearWindow, type DayWindow } from "@/lib/stats-period";

const TZ = "UTC";
/** Hours played as logged, dropped games left out: how Preferences starts. */
const LOGGED: CountRules = { statsHoursPlayed: "logged", statsStoppedGames: "none" };
const FINISHED: CountRules = { ...LOGGED, statsHoursPlayed: "finished" };

/** A date typed into a date field: midnight UTC. */
const d = (day: string) => new Date(`${day}T00:00:00Z`);

function game(id: string, over: Partial<CountGame> = {}): CountGame {
  return {
    id,
    status: "COMPLETED",
    playedMinutes: null,
    dateStarted: null,
    dateFinished: null,
    rating: null,
    ...over,
  };
}

/** An archived playthrough from the play history. */
function playthrough(
  gameId: string,
  finished: string | null,
  over: Partial<CountPlaythrough> = {},
): CountPlaythrough {
  return {
    gameId,
    dateStarted: null,
    dateFinished: finished ? d(finished) : null,
    rating: null,
    playedMinutes: null,
    ...over,
  };
}

function log(gameId: string, day: string, minutes: number, current = true): GameDayMinutes {
  return { gameId, day, minutes, current };
}

function inputs<G extends CountGame>(
  games: G[],
  playthroughs: CountPlaythrough[] = [],
  logDays: GameDayMinutes[] = [],
  lastLogDates: Map<string, Date> = new Map(),
): StatsInputs<G> {
  return { games, playthroughs, logDays, lastLogDates };
}

/** Games and minutes a window adds up to under some rules. */
function count(inp: StatsInputs, rules: CountRules, window: DayWindow = ALL_TIME) {
  return tally(countWindow(buildPasses(inp, rules, TZ), window, rules));
}

describe("with hours counted by whole playthroughs", () => {
  // A library with a bit of everything.
  const games = [
    game("hollow-knight", { playedMinutes: 2400, dateFinished: d("2025-06-01") }), // and in 2024
    game("portal-2", { playedMinutes: 600 }), // Completed, no finish date
    game("witcher-3", { dateFinished: d("2026-02-01") }), // no time given
    game("celeste", { status: "WANT_TO_PLAY" }), // played before the app
    game("dark-souls", { status: "DROPPED", playedMinutes: 750, dateFinished: d("2026-03-01") }),
    game("ff7-rebirth", { status: "PLAYING", playedMinutes: 1200 }),
    game("stardew", { playedMinutes: 3000, dateFinished: d("2026-05-05") }),
  ];
  const playthroughs = [
    playthrough("hollow-knight", "2024-03-01", { playedMinutes: 2700 }),
    playthrough("celeste", null, { playedMinutes: 480 }),
  ];
  const logDays = [log("ff7-rebirth", "2026-09-01", 1200), log("dark-souls", "2026-02-20", 750)];
  const inp = inputs(games, playthroughs, logDays);

  /** The plain sums: every completed playthrough, current or archived,
   *  adds one game and the time it took, on the day it was completed. */
  function plainSums() {
    const completed = [
      ...games
        .filter((g) => g.status === "COMPLETED")
        .map((g) => ({ gameId: g.id, date: g.dateFinished, minutes: g.playedMinutes ?? 0 })),
      ...playthroughs.map((p) => ({
        gameId: p.gameId,
        date: p.dateFinished,
        minutes: p.playedMinutes ?? 0,
      })),
    ];
    const finishes = markReplays(
      completed.flatMap((c) => (c.date ? [{ ...c, dateFinished: c.date }] : [])),
      new Set(playthroughs.filter((p) => !p.dateFinished).map((p) => p.gameId)),
    ).map((f) => ({ ...f, year: Number(calendarDay(f.dateFinished, TZ).slice(0, 4)) }));
    return {
      gamesCompleted: games.filter((g) => g.status === "COMPLETED").length,
      minutes: completed.reduce((s, c) => s + c.minutes, 0),
      perYear: (year: number) => finishes.filter((f) => f.year === year).length,
      goal: (year: number, unit: "GAMES" | "HOURS", countReplays: boolean) => {
        const counted = finishes
          .filter((f) => f.year === year)
          .filter((f) => countReplays || !f.isReplay);
        return unit === "HOURS" ? counted.reduce((s, f) => s + f.minutes, 0) : counted.length;
      },
    };
  }

  it("adds up Games completed, Hours played, the per-year bars and goal progress", () => {
    const plain = plainSums();
    expect(gamesCompletedAllTime(games, FINISHED).games).toBe(plain.gamesCompleted);
    expect(count(inp, FINISHED).minutes).toBe(plain.minutes);
    expect(plain.minutes).toBe(9180);

    const passes = buildPasses(inp, FINISHED, TZ);
    for (const year of [2023, 2024, 2025, 2026, 2027]) {
      const items = countWindow(passes, yearWindow(year), FINISHED);
      expect(tally(items).games, `${year}`).toBe(plain.perYear(year));
      for (const unit of ["GAMES", "HOURS"] as const) {
        for (const countReplays of [true, false]) {
          expect(goalProgress(items, { unit, countReplays }), `${year} ${unit}`).toBe(
            plain.goal(year, unit, countReplays),
          );
        }
      }
    }
  });

  it("leaves out games still being played, and dropped ones", () => {
    const ids = countWindow(buildPasses(inp, FINISHED, TZ), ALL_TIME, FINISHED).map(
      (i) => i.pass.game.id,
    );
    expect(ids).not.toContain("dark-souls");
    expect(ids).not.toContain("ff7-rebirth");

    // Counting the time logged, the game being played adds its time; the
    // dropped one still adds nothing.
    const logged = countWindow(buildPasses(inp, LOGGED, TZ), ALL_TIME, LOGGED);
    expect(logged.find((i) => i.pass.game.id === "ff7-rebirth")).toMatchObject({
      games: 0,
      minutes: 1200,
    });
    expect(logged.map((i) => i.pass.game.id)).not.toContain("dark-souls");
  });

  it("counts a playthrough that ran past the usual time to beat in full", () => {
    const long = inputs(
      [{ ...game("elden-ring", { playedMinutes: 6000, dateFinished: d("2026-04-01") }), lengthMinutes: 3600 }],
      [],
      [log("elden-ring", "2026-03-01", 3600), log("elden-ring", "2026-04-01", 2400)],
    );
    expect(count(long, FINISHED).minutes).toBe(6000);
    expect(count(long, LOGGED).minutes).toBe(6000);
  });
});

describe("hours as logged", () => {
  it("splits a game played across New Year between the two years", () => {
    const inp = inputs(
      [game("x", { playedMinutes: 600, dateFinished: d("2026-01-10") })],
      [],
      [
        log("x", "2025-12-20", 300),
        log("x", "2025-12-28", 150),
        log("x", "2026-01-05", 100),
        log("x", "2026-01-10", 50),
      ],
    );
    expect(count(inp, LOGGED, yearWindow(2025))).toMatchObject({ games: 0, minutes: 450 });
    expect(count(inp, LOGGED, yearWindow(2026))).toMatchObject({ games: 1, minutes: 150 });
    expect(count(inp, LOGGED).minutes).toBe(600);
    // Whole playthroughs put it all in the year it was completed.
    expect(count(inp, FINISHED, yearWindow(2025)).minutes).toBe(0);
    expect(count(inp, FINISHED, yearWindow(2026)).minutes).toBe(600);
  });

  it("adds a game completed without logging on its finish day; undated only in all time", () => {
    const inp = inputs([
      game("y", { playedMinutes: 250, dateFinished: d("2026-03-03") }),
      game("z", { playedMinutes: 100 }),
      // No time given: a game, but no time.
      game("n", { dateFinished: d("2026-03-04") }),
    ]);
    expect(count(inp, LOGGED, yearWindow(2026))).toMatchObject({ games: 2, minutes: 250 });
    expect(count(inp, LOGGED).minutes).toBe(350);
  });

  it("counts a playthrough from before the app and a logged replay once each", () => {
    const inp = inputs(
      [game("p", { playedMinutes: 300, dateFinished: d("2026-04-01") })],
      [playthrough("p", "2020-05-01", { playedMinutes: 300 })],
      [log("p", "2026-03-20", 200), log("p", "2026-04-01", 100)],
    );
    expect(count(inp, LOGGED).minutes).toBe(600);
    expect(count(inp, LOGGED, yearWindow(2020)).minutes).toBe(300);
    expect(count(inp, LOGGED, yearWindow(2026)).minutes).toBe(300);

    // An undated "played it before" adds its time in all time only.
    const undated = inputs(
      [game("p", { playedMinutes: 300, dateFinished: d("2026-04-01") })],
      [playthrough("p", null, { playedMinutes: 300 })],
      [log("p", "2026-03-20", 300)],
    );
    expect(count(undated, LOGGED).minutes).toBe(600);
    expect(count(undated, LOGGED, yearWindow(2026)).minutes).toBe(300);
  });

  it("counts time logged in games still being played, and back on Want to Play", () => {
    const inp = inputs(
      [
        game("r", { status: "PLAYING", playedMinutes: 120 }),
        game("w", { status: "WANT_TO_PLAY" }),
      ],
      [],
      [log("r", "2026-09-01", 120), log("w", "2026-02-02", 80)],
    );
    const last30 = { from: "2026-08-17", to: "2026-09-15" };
    expect(count(inp, LOGGED, last30)).toMatchObject({ games: 0, minutes: 120 });
    expect(count(inp, LOGGED, yearWindow(2026)).minutes).toBe(200);
    expect(count(inp, FINISHED, yearWindow(2026)).minutes).toBe(0);
  });

  it("counts only what was logged of a game added part-way through", () => {
    // Added at 20 h played, then 5 h logged before completing it at 25 h:
    // the first 20 h were played on days nobody wrote down.
    const inp = inputs(
      [game("ac", { playedMinutes: 1500, dateFinished: d("2026-06-30") })],
      [],
      [log("ac", "2026-06-20", 300)],
    );
    expect(count(inp, LOGGED).minutes).toBe(300);
    expect(count(inp, FINISHED).minutes).toBe(1500);
  });
});

describe("log attribution", () => {
  it("gives time before a completion to that playthrough and later time to the replay", () => {
    const inp = inputs(
      [game("r", { playedMinutes: 300, dateFinished: d("2026-06-01") })],
      [playthrough("r", "2025-03-10", { dateStarted: d("2025-03-01"), playedMinutes: 300 })],
      [
        log("r", "2025-03-05", 200, false),
        log("r", "2025-03-10", 100, false),
        log("r", "2026-05-20", 300),
      ],
    );
    const passes = buildPasses(inp, LOGGED, TZ);
    const [first, again] = passes;
    expect(first).toMatchObject({ isReplay: false, logged: [{ minutes: 200 }, { minutes: 100 }] });
    expect(again).toMatchObject({ isReplay: true, logged: [{ day: "2026-05-20", minutes: 300 }] });

    const year2026 = countWindow(passes, yearWindow(2026), LOGGED);
    expect(goalProgress(year2026, { unit: "HOURS", countReplays: false })).toBe(0);
    expect(goalProgress(year2026, { unit: "HOURS", countReplays: true })).toBe(300);
    expect(count(inp, LOGGED, yearWindow(2025)).minutes).toBe(300);
  });

  it("treats a replay in progress as a replay for the goal", () => {
    const inp = inputs(
      [game("q", { status: "PLAYING", playedMinutes: 150 })],
      [playthrough("q", "2025-01-10")],
      [log("q", "2026-08-01", 150)],
    );
    const items = countWindow(buildPasses(inp, LOGGED, TZ), yearWindow(2026), LOGGED);
    expect(items).toHaveLength(1);
    expect(items[0].isReplay).toBe(true);
    expect(goalProgress(items, { unit: "HOURS", countReplays: false })).toBe(0);
    expect(goalProgress(items, { unit: "HOURS", countReplays: true })).toBe(150);
  });

  it("keeps an undated logged playthrough's time on it, so it isn't counted twice", () => {
    // Completed with "Don't remember", then played again: the earlier time
    // sits before the new playthrough's start.
    const inp = inputs(
      [game("u", { status: "PLAYING", playedMinutes: 50 })],
      [playthrough("u", null, { dateStarted: d("2026-02-01"), playedMinutes: 400 })],
      [log("u", "2026-02-10", 400, false), log("u", "2026-07-05", 50)],
    );
    expect(count(inp, LOGGED).minutes).toBe(450);
    expect(count(inp, LOGGED, yearWindow(2026)).minutes).toBe(450);
  });

  it("bounds each earlier playthrough by its own start", () => {
    // An undated playthrough in 2022, then a dated one in early 2023.
    const inp = inputs(
      [game("v", { status: "WANT_TO_PLAY" })],
      [
        playthrough("v", null, { dateStarted: d("2022-01-01"), playedMinutes: 300 }),
        playthrough("v", "2023-03-01", { dateStarted: d("2023-01-15"), playedMinutes: 300 }),
      ],
      [log("v", "2022-06-01", 300, false), log("v", "2023-02-01", 300, false)],
    );
    const [undated, dated] = buildPasses(inp, LOGGED, TZ);
    expect(undated.logged).toEqual([{ day: "2022-06-01", minutes: 300 }]);
    expect(dated.logged).toEqual([{ day: "2023-02-01", minutes: 300 }]);
    expect(count(inp, LOGGED).minutes).toBe(600);
  });

  it("gives time logged after a typed finish date to that finish", () => {
    const inp = inputs(
      [game("t", { status: "PLAYING" })],
      [playthrough("t", "2024-05-01")],
      [log("t", "2024-04-20", 250, false), log("t", "2024-05-03", 50, false)],
    );
    const [archived] = buildPasses(inp, LOGGED, TZ);
    expect(archived.logged.reduce((s, l) => s + l.minutes, 0)).toBe(300);
  });
});

describe("dropped games", () => {
  // Put down at 12 h 30 min.
  const dropped = game("ds", {
    status: "DROPPED",
    playedMinutes: 750,
    dateFinished: d("2026-03-01"),
  });
  const logs = [log("ds", "2026-02-20", 750)];

  it("leaves a dropped game out entirely by default, logged time too", () => {
    expect(count(inputs([dropped], [], logs), LOGGED, yearWindow(2026))).toMatchObject({
      games: 0,
      minutes: 0,
    });
  });

  it("counts the time played on the day it was dropped", () => {
    const rules: CountRules = { ...FINISHED, statsStoppedGames: "hours" };
    const inp = inputs([dropped], [], logs);
    expect(count(inp, rules, { from: "2026-03-01", to: "2026-03-31" })).toMatchObject({
      games: 0,
      minutes: 750,
    });
    expect(count(inp, rules, { from: "2026-02-01", to: "2026-02-28" }).minutes).toBe(0);
    // Counting the time logged, it lands on the days it was played.
    expect(
      count(inp, { ...rules, statsHoursPlayed: "logged" }, { from: "2026-02-01", to: "2026-02-28" })
        .minutes,
    ).toBe(750);
  });

  it("dates a drop without a finish date by the last log entry, else all time only", () => {
    const rules: CountRules = { ...FINISHED, statsStoppedGames: "hours" };
    const byLog = inputs(
      [game("s", { status: "DROPPED", playedMinutes: 90 })],
      [],
      [],
      new Map([["s", new Date("2026-04-04T18:00:00Z")]]),
    );
    expect(count(byLog, rules, { from: "2026-04-04", to: "2026-04-04" }).minutes).toBe(90);

    const undated = inputs([game("s", { status: "DROPPED", playedMinutes: 90 })]);
    expect(count(undated, rules, yearWindow(2026)).minutes).toBe(0);
    expect(count(undated, rules).minutes).toBe(90);
  });

  it("counts all the time played, past the usual time to beat, else the time logged", () => {
    const rules: CountRules = { ...FINISHED, statsStoppedGames: "hours" };
    expect(
      count(inputs([{ ...dropped, playedMinutes: 900, lengthMinutes: 600 }]), rules).minutes,
    ).toBe(900);
    expect(count(inputs([{ ...dropped, playedMinutes: null }], [], logs), rules).minutes).toBe(750);
  });

  it("counts as a game in the window it was dropped, and all time", () => {
    const rules: CountRules = { ...LOGGED, statsStoppedGames: "game" };
    const inp = inputs([dropped, game("k", { dateFinished: d("2026-03-15") })]);
    expect(count(inp, rules, { from: "2026-03-01", to: "2026-03-31" })).toMatchObject({
      games: 2,
      dropped: 1,
    });
    expect(count(inp, rules, { from: "2026-04-01", to: "2026-04-30" }).games).toBe(0);
    expect(gamesCompletedAllTime([dropped, game("k")], rules)).toEqual({ games: 2, dropped: 1 });
    expect(gamesCompletedAllTime([dropped, game("k")], LOGGED)).toEqual({ games: 1, dropped: 0 });
  });

  it("leaves a dropped replay's earlier completion alone, and marks the drop a replay", () => {
    const rules: CountRules = { ...LOGGED, statsStoppedGames: "game" };
    const passes = buildPasses(inputs([dropped], [playthrough("ds", "2024-01-01")]), rules, TZ);
    expect(passes.map((p) => [p.kind, p.isReplay])).toEqual([
      ["finished", false],
      ["stopped", true],
    ]);
  });
});

describe("perYear", () => {
  const inp = inputs(
    [
      game("x", { playedMinutes: 600, dateFinished: d("2026-01-10") }),
      game("y", { playedMinutes: 900, dateFinished: d("2024-08-01") }),
    ],
    [],
    [log("x", "2025-12-20", 450), log("x", "2026-01-10", 150)],
  );

  it("lists each year with games or time in it, oldest first", () => {
    expect(perYear(buildPasses(inp, LOGGED, TZ), LOGGED)).toEqual([
      { year: 2024, games: 1, minutes: 900 },
      { year: 2025, games: 0, minutes: 450 },
      { year: 2026, games: 1, minutes: 150 },
    ]);
    // Whole playthroughs: nothing in the year before it was completed.
    expect(perYear(buildPasses(inp, FINISHED, TZ), FINISHED)).toEqual([
      { year: 2024, games: 1, minutes: 900 },
      { year: 2026, games: 1, minutes: 600 },
    ]);
  });

  it("counts each year as that year's goal does", () => {
    for (const rules of [LOGGED, FINISHED]) {
      const passes = buildPasses(inp, rules, TZ);
      for (const { year, games, minutes } of perYear(passes, rules)) {
        const items = countWindow(passes, yearWindow(year), rules);
        expect(goalProgress(items, { unit: "GAMES", countReplays: true })).toBe(games);
        expect(goalProgress(items, { unit: "HOURS", countReplays: true })).toBe(minutes);
      }
    }
  });

  it("has no row for a year where nothing counts", () => {
    const quiet = inputs([
      game("ds", { status: "DROPPED", playedMinutes: 300, dateFinished: d("2023-05-01") }),
      game("p2", { playedMinutes: 600 }), // completed, undated
    ]);
    expect(perYear(buildPasses(quiet, LOGGED, TZ), LOGGED)).toEqual([]);
    const hours: CountRules = { ...LOGGED, statsStoppedGames: "hours" };
    expect(perYear(buildPasses(quiet, hours, TZ), hours)).toEqual([
      { year: 2023, games: 0, minutes: 300 },
    ]);
  });
});

describe("windows", () => {
  it("include both ends, and an unknown day only in all time", () => {
    const w = { from: "2026-09-13", to: "2026-10-12" };
    expect(inWindow("2026-09-13", w)).toBe(true);
    expect(inWindow("2026-10-12", w)).toBe(true);
    expect(inWindow("2026-09-12", w)).toBe(false);
    expect(inWindow(null, w)).toBe(false);
    expect(inWindow(null, ALL_TIME)).toBe(true);
  });

  it("read a typed finish date as the day typed, in any zone", () => {
    const inp = inputs([game("m", { dateFinished: d("2026-09-12") })]);
    const passes = buildPasses(inp, LOGGED, "America/New_York");
    expect(passes[0].day).toBe("2026-09-12");
    expect(countWindow(passes, { from: "2026-09-12", to: "2026-10-11" }, LOGGED)).toHaveLength(1);
    expect(countWindow(passes, { from: "2026-08-13", to: "2026-09-11" }, LOGGED)).toHaveLength(0);

    // A "completed now" moment falls on the player's own day.
    const late = inputs([game("n", { dateFinished: new Date("2026-09-12T02:00:00Z") })]);
    expect(buildPasses(late, LOGGED, "America/New_York")[0].day).toBe("2026-09-11");
  });
});

describe("platformCounts", () => {
  it("counts games per platform, most first, with the games without one last", () => {
    const games = [
      "PC", "Nintendo Switch", "PC", null, "PlayStation 5", "", "Nintendo Switch", "PC", null,
      null, null,
    ].map((platform) => ({ platform }));
    // Five without a platform, still after the three on PC.
    expect(platformCounts(games)).toEqual([
      ["PC", 3],
      ["Nintendo Switch", 2],
      ["PlayStation 5", 1],
      [NO_PLATFORM, 5],
    ]);
    expect(platformCounts([])).toEqual([]);
  });

  it("breaks ties by name and keeps the top few", () => {
    const games = ["Xbox Series X|S", "Game Boy", "PC", "Game Boy", "PC", "Xbox Series X|S", "Wii"]
      .map((platform) => ({ platform }));
    expect(platformCounts(games, 2)).toEqual([
      ["Game Boy", 2],
      ["PC", 2],
    ]);
  });

  it("takes platforms as written, as the library's platform filter does", () => {
    expect(platformCounts([{ platform: "PC" }, { platform: " PC " }, { platform: "Mac" }])).toEqual([
      ["PC", 2],
      ["Mac", 1],
    ]);
  });
});

describe("labels and notes", () => {
  it("calls them games completed, or games finished when dropped games count too", () => {
    expect(gamesLabel(LOGGED)).toBe("Games completed");
    expect(gamesLabel({ ...LOGGED, statsStoppedGames: "hours" })).toBe("Games completed");
    expect(gamesLabel({ ...LOGGED, statsStoppedGames: "game" })).toBe("Games finished");
  });

  it("names the rule on each card", () => {
    expect(ruleNotes(LOGGED)).toEqual({ hoursSuffix: " · as logged", hours: [], games: [] });
    expect(ruleNotes(FINISHED)).toEqual({
      hoursSuffix: "",
      hours: ["whole playthroughs when completed"],
      games: [],
    });
    expect(
      ruleNotes({ statsHoursPlayed: "logged", statsStoppedGames: "game" }, { replays: 2, dropped: 1 }),
    ).toEqual({
      hoursSuffix: " · as logged",
      hours: ["includes time in games you dropped"],
      games: ["includes 2 replays", "includes 1 dropped"],
    });
    expect(ruleNotes(FINISHED, { replays: 1 }).games).toEqual(["includes 1 replay"]);
    expect(ruleNotes(LOGGED, { replays: 1200 }, (n) => formatNumber(n)).games).toEqual([
      "includes 1,200 replays",
    ]);
  });

  it("explains an hours goal both ways", () => {
    expect(goalRuleLine(FINISHED)).toBe(
      "An hours goal adds up the whole time played on each game you complete.",
    );
    expect(goalRuleLine(LOGGED)).toBe(
      "An hours goal counts the time you log, plus the time played on games you complete without logging.",
    );
  });
});
