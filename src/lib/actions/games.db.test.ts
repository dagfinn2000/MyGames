import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PrismaClient, PlayStatus } from "@prisma/client";

/**
 * The game form actions against a real database: createGame, updateGame,
 * updatePlay (and the play log it writes through logProgress), and
 * deleteGame's cover cleanup.
 *
 * The play log is the part most worth pinning down. Stats count time
 * played as the gap between consecutive entries, so a missing 0-minute
 * anchor, or an entry written where none should be, quietly shifts hours
 * between days and years without anything looking broken.
 */

const prisma = new PrismaClient();

let currentUserId: string | null = null;
vi.mock("@/auth", () => ({
  auth: async () => (currentUserId ? { user: { id: currentUserId } } : null),
  signOut: async () => {},
}));

vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

// redirect() ends an action by throwing; surface where it was headed.
class Redirect extends Error {
  constructor(readonly url: string) {
    super(`redirect to ${url}`);
  }
}
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Redirect(url);
  },
}));

// Cover downloads run in after(); queue them so a test can run them when it
// wants to, and stub the download itself so nothing touches the network.
const deferred: (() => Promise<void>)[] = [];
vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  after: (fn: () => Promise<void>) => {
    deferred.push(fn);
  },
}));
const cacheCoverImage = vi.fn<(url: string, gameId: string) => Promise<string | null>>();
vi.mock("@/lib/covers", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/covers")>()),
  cacheCoverImage: (url: string, gameId: string) => cacheCoverImage(url, gameId),
}));

const { createGame, updateGame, updatePlay, deleteGame } = await import(
  "@/lib/actions/games"
);
const { logTime } = await import("@/lib/actions/progress");

let userId: string;
let otherUserId: string;
let coversDir: string;
const savedCoversDir = process.env.COVERS_DIR;

beforeAll(async () => {
  coversDir = await fs.mkdtemp(path.join(os.tmpdir(), "mygames-covers-"));
  process.env.COVERS_DIR = coversDir;
});

afterAll(async () => {
  await fs.rm(coversDir, { recursive: true, force: true });
  if (savedCoversDir === undefined) delete process.env.COVERS_DIR;
  else process.env.COVERS_DIR = savedCoversDir;
});

beforeEach(async () => {
  const stamp = `${Date.now()}-${Math.random()}`;
  const [a, b] = await Promise.all([
    prisma.user.create({ data: { username: `gm-${stamp}`, passwordHash: "x" } }),
    prisma.user.create({ data: { username: `gmo-${stamp}`, passwordHash: "x" } }),
  ]);
  userId = a.id;
  otherUserId = b.id;
  currentUserId = userId;
  deferred.length = 0;
  cacheCoverImage.mockReset();
  cacheCoverImage.mockResolvedValue(null);
});

afterEach(async () => {
  vi.useRealTimers();
  await prisma.user.deleteMany({ where: { id: { in: [userId, otherUserId] } } });
});

async function setZone(timeZone: string) {
  await prisma.user.update({ where: { id: userId }, data: { preferences: { timeZone } } });
}

/** Freezes the clock (only Date) at `iso`. */
function clockAt(iso: string) {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(iso));
}

function form(fields: Record<string, string>) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

const gameFields = {
  title: "The Witcher 3: Wild Hunt",
  developers: "CD Projekt Red",
  tags: "",
  format: "PHYSICAL",
  ownership: "OWNED",
};

/** Runs an action that should end in redirect() and returns the target. */
async function redirectOf(run: Promise<unknown>): Promise<string> {
  const err = await run.then(
    () => null,
    (e: unknown) => e,
  );
  if (!(err instanceof Redirect)) throw new Error(`expected a redirect, got ${String(err)}`);
  return err.url;
}

async function makeGame(over: Record<string, unknown> = {}, owner = userId) {
  return prisma.game.create({
    data: { userId: owner, title: "Test Game", searchText: "test game", ...over },
  });
}

async function writeCover(name: string) {
  await fs.writeFile(path.join(coversDir, name), "cover");
  return `/api/covers/${name}`;
}

async function coverExists(url: string) {
  return fs
    .access(path.join(coversDir, path.basename(url)))
    .then(() => true)
    .catch(() => false);
}

function progressOf(gameId: string) {
  return prisma.progressEntry.findMany({
    where: { gameId },
    orderBy: [{ date: "asc" }, { minutes: "asc" }],
  });
}

async function minutesLogged(gameId: string) {
  return (await progressOf(gameId)).map((e) => e.minutes);
}

async function reload(gameId: string) {
  return prisma.game.findUniqueOrThrow({ where: { id: gameId } });
}

