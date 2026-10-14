import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PrismaClient, PlayStatus } from "@prisma/client";

/**
 * The game form actions against a real database: createGame, updateGame,
 * updatePlay (and the reading log it writes through logProgress), and
 * deleteGame's cover cleanup.
 *
 * The reading log is the part most worth pinning down. Stats count pages as
 * the gap between consecutive entries, so a missing page-0 anchor, or a
 * closing entry written where none should be, quietly shifts pages between
 * days and years without anything looking broken.
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
const { logPage } = await import("@/lib/actions/progress");

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
    prisma.user.create({ data: { username: `bk-${stamp}`, passwordHash: "x" } }),
    prisma.user.create({ data: { username: `bko-${stamp}`, passwordHash: "x" } }),
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
  title: "The Left Hand of Darkness",
  authors: "Ursula K. Le Guin",
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
    data: { userId: owner, title: "Test Game", searchText: "test game", pageCount: 300, ...over },
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
    orderBy: [{ date: "asc" }, { page: "asc" }],
  });
}

describe("createGame", () => {
  it("saves the game for the signed-in user and opens it", async () => {
    const url = await redirectOf(
      createGame({}, form({ ...gameFields, seriesName: "Hainish Cycle", status: "PLAYING" })),
    );

    const game = await prisma.game.findFirstOrThrow({ where: { userId } });
    expect(url).toBe(`/games/${game.id}`);
    expect(game.authors).toEqual(["Ursula K. Le Guin"]);
    expect(game.status).toBe(PlayStatus.PLAYING);
    expect(game.searchText).toBe("the left hand of darkness ursula k. le guin hainish cycle");
  });

  it("dates and counts a game added straight onto Read", async () => {
    // It used to land with no finish date and timesCompleted 0: in "Games read"
    // but missing from the year it was read and from the goal.
    await redirectOf(createGame({}, form({ ...gameFields, status: "COMPLETED" })));

    const game = await prisma.game.findFirstOrThrow({ where: { userId } });
    expect(game.dateFinished?.toDateString()).toBe(new Date().toDateString());
    expect(game.timesCompleted).toBe(1);
  });

  it("starts a game added as Currently Reading today", async () => {
    await redirectOf(createGame({}, form({ ...gameFields, status: "PLAYING" })));

    const game = await prisma.game.findFirstOrThrow({ where: { userId } });
    expect(game.dateStarted?.toDateString()).toBe(new Date().toDateString());
    expect(game.dateFinished).toBeNull();
    expect(game.timesCompleted).toBe(0);
  });

  it("saves a blank series number as none, not #0", async () => {
    await redirectOf(createGame({}, form({ ...gameFields, seriesName: "Jane Eyre", seriesNumber: "" })));

    const game = await prisma.game.findFirstOrThrow({ where: { userId } });
    expect(game.seriesNumber).toBeNull();
  });

  it("saves an audiobook's length, and no length for other formats", async () => {
    await redirectOf(
      createGame({}, form({ ...gameFields, title: "Heard", format: "AUDIOBOOK", lengthMinutes: "970" })),
    );
    await redirectOf(
      createGame({}, form({ ...gameFields, title: "Held", format: "PHYSICAL", lengthMinutes: "970" })),
    );

    const games = await prisma.game.findMany({ where: { userId }, orderBy: { title: "asc" } });
    expect(games.map((b) => [b.title, b.lengthMinutes])).toEqual([
      ["Heard", 970],
      ["Held", null],
    ]);
  });

  it("refuses a length out of range", async () => {
    const result = await createGame(
      {},
      form({ ...gameFields, format: "AUDIOBOOK", lengthMinutes: "60001" }),
    );
    expect(result.error).toBe("Length must be at most 1,000 hours");
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

  it("keeps the finish date picked for a game added as Read, and its rating", async () => {
    await redirectOf(
      createGame({}, form({ ...gameFields, status: "COMPLETED", dateFinished: "2019-06-14", rating: "8" })),
    );

    const game = await prisma.game.findFirstOrThrow({ where: { userId } });
    expect(game.dateFinished?.toISOString().slice(0, 10)).toBe("2019-06-14");
    expect(game.rating).toBe(8);
    expect(game.timesCompleted).toBe(1);
  });

  it("leaves a game added as Read undated when the reader doesn't remember", async () => {
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

  it("starts the log of a game added mid-read at its page, with no page-0 anchor", async () => {
    // Started 8 Oct on page 64 credits nothing to today: a lone first entry
    // has no predecessor to count from.
    await redirectOf(
      createGame(
        {},
        form({ ...gameFields, pageCount: "208", status: "PLAYING", dateStarted: "2026-10-08", currentPage: "64" }),
      ),
    );

    const game = await prisma.game.findFirstOrThrow({ where: { userId } });
    expect(game.dateStarted?.toISOString().slice(0, 10)).toBe("2026-10-08");
    expect(game.currentPage).toBe(64);
    const log = await progressOf(game.id);
    expect(log.map((e) => e.page)).toEqual([64]);
    expect(log[0].date.getTime()).toBeGreaterThanOrEqual(game.dateStarted!.getTime());

    // The next page logged counts from there.
    expect(await logPage(game.id, { page: 80, day: "today" })).toMatchObject({ ok: true });
    expect((await progressOf(game.id)).map((e) => e.page)).toEqual([64, 80]);
  });

  it("dates a game added mid-read now, even before a Started date typed today", async () => {
    // 08:30 on 12 October in Tokyo. Started, typed as today, is midnight
    // UTC: still half an hour ahead. Dated there, the entry would sit after
    // the morning's next log and refuse it.
    await setZone("Asia/Tokyo");
    clockAt("2026-10-11T23:30:00.000Z");
    await redirectOf(
      createGame(
        {},
        form({ ...gameFields, pageCount: "300", status: "PLAYING", dateStarted: "2026-10-12", currentPage: "50" }),
      ),
    );
    const game = await prisma.game.findFirstOrThrow({ where: { userId } });
    expect((await progressOf(game.id)).map((e) => [e.page, e.date.toISOString()])).toEqual([
      [50, "2026-10-11T23:30:00.000Z"],
    ]);

    vi.setSystemTime(new Date("2026-10-11T23:40:00.000Z"));
    expect(await logPage(game.id, { page: 60, day: "today" })).toMatchObject({ ok: true });
    expect((await progressOf(game.id)).map((e) => e.page)).toEqual([50, 60]);
    expect((await prisma.game.findUniqueOrThrow({ where: { id: game.id } })).currentPage).toBe(60);
  });

  it("logs nothing for a game added as Currently Reading on page 0", async () => {
    await redirectOf(createGame({}, form({ ...gameFields, status: "PLAYING", currentPage: "" })));
    const game = await prisma.game.findFirstOrThrow({ where: { userId } });
    expect(await progressOf(game.id)).toHaveLength(0);
  });

  it("refuses a page past the end or a finish date in the future, and saves nothing", async () => {
    const pastEnd = await createGame(
      {},
      form({ ...gameFields, pageCount: "208", status: "PLAYING", currentPage: "900" }),
    );
    expect(pastEnd.error).toBe("Page 900 is past the end of the game (208 pages)");

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
    const bk = await makeGame();
    await redirectOf(
      updateGame(bk.id, {}, form({ ...gameFields, title: "Lathe of Heaven", authors: "Le Guin" })),
    );

    const after = await prisma.game.findUniqueOrThrow({ where: { id: bk.id } });
    expect(after.title).toBe("Lathe of Heaven");
    expect(after.searchText).toBe("lathe of heaven le guin");
  });

  it("keeps the Open Library id the form sends", async () => {
    const bk = await makeGame({ openLibraryId: "OL27482W" });
    await redirectOf(updateGame(bk.id, {}, form({ ...gameFields, openLibraryId: "OL27482W" })));
    expect((await prisma.game.findUniqueOrThrow({ where: { id: bk.id } })).openLibraryId).toBe(
      "OL27482W",
    );
  });

  it("drops the length when the game stops being an audiobook", async () => {
    const bk = await makeGame();
    await redirectOf(updateGame(bk.id, {}, form({ ...gameFields, format: "AUDIOBOOK", lengthMinutes: "600" })));
    expect((await prisma.game.findUniqueOrThrow({ where: { id: bk.id } })).lengthMinutes).toBe(600);

    await redirectOf(updateGame(bk.id, {}, form({ ...gameFields, format: "EBOOK", lengthMinutes: "600" })));
    expect((await prisma.game.findUniqueOrThrow({ where: { id: bk.id } })).lengthMinutes).toBeNull();
  });

  it("refuses another account's game", async () => {
    const bk = await makeGame({}, otherUserId);
    const result = await updateGame(bk.id, {}, form({ ...gameFields, title: "Mine now" }));

    expect(result.error).toBe("Game not found");
    expect((await prisma.game.findUniqueOrThrow({ where: { id: bk.id } })).title).toBe("Test Game");
  });

  it("deletes the replaced cached cover", async () => {
    const old = await writeCover("old-cover.jpg");
    const bk = await makeGame({ coverUrl: old });
    await redirectOf(updateGame(bk.id, {}, form({ ...gameFields, coverUrl: "" })));

    expect(await coverExists(old)).toBe(false);
  });

  it("keeps a replaced cover file that another game still shows", async () => {
    const shared = await writeCover("shared-cover.jpg");
    const bk = await makeGame({ coverUrl: shared });
    await makeGame({ coverUrl: shared }, otherUserId);
    await redirectOf(updateGame(bk.id, {}, form({ ...gameFields, coverUrl: "" })));

    expect(await coverExists(shared)).toBe(true);
  });

  it("does not let a late cover download overwrite a newer cover", async () => {
    const bk = await makeGame();
    const late = await writeCover(`${bk.id}-late.jpg`);
    cacheCoverImage.mockResolvedValue(late);

    // First save starts a download; a second save picks another cover
    // before that download finishes.
    await redirectOf(
      updateGame(bk.id, {}, form({ ...gameFields, coverUrl: "https://a.example/1.jpg" })),
    );
    const firstDownload = deferred.shift()!;
    await redirectOf(updateGame(bk.id, {}, form({ ...gameFields, coverUrl: "/api/covers/new.jpg" })));
    await firstDownload();

    const after = await prisma.game.findUniqueOrThrow({ where: { id: bk.id } });
    expect(after.coverUrl).toBe("/api/covers/new.jpg");
    expect(await coverExists(late)).toBe(false); // nothing points at it
  });
});

describe("updatePlay and review search", () => {
  it("keeps the folded copy search reads in step with the review", async () => {
    const bk = await makeGame({ status: PlayStatus.COMPLETED });
    await updatePlay(bk.id, {}, form({ status: "COMPLETED", review: "Better than ÉMILE Brontë" }));
    let row = await prisma.game.findUniqueOrThrow({ where: { id: bk.id } });
    expect(row.reviewSearchText).toBe("better than emile bronte");

    await updatePlay(bk.id, {}, form({ status: "COMPLETED", review: "" }));
    row = await prisma.game.findUniqueOrThrow({ where: { id: bk.id } });
    expect(row.reviewSearchText).toBe("");
  });
});

describe("updatePlay and the reading log", () => {
  it("anchors the first progress update at page 0", async () => {
    const started = "2026-03-01";
    const bk = await makeGame({ status: PlayStatus.WANT_TO_PLAY });

    await updatePlay(bk.id, {}, form({ status: "PLAYING", dateStarted: started, currentPage: "74" }));
    const log = await progressOf(bk.id);
    expect(log.map((e) => e.page)).toEqual([0, 74]);
    expect(log[0].date.toISOString().slice(0, 10)).toBe(started);

    // Then each change, from a stopped game's page box.
    await updatePlay(bk.id, {}, form({ status: "DROPPED", dateStarted: started, currentPage: "74" }));
    await updatePlay(bk.id, {}, form({ status: "DROPPED", dateStarted: started, currentPage: "120" }));
    expect((await progressOf(bk.id)).map((e) => e.page)).toEqual([0, 74, 120]);

    // Saving without a page change logs nothing new.
    await updatePlay(bk.id, {}, form({ status: "DROPPED", dateStarted: started, currentPage: "120" }));
    expect((await progressOf(bk.id)).map((e) => e.page)).toEqual([0, 74, 120]);
  });

  it("never moves a game being read off its own page", async () => {
    // The quick row logs a game being read; the card has no page box then
    // and sends the page it was rendered with, here from before a log made
    // in another tab.
    const bk = await makeGame({
      status: PlayStatus.PLAYING,
      dateStarted: new Date("2026-03-01T00:00:00Z"),
      currentPage: 150,
    });
    await prisma.progressEntry.createMany({
      data: [
        { gameId: bk.id, page: 0, date: new Date("2026-03-01T00:00:00Z") },
        { gameId: bk.id, page: 150, date: new Date("2026-03-05T12:00:00Z") },
      ],
    });

    const saved = await updatePlay(
      bk.id,
      {},
      form({ status: "PLAYING", dateStarted: "2026-03-01", currentPage: "120", rating: "8" }),
    );
    expect(saved.success).toBe(true);
    let after = await prisma.game.findUniqueOrThrow({ where: { id: bk.id } });
    expect(after.currentPage).toBe(150);
    expect(after.rating).toBe(8);
    expect((await progressOf(bk.id)).map((e) => e.page)).toEqual([0, 150]);

    // Nor when it's stopped from the card.
    await updatePlay(bk.id, {}, form({ status: "DROPPED", dateStarted: "2026-03-01", currentPage: "120" }));
    after = await prisma.game.findUniqueOrThrow({ where: { id: bk.id } });
    expect(after.currentPage).toBe(150);
    expect((await progressOf(bk.id)).map((e) => e.page)).toEqual([0, 150]);
  });

  it("moves the read's start back when Started is moved earlier, never over the read before", async () => {
    await setZone("Europe/Oslo");
    clockAt("2026-10-12T10:00:00.000Z");
    const bk = await makeGame({
      status: PlayStatus.PLAYING,
      dateStarted: new Date("2026-10-05T00:00:00Z"),
      currentPage: 120,
    });
    await prisma.progressEntry.createMany({
      data: [
        { gameId: bk.id, page: 0, date: new Date("2026-09-01T10:00:00Z") },
        { gameId: bk.id, page: 300, date: new Date("2026-09-20T12:00:00Z") },
        { gameId: bk.id, page: 0, date: new Date("2026-10-05T00:00:00Z") },
        { gameId: bk.id, page: 120, date: new Date("2026-10-08T12:00:00Z") },
      ],
    });
    const anchorDate = async () =>
      (await progressOf(bk.id)).filter((e) => e.page === 0).at(-1)!.date.toISOString();

    await updatePlay(bk.id, {}, form({ status: "PLAYING", dateStarted: "2026-10-02" }));
    expect(await anchorDate()).toBe("2026-10-02T00:00:00.000Z");
    expect(await logPage(bk.id, { page: 60, day: "2026-10-03" })).toMatchObject({ ok: true });

    await updatePlay(bk.id, {}, form({ status: "PLAYING", dateStarted: "2026-09-15" }));
    expect(await anchorDate()).toBe("2026-09-20T12:00:00.001Z");
    expect((await progressOf(bk.id)).map((e) => e.page)).toEqual([0, 300, 0, 60, 120]);
  });

  it("never anchors a read after its first entry", async () => {
    // East of UTC, a Started date typed today is midnight UTC, which can
    // still be ahead of the moment the first page is logged. Tomorrow's
    // date (allowed, a day's slack) stands in for that here.
    const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
    const bk = await makeGame({ status: PlayStatus.WANT_TO_PLAY });
    await updatePlay(bk.id, {}, form({ status: "PLAYING", dateStarted: tomorrow, currentPage: "30" }));

    const log = await progressOf(bk.id);
    expect(log.map((e) => e.page)).toEqual([0, 30]);
    expect(log[0].date.getTime()).toBe(log[1].date.getTime());
  });

  it("finishing a tracked game closes the log at the last page", async () => {
    const bk = await makeGame({ status: PlayStatus.WANT_TO_PLAY });
    await updatePlay(bk.id, {}, form({ status: "PLAYING", currentPage: "120" }));
    await updatePlay(bk.id, {}, form({ status: "COMPLETED" }));

    const after = await prisma.game.findUniqueOrThrow({ where: { id: bk.id } });
    expect(after.currentPage).toBeNull();
    expect(after.timesCompleted).toBe(1);
    const log = await progressOf(bk.id);
    expect(log.map((e) => e.page)).toEqual([0, 120, 300]);
    expect(log[2].date.getTime()).toBe(after.dateFinished?.getTime());
  });

  it("finishing an untracked game logs nothing and fills in today", async () => {
    const bk = await makeGame({ status: PlayStatus.WANT_TO_PLAY });
    await updatePlay(bk.id, {}, form({ status: "COMPLETED" }));

    const after = await prisma.game.findUniqueOrThrow({ where: { id: bk.id } });
    expect(after.dateFinished?.toDateString()).toBe(new Date().toDateString());
    expect(await progressOf(bk.id)).toHaveLength(0);
  });

  it("keeps an undated Read game undated when it is saved again", async () => {
    const bk = await makeGame({ status: PlayStatus.COMPLETED, timesCompleted: 1 });
    await updatePlay(bk.id, {}, form({ status: "COMPLETED", rating: "8" }));

    const after = await prisma.game.findUniqueOrThrow({ where: { id: bk.id } });
    expect(after.dateFinished).toBeNull();
    expect(after.rating).toBe(8);
  });

  it("closes the log on a typed finish day in the reader's zone", async () => {
    // 11:00 on 12 October in New York. 11 October typed is midnight UTC,
    // which in New York is the evening of the 10th.
    await setZone("America/New_York");
    clockAt("2026-10-12T15:00:00.000Z");
    const bk = await makeGame({
      status: PlayStatus.PLAYING,
      dateStarted: new Date("2026-10-05T00:00:00Z"),
      currentPage: 120,
    });
    await prisma.progressEntry.createMany({
      data: [
        { gameId: bk.id, page: 0, date: new Date("2026-10-05T00:00:00Z") },
        { gameId: bk.id, page: 120, date: new Date("2026-10-08T16:00:00Z") },
      ],
    });
    await updatePlay(
      bk.id,
      {},
      form({ status: "COMPLETED", dateStarted: "2026-10-05", dateFinished: "2026-10-11" }),
    );
    // The last moment of the 11th in New York.
    expect((await progressOf(bk.id)).at(-1)?.date.toISOString()).toBe("2026-10-12T03:59:59.999Z");
  });

  it("finishing with Don't remember leaves no date and no closing log entry", async () => {
    const bk = await makeGame({ status: PlayStatus.WANT_TO_PLAY });
    await updatePlay(bk.id, {}, form({ status: "PLAYING", currentPage: "120" }));
    await updatePlay(bk.id, {}, form({ status: "COMPLETED", finishedUnknown: "on" }));

    const after = await prisma.game.findUniqueOrThrow({ where: { id: bk.id } });
    expect(after.dateFinished).toBeNull();
    expect(after.timesCompleted).toBe(1);
    expect((await progressOf(bk.id)).map((e) => e.page)).toEqual([0, 120]);
  });

  it("counts archived reads plus the current one in timesCompleted", async () => {
    const bk = await makeGame({ status: PlayStatus.PLAYING });
    await prisma.playthrough.createMany({ data: [{ gameId: bk.id }, { gameId: bk.id }] });

    await updatePlay(bk.id, {}, form({ status: "COMPLETED" }));
    expect((await prisma.game.findUniqueOrThrow({ where: { id: bk.id } })).timesCompleted).toBe(3);

    await updatePlay(bk.id, {}, form({ status: "PLAYING" }));
    expect((await prisma.game.findUniqueOrThrow({ where: { id: bk.id } })).timesCompleted).toBe(2);
  });

  it("keeps the page for DROPPED and clears it when reshelved", async () => {
    const bk = await makeGame({ status: PlayStatus.WANT_TO_PLAY });
    await updatePlay(bk.id, {}, form({ status: "DROPPED", currentPage: "218" }));
    expect((await prisma.game.findUniqueOrThrow({ where: { id: bk.id } })).currentPage).toBe(218);

    await updatePlay(bk.id, {}, form({ status: "WANT_TO_PLAY", currentPage: "218" }));
    expect((await prisma.game.findUniqueOrThrow({ where: { id: bk.id } })).currentPage).toBeNull();
  });

  it("refuses a page past the end of the game, and logs nothing", async () => {
    const bk = await makeGame({ status: PlayStatus.WANT_TO_PLAY, pageCount: 220 });
    const result = await updatePlay(bk.id, {}, form({ status: "PLAYING", currentPage: "9999" }));

    expect(result.error).toBe("Page 9999 is past the end of the game (220 pages)");
    expect((await prisma.game.findUniqueOrThrow({ where: { id: bk.id } })).currentPage).toBeNull();
    expect(await progressOf(bk.id)).toHaveLength(0);

    // The last page itself is fine.
    expect((await updatePlay(bk.id, {}, form({ status: "PLAYING", currentPage: "220" }))).success).toBe(true);
  });

  it("refuses a finish date before the start date", async () => {
    const bk = await makeGame({ status: PlayStatus.PLAYING });
    const result = await updatePlay(
      bk.id,
      {},
      form({ status: "COMPLETED", dateStarted: "2026-10-05", dateFinished: "2026-10-01" }),
    );

    expect(result.error).toBe("Finish date is before the start date");
    expect((await prisma.game.findUniqueOrThrow({ where: { id: bk.id } })).status).toBe(
      PlayStatus.PLAYING,
    );
  });

  it("starting a game from Want to Read fills in today as the start date", async () => {
    const bk = await makeGame({ status: PlayStatus.WANT_TO_PLAY });
    await updatePlay(bk.id, {}, form({ status: "PLAYING", dateStarted: "", currentPage: "40" }));

    const after = await prisma.game.findUniqueOrThrow({ where: { id: bk.id } });
    expect(after.dateStarted?.toDateString()).toBe(new Date().toDateString());
    expect((await progressOf(bk.id)).map((e) => e.page)).toEqual([0, 40]);
  });

  it("says when a save finished the game, and only then", async () => {
    const bk = await makeGame({ status: PlayStatus.PLAYING });
    expect((await updatePlay(bk.id, {}, form({ status: "COMPLETED" }))).finished).toBe(true);
    // Saving it again (a new rating, say) isn't finishing it again.
    expect((await updatePlay(bk.id, {}, form({ status: "COMPLETED", rating: "8" }))).finished).toBe(
      false,
    );
  });

  it("refuses another account's game", async () => {
    const bk = await makeGame({ status: PlayStatus.PLAYING }, otherUserId);
    const result = await updatePlay(bk.id, {}, form({ status: "COMPLETED" }));

    expect(result.error).toBe("Game not found");
    expect((await prisma.game.findUniqueOrThrow({ where: { id: bk.id } })).status).toBe(
      PlayStatus.PLAYING,
    );
  });
});

describe("deleteGame", () => {
  it("removes the game and its cached cover", async () => {
    const cover = await writeCover("gone.jpg");
    const bk = await makeGame({ coverUrl: cover });
    expect(await redirectOf(deleteGame(bk.id))).toBe("/games");

    expect(await prisma.game.findUnique({ where: { id: bk.id } })).toBeNull();
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
    const bk = await makeGame({}, otherUserId);
    await deleteGame(bk.id);
    expect(await prisma.game.findUnique({ where: { id: bk.id } })).not.toBeNull();
  });
});