describe("createGame", () => {
  it("saves the game for the signed-in user and opens it", async () => {
    const url = await redirectOf(
      createGame(
        {},
        form({ ...gameFields, seriesName: "The Witcher", platform: "PC", status: "PLAYING" }),
      ),
    );

    const game = await prisma.game.findFirstOrThrow({ where: { userId } });
    expect(url).toBe(`/games/${game.id}`);
    expect(game.developers).toEqual(["CD Projekt Red"]);
    expect(game.status).toBe(PlayStatus.PLAYING);
    // The platform is searchable too: "witcher pc" finds this copy.
    expect(game.searchText).toBe("the witcher 3: wild hunt cd projekt red the witcher pc");
  });

  it("saves the game's own details", async () => {
    await redirectOf(
      createGame(
        {},
        form({
          title: "Portal 2",
          developers: "Valve, Hidden Path Entertainment",
          publisher: "Electronic Arts",
          platform: "PlayStation 3",
          releaseDate: "2011-04-19",
          lengthMinutes: "510",
          tags: "Puzzle, Co-op",
          format: "DIGITAL",
          ownership: "OWNED",
          catalogueId: "igdb:portal-2",
          description: "Wheatley wakes you up.",
        }),
      ),
    );

    const game = await prisma.game.findFirstOrThrow({ where: { userId } });
    expect(game).toMatchObject({
      title: "Portal 2",
      developers: ["Valve", "Hidden Path Entertainment"],
      publisher: "Electronic Arts",
      platform: "PlayStation 3",
      releaseDate: "2011-04-19",
      lengthMinutes: 510,
      tags: ["puzzle", "co-op"],
      format: "DIGITAL",
      catalogueId: "igdb:portal-2",
      description: "Wheatley wakes you up.",
      playedMinutes: null,
    });
  });

  it("dates and counts a game added straight onto Completed", async () => {
    // It used to land with no finish date and timesCompleted 0: counted as
    // completed but missing from the year it was beaten and from the goal.
    await redirectOf(createGame({}, form({ ...gameFields, status: "COMPLETED" })));

    const game = await prisma.game.findFirstOrThrow({ where: { userId } });
    expect(game.dateFinished?.toDateString()).toBe(new Date().toDateString());
    expect(game.timesCompleted).toBe(1);
  });

  it("starts a game added as Playing today", async () => {
    await redirectOf(createGame({}, form({ ...gameFields, status: "PLAYING" })));

    const game = await prisma.game.findFirstOrThrow({ where: { userId } });
    expect(game.dateStarted?.toDateString()).toBe(new Date().toDateString());
    expect(game.dateFinished).toBeNull();
    expect(game.timesCompleted).toBe(0);
  });

  it("saves a blank series number as none, not #0", async () => {
    await redirectOf(createGame({}, form({ ...gameFields, seriesName: "The Witcher", seriesNumber: "" })));

    const game = await prisma.game.findFirstOrThrow({ where: { userId } });
    expect(game.seriesNumber).toBeNull();
  });

  it("saves a time to beat whatever the format", async () => {
    // A disc, a download or a subscription game: each has a time to beat.
    for (const format of ["PHYSICAL", "DIGITAL", "SUBSCRIPTION"]) {
      await redirectOf(createGame({}, form({ ...gameFields, title: format, format, lengthMinutes: "2970" })));
    }
    await redirectOf(createGame({}, form({ ...gameFields, title: "Unknown", lengthMinutes: "" })));

    const games = await prisma.game.findMany({ where: { userId }, orderBy: { title: "asc" } });
    expect(games.map((g) => [g.title, g.lengthMinutes])).toEqual([
      ["DIGITAL", 2970],
      ["PHYSICAL", 2970],
      ["SUBSCRIPTION", 2970],
      ["Unknown", null],
    ]);
  });

  it("refuses a time to beat out of range", async () => {
    const result = await createGame({}, form({ ...gameFields, lengthMinutes: "60001" }));
    expect(result.error).toBe("Time to beat must be at most 1,000 hours");
    expect(await prisma.game.count({ where: { userId } })).toBe(0);
  });

  it("returns the validation error and saves nothing", async () => {
    const result = await createGame({}, form({ ...gameFields, title: "  " }));
    expect(result.error).toBe("Title is required");
    expect(await prisma.game.count({ where: { userId } })).toBe(0);
  });

  it("refuses a protocol-relative cover URL", async () => {
    const result = await createGame({}, form({ ...gameFields, coverUrl: "//evil.example/x.jpg" }));
    expect(result.error).toBe("Cover URL must be an http(s) URL");
  });

  it("refuses a catalogue id no catalogue wrote", async () => {
    const result = await createGame({}, form({ ...gameFields, catalogueId: "OL27482W" }));
    expect(result.error).toBe("That isn't a catalogue id MyGames knows");
    expect(await prisma.game.count({ where: { userId } })).toBe(0);
  });

  it("keeps the finish date picked for a game added as Completed, and its rating", async () => {
    await redirectOf(
      createGame({}, form({ ...gameFields, status: "COMPLETED", dateFinished: "2019-06-14", rating: "8" })),
    );

    const game = await prisma.game.findFirstOrThrow({ where: { userId } });
    expect(game.dateFinished?.toISOString().slice(0, 10)).toBe("2019-06-14");
    expect(game.rating).toBe(8);
    expect(game.timesCompleted).toBe(1);
  });

  it("leaves a game added as Completed undated when the player doesn't remember", async () => {
    // A date sent along with the box (it can't be, the field is disabled)
    // still loses to it.
    await redirectOf(
      createGame(
        {},
        form({ ...gameFields, status: "COMPLETED", finishedUnknown: "on", dateFinished: "2019-06-14" }),
      ),
    );

    const game = await prisma.game.findFirstOrThrow({ where: { userId } });
    expect(game.dateFinished).toBeNull();
    expect(game.timesCompleted).toBe(1);
  });

  it("follows the undated preference when no date is given", async () => {
    await prisma.user.update({
      where: { id: userId },
      data: { preferences: { addedAsCompletedFinished: "undated" } },
    });
    await redirectOf(createGame({}, form({ ...gameFields, status: "COMPLETED" })));
    expect((await prisma.game.findFirstOrThrow({ where: { userId } })).dateFinished).toBeNull();

    // A date picked anyway is kept.
    await redirectOf(createGame({}, form({ ...gameFields, status: "COMPLETED", dateFinished: "2020-01-02" })));
    const dated = await prisma.game.findFirstOrThrow({ where: { userId, dateFinished: { not: null } } });
    expect(dated.dateFinished?.toISOString().slice(0, 10)).toBe("2020-01-02");
  });

  it("starts the log of a game added part-way through at its time, with no 0-minute anchor", async () => {
    // Started 8 Oct with 10 h 40 min played credits nothing to today: a lone
    // first entry has no predecessor to count from.
    await redirectOf(
      createGame(
        {},
        form({ ...gameFields, status: "PLAYING", dateStarted: "2026-10-08", playedMinutes: "10:40" }),
      ),
    );

    const game = await prisma.game.findFirstOrThrow({ where: { userId } });
    expect(game.dateStarted?.toISOString().slice(0, 10)).toBe("2026-10-08");
    expect(game.playedMinutes).toBe(640);
    const log = await progressOf(game.id);
    expect(log.map((e) => e.minutes)).toEqual([640]);
    expect(log[0].date.getTime()).toBeGreaterThanOrEqual(game.dateStarted!.getTime());

    // The next time logged counts from there.
    expect(await logTime(game.id, { minutes: 800, day: "today" })).toMatchObject({ ok: true });
    expect(await minutesLogged(game.id)).toEqual([640, 800]);
  });

  it("dates a game added part-way through now, even before a Started date typed today", async () => {
    // 08:30 on 12 October in Tokyo. Started, typed as today, is midnight
    // UTC: still half an hour ahead. Dated there, the entry would sit after
    // the morning's next log and refuse it.
    await setZone("Asia/Tokyo");
    clockAt("2026-10-11T23:30:00.000Z");
    await redirectOf(
      createGame(
        {},
        form({ ...gameFields, status: "PLAYING", dateStarted: "2026-10-12", playedMinutes: "50" }),
      ),
    );
    const game = await prisma.game.findFirstOrThrow({ where: { userId } });
    expect((await progressOf(game.id)).map((e) => [e.minutes, e.date.toISOString()])).toEqual([
      [50, "2026-10-11T23:30:00.000Z"],
    ]);

    vi.setSystemTime(new Date("2026-10-11T23:40:00.000Z"));
    expect(await logTime(game.id, { minutes: 60, day: "today" })).toMatchObject({ ok: true });
    expect(await minutesLogged(game.id)).toEqual([50, 60]);
    expect((await reload(game.id)).playedMinutes).toBe(60);
  });

  it("logs nothing for a game added as Playing with no time played", async () => {
    await redirectOf(createGame({}, form({ ...gameFields, status: "PLAYING", playedMinutes: "" })));
    const game = await prisma.game.findFirstOrThrow({ where: { userId } });
    expect(game.playedMinutes).toBeNull();
    expect(await progressOf(game.id)).toHaveLength(0);
  });

  it("keeps the time played on a game added as Dropped", async () => {
    // "Stopped at 12 h". Logged, so picking it up again later counts from
    // there rather than crediting the first 12 hours to that day.
    await redirectOf(createGame({}, form({ ...gameFields, status: "DROPPED", playedMinutes: "12h" })));
    const game = await prisma.game.findFirstOrThrow({ where: { userId } });
    expect(game.status).toBe(PlayStatus.DROPPED);
    expect(game.playedMinutes).toBe(720);
    expect(await minutesLogged(game.id)).toEqual([720]);
  });

  it("takes a time played past the usual time to beat", async () => {
    await redirectOf(
      createGame(
        {},
        form({ ...gameFields, lengthMinutes: "2400", status: "PLAYING", playedMinutes: "45:10" }),
      ),
    );
    const game = await prisma.game.findFirstOrThrow({ where: { userId } });
    expect(game.lengthMinutes).toBe(2400);
    expect(game.playedMinutes).toBe(2710);
  });

  it("refuses a time played that isn't a time or a finish date in the future, and saves nothing", async () => {
    const notTime = await createGame(
      {},
      form({ ...gameFields, status: "PLAYING", playedMinutes: "a while" }),
    );
    expect(notTime.error).toBe("Couldn't read “a while”. Type a time, like 12:30, 12h 30m or 45m.");

    const future = new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10);
    const early = await createGame({}, form({ ...gameFields, status: "COMPLETED", dateFinished: future }));
    expect(early.error).toBe("Finish date is in the future");

    expect(await prisma.game.count({ where: { userId } })).toBe(0);
  });

  it("stays on the add page for Add and add another, saying what was added", async () => {
    const res = await createGame({}, form({ ...gameFields, afterAdd: "another" }));

    const game = await prisma.game.findFirstOrThrow({ where: { userId } });
    expect(res).toEqual({ success: true, added: { id: game.id, title: game.title } });
  });

  it("goes to the library when asked, and follows the preference without a button", async () => {
    expect(await redirectOf(createGame({}, form({ ...gameFields, afterAdd: "library" })))).toBe("/games");

    await prisma.user.update({ where: { id: userId }, data: { preferences: { afterAdd: "library" } } });
    expect(await redirectOf(createGame({}, form(gameFields)))).toBe("/games");

    await prisma.user.update({ where: { id: userId }, data: { preferences: { afterAdd: "another" } } });
    expect((await createGame({}, form(gameFields))).added).toBeDefined();
    // Junk in the field reads as no button.
    expect((await createGame({}, form({ ...gameFields, afterAdd: "then" }))).added).toBeDefined();
  });

  it("swaps a remote cover for the cached copy once it downloads", async () => {
    cacheCoverImage.mockResolvedValue("/api/covers/cached-1.jpg");
    await redirectOf(
      createGame({}, form({ ...gameFields, coverUrl: "https://covers.example.org/a.jpg" })),
    );
    for (const run of deferred) await run();

    const game = await prisma.game.findFirstOrThrow({ where: { userId } });
    expect(game.coverUrl).toBe("/api/covers/cached-1.jpg");
  });
});

describe("updateGame", () => {
  it("updates the fields and the search text", async () => {
    const g = await makeGame();
    await redirectOf(
      updateGame(
        g.id,
        {},
        form({ ...gameFields, title: "Hollow Knight", developers: "Team Cherry", platform: "Nintendo Switch" }),
      ),
    );

    const after = await reload(g.id);
    expect(after.title).toBe("Hollow Knight");
    expect(after.platform).toBe("Nintendo Switch");
    expect(after.searchText).toBe("hollow knight team cherry nintendo switch");
  });

  it("keeps the catalogue id the form sends", async () => {
    const g = await makeGame({ catalogueId: "steam:367520" });
    await redirectOf(updateGame(g.id, {}, form({ ...gameFields, catalogueId: "steam:367520" })));
    expect((await reload(g.id)).catalogueId).toBe("steam:367520");
  });

  it("clears the publisher, platform and time to beat when they're emptied", async () => {
    const g = await makeGame({ publisher: "Nintendo", platform: "Wii U", lengthMinutes: 3000 });
    await redirectOf(
      updateGame(g.id, {}, form({ ...gameFields, publisher: "", platform: " ", lengthMinutes: "" })),
    );
    const after = await reload(g.id);
    expect(after.publisher).toBeNull();
    expect(after.platform).toBeNull();
    expect(after.lengthMinutes).toBeNull();
  });

  it("leaves the play data alone", async () => {
    const g = await makeGame({
      status: PlayStatus.PLAYING,
      dateStarted: new Date("2026-10-01T00:00:00Z"),
      playedMinutes: 300,
      rating: 9,
    });
    await redirectOf(updateGame(g.id, {}, form({ ...gameFields, lengthMinutes: "2400" })));

    const after = await reload(g.id);
    expect(after).toMatchObject({ status: PlayStatus.PLAYING, playedMinutes: 300, rating: 9 });
    expect(after.dateStarted?.toISOString()).toBe("2026-10-01T00:00:00.000Z");
    expect(await progressOf(g.id)).toHaveLength(0);
  });

  it("refuses another account's game", async () => {
    const g = await makeGame({}, otherUserId);
    const result = await updateGame(g.id, {}, form({ ...gameFields, title: "Mine now" }));

    expect(result.error).toBe("Game not found");
    expect((await reload(g.id)).title).toBe("Test Game");
  });

  it("deletes the replaced cached cover", async () => {
    const old = await writeCover("old-cover.jpg");
    const g = await makeGame({ coverUrl: old });
    await redirectOf(updateGame(g.id, {}, form({ ...gameFields, coverUrl: "" })));

    expect(await coverExists(old)).toBe(false);
  });

  it("keeps a replaced cover file that another game still shows", async () => {
    const shared = await writeCover("shared-cover.jpg");
    const g = await makeGame({ coverUrl: shared });
    await makeGame({ coverUrl: shared }, otherUserId);
    await redirectOf(updateGame(g.id, {}, form({ ...gameFields, coverUrl: "" })));

    expect(await coverExists(shared)).toBe(true);
  });

  it("does not let a late cover download overwrite a newer cover", async () => {
    const g = await makeGame();
    const late = await writeCover(`${g.id}-late.jpg`);
    cacheCoverImage.mockResolvedValue(late);

    // First save starts a download; a second save picks another cover
    // before that download finishes.
    await redirectOf(
      updateGame(g.id, {}, form({ ...gameFields, coverUrl: "https://a.example/1.jpg" })),
    );
    const firstDownload = deferred.shift()!;
    await redirectOf(updateGame(g.id, {}, form({ ...gameFields, coverUrl: "/api/covers/new.jpg" })));
    await firstDownload();

    const after = await reload(g.id);
    expect(after.coverUrl).toBe("/api/covers/new.jpg");
    expect(await coverExists(late)).toBe(false); // nothing points at it
  });
});

describe("updatePlay and review search", () => {
  it("keeps the folded copy search reads in step with the review", async () => {
    const g = await makeGame({ status: PlayStatus.COMPLETED });
    await updatePlay(g.id, {}, form({ status: "COMPLETED", review: "Better than ŌKAMI, honestly" }));
    let row = await reload(g.id);
    expect(row.reviewSearchText).toBe("better than okami, honestly");

    await updatePlay(g.id, {}, form({ status: "COMPLETED", review: "" }));
    row = await reload(g.id);
    expect(row.reviewSearchText).toBe("");
  });
});

describe("updatePlay and the play log", () => {
  it("anchors the first time logged at 0 minutes", async () => {
    const started = "2026-03-01";
    const g = await makeGame({ status: PlayStatus.WANT_TO_PLAY });

    await updatePlay(g.id, {}, form({ status: "PLAYING", dateStarted: started, playedMinutes: "1:14" }));
    const log = await progressOf(g.id);
    expect(log.map((e) => e.minutes)).toEqual([0, 74]);
    expect(log[0].date.toISOString().slice(0, 10)).toBe(started);

    // Then each change, from a dropped game's time box.
    await updatePlay(g.id, {}, form({ status: "DROPPED", dateStarted: started, playedMinutes: "1:14" }));
    await updatePlay(g.id, {}, form({ status: "DROPPED", dateStarted: started, playedMinutes: "2h" }));
    expect(await minutesLogged(g.id)).toEqual([0, 74, 120]);

    // Saving without a change in time logs nothing new, however it's typed.
    await updatePlay(g.id, {}, form({ status: "DROPPED", dateStarted: started, playedMinutes: "120" }));
    expect(await minutesLogged(g.id)).toEqual([0, 74, 120]);
  });

  it("never moves a game being played off its own time", async () => {
    // The quick row logs a game being played; the card has no time box
    // then and sends the time it was rendered with, here from before a log
    // made in another tab.
    const g = await makeGame({
      status: PlayStatus.PLAYING,
      dateStarted: new Date("2026-03-01T00:00:00Z"),
      playedMinutes: 150,
    });
    await prisma.progressEntry.createMany({
      data: [
        { gameId: g.id, minutes: 0, date: new Date("2026-03-01T00:00:00Z") },
        { gameId: g.id, minutes: 150, date: new Date("2026-03-05T12:00:00Z") },
      ],
    });

    const saved = await updatePlay(
      g.id,
      {},
      form({ status: "PLAYING", dateStarted: "2026-03-01", playedMinutes: "2:00", rating: "8" }),
    );
    expect(saved.success).toBe(true);
    let after = await reload(g.id);
    expect(after.playedMinutes).toBe(150);
    expect(after.rating).toBe(8);
    expect(await minutesLogged(g.id)).toEqual([0, 150]);

    // Nor when it's dropped from the card.
    await updatePlay(g.id, {}, form({ status: "DROPPED", dateStarted: "2026-03-01", playedMinutes: "2:00" }));
    after = await reload(g.id);
    expect(after.playedMinutes).toBe(150);
    expect(await minutesLogged(g.id)).toEqual([0, 150]);
  });

  it("moves the playthrough's start back when Started is moved earlier, never over the one before", async () => {
    await setZone("Europe/Oslo");
    clockAt("2026-10-12T10:00:00.000Z");
    const g = await makeGame({
      status: PlayStatus.PLAYING,
      dateStarted: new Date("2026-10-05T00:00:00Z"),
      playedMinutes: 120,
    });
    await prisma.progressEntry.createMany({
      data: [
        { gameId: g.id, minutes: 0, date: new Date("2026-09-01T10:00:00Z") },
        { gameId: g.id, minutes: 300, date: new Date("2026-09-20T12:00:00Z") },
        { gameId: g.id, minutes: 0, date: new Date("2026-10-05T00:00:00Z") },
        { gameId: g.id, minutes: 120, date: new Date("2026-10-08T12:00:00Z") },
      ],
    });
    const anchorDate = async () =>
      (await progressOf(g.id)).filter((e) => e.minutes === 0).at(-1)!.date.toISOString();

    await updatePlay(g.id, {}, form({ status: "PLAYING", dateStarted: "2026-10-02" }));
    expect(await anchorDate()).toBe("2026-10-02T00:00:00.000Z");
    expect(await logTime(g.id, { minutes: 60, day: "2026-10-03" })).toMatchObject({ ok: true });

    await updatePlay(g.id, {}, form({ status: "PLAYING", dateStarted: "2026-09-15" }));
    expect(await anchorDate()).toBe("2026-09-20T12:00:00.001Z");
    expect(await minutesLogged(g.id)).toEqual([0, 300, 0, 60, 120]);
  });

  it("never anchors a playthrough after its first entry", async () => {
    // East of UTC, a Started date typed today is midnight UTC, which can
    // still be ahead of the moment the first time is logged. Tomorrow's
    // date (allowed, a day's slack) stands in for that here.
    const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
    const g = await makeGame({ status: PlayStatus.WANT_TO_PLAY });
    await updatePlay(g.id, {}, form({ status: "PLAYING", dateStarted: tomorrow, playedMinutes: "30m" }));

    const log = await progressOf(g.id);
    expect(log.map((e) => e.minutes)).toEqual([0, 30]);
    expect(log[0].date.getTime()).toBe(log[1].date.getTime());
  });

  it("completing a tracked game keeps its time and adds nothing to the log", async () => {
    // There's no last minute to close the log at: the time played when it
    // was completed is what the playthrough took ("Completed in 2 h").
    const g = await makeGame({ status: PlayStatus.WANT_TO_PLAY, lengthMinutes: 600 });
    await updatePlay(g.id, {}, form({ status: "PLAYING", playedMinutes: "2:00" }));
    await updatePlay(g.id, {}, form({ status: "COMPLETED" }));

    const after = await reload(g.id);
    expect(after.playedMinutes).toBe(120);
    expect(after.timesCompleted).toBe(1);
    expect(await minutesLogged(g.id)).toEqual([0, 120]);
  });

  it("completing an untracked game logs nothing and fills in today", async () => {
    const g = await makeGame({ status: PlayStatus.WANT_TO_PLAY });
    await updatePlay(g.id, {}, form({ status: "COMPLETED" }));

    const after = await reload(g.id);
    expect(after.dateFinished?.toDateString()).toBe(new Date().toDateString());
    expect(await progressOf(g.id)).toHaveLength(0);
  });

  it("logs nothing for the time an untracked or already completed game took", async () => {
    // It's how long the playthrough took, not time played today: stats
    // count it on the day it was completed.
    const fresh = await makeGame({ status: PlayStatus.WANT_TO_PLAY });
    await updatePlay(
      fresh.id,
      {},
      form({ status: "COMPLETED", dateFinished: "2019-05-01", playedMinutes: "42:00" }),
    );
    expect((await reload(fresh.id)).playedMinutes).toBe(2520);
    expect(await progressOf(fresh.id)).toHaveLength(0);

    const old = await makeGame({
      status: PlayStatus.COMPLETED,
      timesCompleted: 1,
      dateStarted: new Date("2019-03-01T00:00:00Z"),
      dateFinished: new Date("2019-04-20T00:00:00Z"),
    });
    await updatePlay(
      old.id,
      {},
      form({ status: "COMPLETED", dateStarted: "2019-03-01", dateFinished: "2019-04-20", playedMinutes: "42:00" }),
    );
    expect((await reload(old.id)).playedMinutes).toBe(2520);
    expect(await progressOf(old.id)).toHaveLength(0);

    // A tracked one keeps its log as it was.
    const tracked = await makeGame({ status: PlayStatus.WANT_TO_PLAY });
    await updatePlay(tracked.id, {}, form({ status: "PLAYING", playedMinutes: "2:00" }));
    await updatePlay(tracked.id, {}, form({ status: "COMPLETED" }));
    await updatePlay(tracked.id, {}, form({ status: "COMPLETED", playedMinutes: "2:30" }));
    expect((await reload(tracked.id)).playedMinutes).toBe(150);
    expect(await minutesLogged(tracked.id)).toEqual([0, 120]);
  });

  it("keeps an undated Completed game undated when it is saved again", async () => {
    const g = await makeGame({ status: PlayStatus.COMPLETED, timesCompleted: 1 });
    await updatePlay(g.id, {}, form({ status: "COMPLETED", rating: "8" }));

    const after = await reload(g.id);
    expect(after.dateFinished).toBeNull();
    expect(after.rating).toBe(8);
  });

  it("completes a game played well past its usual time to beat", async () => {
    // 45 h 10 min against the usual 40 h: nothing refused, nothing clamped,
    // and no entry dated on the finish day.
    await setZone("America/New_York");
    clockAt("2026-10-12T15:00:00.000Z");
    const g = await makeGame({
      status: PlayStatus.PLAYING,
      dateStarted: new Date("2026-10-05T00:00:00Z"),
      lengthMinutes: 2400,
      playedMinutes: 2710,
    });
    await prisma.progressEntry.createMany({
      data: [
        { gameId: g.id, minutes: 0, date: new Date("2026-10-05T00:00:00Z") },
        { gameId: g.id, minutes: 2710, date: new Date("2026-10-08T16:00:00Z") },
      ],
    });
    const saved = await updatePlay(
      g.id,
      {},
      form({ status: "COMPLETED", dateStarted: "2026-10-05", dateFinished: "2026-10-11" }),
    );
    expect(saved.success).toBe(true);

    const after = await reload(g.id);
    expect(after.status).toBe(PlayStatus.COMPLETED);
    expect(after.playedMinutes).toBe(2710);
    expect(after.dateFinished?.toISOString()).toBe("2026-10-11T00:00:00.000Z");
    expect(await minutesLogged(g.id)).toEqual([0, 2710]);
  });

  it("closes the log on the finish day when a dropped game is picked up and completed", async () => {
    // A game being played logs its time through the quick row, so its last
    // session is already in the log when it is completed. A dropped one has
    // a time box instead: the time typed with Completed is the last
    // session, and belongs in the play calendar and the hours played on the
    // day it was completed in the player's zone, not on the day the form
    // was saved.
    await setZone("America/New_York");
    clockAt("2026-10-12T15:00:00.000Z");
    const g = await makeGame({
      status: PlayStatus.DROPPED,
      dateStarted: new Date("2026-10-05T00:00:00Z"),
      playedMinutes: 2400,
    });
    await prisma.progressEntry.createMany({
      data: [
        { gameId: g.id, minutes: 0, date: new Date("2026-10-05T00:00:00Z") },
        { gameId: g.id, minutes: 2400, date: new Date("2026-10-08T16:00:00Z") },
      ],
    });
    await updatePlay(
      g.id,
      {},
      form({ status: "COMPLETED", dateStarted: "2026-10-05", dateFinished: "2026-10-11", playedMinutes: "42:30" }),
    );

    expect((await reload(g.id)).playedMinutes).toBe(2550);
    const log = await progressOf(g.id);
    expect(log.map((e) => e.minutes)).toEqual([0, 2400, 2550]);
    const closing = log[2].date;
    expect(closing.getTime()).toBeLessThanOrEqual(Date.now());
    expect(new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(closing)).toBe(
      "2026-10-11",
    );
  });

  it("completing with Don't remember leaves no date and keeps the time", async () => {
    const g = await makeGame({ status: PlayStatus.WANT_TO_PLAY });
    await updatePlay(g.id, {}, form({ status: "PLAYING", playedMinutes: "2:00" }));
    await updatePlay(g.id, {}, form({ status: "COMPLETED", finishedUnknown: "on" }));

    const after = await reload(g.id);
    expect(after.dateFinished).toBeNull();
    expect(after.timesCompleted).toBe(1);
    expect(after.playedMinutes).toBe(120);
    expect(await minutesLogged(g.id)).toEqual([0, 120]);
  });

  it("counts archived playthroughs plus the current one in timesCompleted", async () => {
    const g = await makeGame({ status: PlayStatus.PLAYING });
    await prisma.playthrough.createMany({ data: [{ gameId: g.id }, { gameId: g.id }] });

    await updatePlay(g.id, {}, form({ status: "COMPLETED" }));
    expect((await reload(g.id)).timesCompleted).toBe(3);

    await updatePlay(g.id, {}, form({ status: "PLAYING" }));
    expect((await reload(g.id)).timesCompleted).toBe(2);
  });

  it("keeps the time for Dropped and clears it when back on Want to Play", async () => {
    const g = await makeGame({ status: PlayStatus.WANT_TO_PLAY });
    await updatePlay(g.id, {}, form({ status: "DROPPED", playedMinutes: "12:30" }));
    expect((await reload(g.id)).playedMinutes).toBe(750);

    await updatePlay(g.id, {}, form({ status: "WANT_TO_PLAY", playedMinutes: "12:30" }));
    expect((await reload(g.id)).playedMinutes).toBeNull();
  });

  it("takes a time past the usual time to beat, and logs it", async () => {
    // The time to beat is only what's usual, and plenty of players go well
    // past it: nothing is refused or clamped.
    const g = await makeGame({ status: PlayStatus.WANT_TO_PLAY, lengthMinutes: 600 });
    const result = await updatePlay(g.id, {}, form({ status: "PLAYING", playedMinutes: "45:10" }));

    expect(result.success).toBe(true);
    expect((await reload(g.id)).playedMinutes).toBe(2710);
    expect(await minutesLogged(g.id)).toEqual([0, 2710]);
  });

  it("refuses a time that isn't a time, and changes nothing", async () => {
    const g = await makeGame({ status: PlayStatus.DROPPED, playedMinutes: 720 });
    const result = await updatePlay(g.id, {}, form({ status: "DROPPED", playedMinutes: "lots" }));

    expect(result.error).toBe("Couldn't read “lots”. Type a time, like 12:30, 12h 30m or 45m.");
    expect((await reload(g.id)).playedMinutes).toBe(720);
    expect(await progressOf(g.id)).toHaveLength(0);
  });

  it("keeps the time when the form sends no time field, and clears it when sent empty", async () => {
    // A rating saved on a completed game must not wipe how long it took.
    const done = await makeGame({ status: PlayStatus.COMPLETED, timesCompleted: 1, playedMinutes: 2520 });
    await updatePlay(done.id, {}, form({ status: "COMPLETED", rating: "9" }));
    expect((await reload(done.id)).playedMinutes).toBe(2520);

    const dropped = await makeGame({ status: PlayStatus.DROPPED, playedMinutes: 720 });
    await updatePlay(dropped.id, {}, form({ status: "DROPPED", playedMinutes: "" }));
    expect((await reload(dropped.id)).playedMinutes).toBeNull();
  });

  it("refuses a finish date before the start date", async () => {
    const g = await makeGame({ status: PlayStatus.PLAYING });
    const result = await updatePlay(
      g.id,
      {},
      form({ status: "COMPLETED", dateStarted: "2026-10-05", dateFinished: "2026-10-01" }),
    );

    expect(result.error).toBe("Finish date is before the start date");
    expect((await reload(g.id)).status).toBe(PlayStatus.PLAYING);
  });

  it("starting a game from Want to Play fills in today as the start date", async () => {
    const g = await makeGame({ status: PlayStatus.WANT_TO_PLAY });
    await updatePlay(g.id, {}, form({ status: "PLAYING", dateStarted: "", playedMinutes: "40m" }));

    const after = await reload(g.id);
    expect(after.dateStarted?.toDateString()).toBe(new Date().toDateString());
    expect(await minutesLogged(g.id)).toEqual([0, 40]);
  });

  it("says when a save completed the game, and only then", async () => {
    const g = await makeGame({ status: PlayStatus.PLAYING });
    expect((await updatePlay(g.id, {}, form({ status: "COMPLETED" }))).finished).toBe(true);
    // Saving it again (a new rating, say) isn't completing it again.
    expect((await updatePlay(g.id, {}, form({ status: "COMPLETED", rating: "8" }))).finished).toBe(
      false,
    );
  });

  it("refuses another account's game", async () => {
    const g = await makeGame({ status: PlayStatus.PLAYING }, otherUserId);
    const result = await updatePlay(g.id, {}, form({ status: "COMPLETED" }));

    expect(result.error).toBe("Game not found");
    expect((await reload(g.id)).status).toBe(PlayStatus.PLAYING);
  });
});

describe("deleteGame", () => {
  it("removes the game and its cached cover", async () => {
    const cover = await writeCover("gone.jpg");
    const g = await makeGame({ coverUrl: cover });
    expect(await redirectOf(deleteGame(g.id))).toBe("/games");

    expect(await prisma.game.findUnique({ where: { id: g.id } })).toBeNull();
    expect(await coverExists(cover)).toBe(false);
  });

  it("leaves a cover file that another account's game points at", async () => {
    const theirs = await writeCover("theirs.jpg");
    await makeGame({ coverUrl: theirs }, otherUserId);
    const mine = await makeGame({ coverUrl: theirs });
    await redirectOf(deleteGame(mine.id));

    expect(await coverExists(theirs)).toBe(true);
  });

  it("does nothing to another account's game", async () => {
    const g = await makeGame({}, otherUserId);
    await deleteGame(g.id);
    expect(await prisma.game.findUnique({ where: { id: g.id } })).not.toBeNull();
  });
});
