import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PrismaClient, PlayStatus } from "@prisma/client";

/**
 * Server actions against a real database.
 *
 * Two things are being pinned down here. First, `timesCompleted` is *derived*
 * (archived passes plus the current one when it's finished) and is
 * recalculated from several directions — playing again, adding a past
 * playthrough, deleting one. Getting it wrong silently misreports how many
 * times you've completed a game and skews the yearly goal. Second, every action is supposed to
 * scope its writes to the signed-in user; that promise is only worth anything
 * if something checks it.
 */

const prisma = new PrismaClient();

// The actions resolve identity through auth(); the session itself is not what
// is under test here, so it's stubbed and swapped per-test.
let currentUserId: string | null = null;
vi.mock("@/auth", () => ({
  auth: async () => (currentUserId ? { user: { id: currentUserId } } : null),
  signOut: async () => {},
}));

// Server actions call revalidatePath, which needs a request scope.
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

const { playAgain, addPastPlaythrough, deletePastPlaythrough, updatePastPlaythrough } = await import(
  "@/lib/actions/playthroughs"
);
const { bulkUpdateGames } = await import("@/lib/actions/bulk");
const { renameTag, deleteTag, removeTagRule } = await import("@/lib/actions/tags");
const { lendGame, returnLoan, deleteLoan } = await import("@/lib/actions/loans");
const { createShelf } = await import("@/lib/actions/shelves");

let userId: string;
let otherUserId: string;

async function makeGame(over: Record<string, unknown> = {}, owner = userId) {
  return prisma.game.create({
    data: {
      userId: owner,
      title: "Hollow Knight",
      searchText: "hollow knight team cherry pc",
      developers: ["Team Cherry"],
      platform: "PC",
      lengthMinutes: 1620,
      ...over,
    },
  });
}

function form(fields: Record<string, string>) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

beforeEach(async () => {
  const stamp = `${Date.now()}-${Math.random()}`;
  const [a, b] = await Promise.all([
    prisma.user.create({ data: { username: `act-${stamp}`, passwordHash: "x" } }),
    prisma.user.create({ data: { username: `oth-${stamp}`, passwordHash: "x" } }),
  ]);
  userId = a.id;
  otherUserId = b.id;
  currentUserId = userId;
});

afterEach(async () => {
  await prisma.user.deleteMany({ where: { id: { in: [userId, otherUserId] } } });
});

describe("playthrough bookkeeping", () => {
  it("playAgain archives the completed pass with its time and restarts the game", async () => {
    const finished = new Date("2026-01-10T00:00:00.000Z");
    const bk = await makeGame({
      status: PlayStatus.COMPLETED,
      dateStarted: new Date("2026-01-01T00:00:00.000Z"),
      dateFinished: finished,
      rating: 9,
      timesCompleted: 1,
      playedMinutes: 2520,
    });

    await playAgain(bk.id);

    const after = await prisma.game.findFirstOrThrow({
      where: { id: bk.id },
      include: { playthroughs: true, progress: true },
    });

    expect(after.status).toBe(PlayStatus.PLAYING);
    expect(after.dateFinished).toBeNull();
    // The new pass starts with no time played...
    expect(after.playedMinutes).toBeNull();
    // ...and the pass moved from "current" to "archived" — the total is unchanged.
    expect(after.timesCompleted).toBe(1);
    expect(after.playthroughs).toHaveLength(1);
    expect(after.playthroughs[0].dateFinished?.toISOString()).toBe(finished.toISOString());
    expect(after.playthroughs[0].rating).toBe(9);
    // The archived pass keeps the time it took ("Completed in 42 h").
    expect(after.playthroughs[0].playedMinutes).toBe(2520);
    // A 0-minute anchor so the new playthrough's pace starts from zero.
    expect(after.progress).toHaveLength(1);
    expect(after.progress[0].minutes).toBe(0);
  });

  it("playAgain does nothing to a game that isn't completed", async () => {
    const bk = await makeGame({ status: PlayStatus.PLAYING });
    await playAgain(bk.id);

    const after = await prisma.game.findFirstOrThrow({
      where: { id: bk.id },
      include: { playthroughs: true },
    });
    expect(after.status).toBe(PlayStatus.PLAYING);
    expect(after.playthroughs).toHaveLength(0);
  });

  it("playAgain refuses a game belonging to someone else", async () => {
    const bk = await makeGame({ status: PlayStatus.COMPLETED, timesCompleted: 1 }, otherUserId);
    await playAgain(bk.id);

    const after = await prisma.game.findFirstOrThrow({ where: { id: bk.id } });
    expect(after.status).toBe(PlayStatus.COMPLETED); // untouched
  });

  it("adding and deleting a past playthrough keeps timesCompleted consistent", async () => {
    const bk = await makeGame({ status: PlayStatus.COMPLETED, timesCompleted: 1 });

    await addPastPlaythrough({}, form({ gameId: bk.id, dateFinished: "2019-05-01", rating: "8" }));
    let after = await prisma.game.findFirstOrThrow({
      where: { id: bk.id },
      include: { playthroughs: true },
    });
    expect(after.playthroughs).toHaveLength(1);
    expect(after.timesCompleted).toBe(2); // one archived + the current completed pass

    await deletePastPlaythrough(after.playthroughs[0].id);
    after = await prisma.game.findFirstOrThrow({
      where: { id: bk.id },
      include: { playthroughs: true },
    });
    expect(after.playthroughs).toHaveLength(0);
    expect(after.timesCompleted).toBe(1);
  });

  it("an unfinished game with archived passes counts only the archived ones", async () => {
    const bk = await makeGame({ status: PlayStatus.PLAYING, timesCompleted: 0 });
    await addPastPlaythrough({}, form({ gameId: bk.id, dateFinished: "2019-05-01" }));

    const after = await prisma.game.findFirstOrThrow({ where: { id: bk.id } });
    expect(after.timesCompleted).toBe(1);
  });

  it("addPastPlaythrough refuses a game belonging to someone else", async () => {
    const bk = await makeGame({}, otherUserId);
    const res = await addPastPlaythrough({}, form({ gameId: bk.id, dateFinished: "2019-05-01" }));

    expect(res).toHaveProperty("error");
    expect(await prisma.playthrough.count({ where: { gameId: bk.id } })).toBe(0);
  });
});

describe("past-playthrough notes and times", () => {
  async function onlyCompleted(gameId: string) {
    return prisma.playthrough.findFirstOrThrow({ where: { gameId } });
  }

  it("addPastPlaythrough stores the note trimmed, and an empty one as nothing", async () => {
    const bk = await makeGame();
    await addPastPlaythrough({}, form({ gameId: bk.id, note: "  Played it co-op with my sister  " }));
    expect((await onlyCompleted(bk.id)).note).toBe("Played it co-op with my sister");

    const other = await makeGame();
    await addPastPlaythrough({}, form({ gameId: other.id, note: "   " }));
    expect((await onlyCompleted(other.id)).note).toBeNull();
  });

  it("updatePastPlaythrough changes the note, and an empty field clears it", async () => {
    const bk = await makeGame();
    const pass = await prisma.playthrough.create({ data: { gameId: bk.id, note: "First go" } });

    const res = await updatePastPlaythrough(pass.id, {}, form({ note: "Second go", rating: "6" }));
    expect(res).toEqual({ success: true });
    expect(await onlyCompleted(bk.id)).toMatchObject({ note: "Second go", rating: 6 });

    await updatePastPlaythrough(pass.id, {}, form({ note: "" }));
    expect((await onlyCompleted(bk.id)).note).toBeNull();
  });

  it("updatePastPlaythrough keeps the note when the field isn't sent", async () => {
    const bk = await makeGame();
    const pass = await prisma.playthrough.create({ data: { gameId: bk.id, note: "Keep me" } });

    await updatePastPlaythrough(pass.id, {}, form({ dateFinished: "2019-05-01" }));
    expect((await onlyCompleted(bk.id)).note).toBe("Keep me");
  });

  it("updatePastPlaythrough refuses another account's playthrough and changes nothing", async () => {
    const bk = await makeGame({}, otherUserId);
    const pass = await prisma.playthrough.create({ data: { gameId: bk.id, note: "Theirs", rating: 8 } });

    const res = await updatePastPlaythrough(pass.id, {}, form({ note: "Mine now", rating: "2" }));
    expect(res).toEqual({ error: "Playthrough not found" });
    expect(await onlyCompleted(bk.id)).toMatchObject({ note: "Theirs", rating: 8 });
  });

  it("updatePastPlaythrough turns away a note over 2000 characters", async () => {
    const bk = await makeGame();
    const pass = await prisma.playthrough.create({ data: { gameId: bk.id, note: "Short" } });

    const res = await updatePastPlaythrough(pass.id, {}, form({ note: "x".repeat(2001) }));
    expect(res).toEqual({ error: "Keep the note to 2000 characters or fewer." });
    expect((await onlyCompleted(bk.id)).note).toBe("Short");
  });

  it("playAgain archives the pass without a note", async () => {
    const bk = await makeGame({ status: PlayStatus.COMPLETED, timesCompleted: 1 });
    await playAgain(bk.id);
    expect((await onlyCompleted(bk.id)).note).toBeNull();
  });

  it("addPastPlaythrough reads a typed time played, and a blank one as none", async () => {
    const bk = await makeGame();
    await addPastPlaythrough({}, form({ gameId: bk.id, dateFinished: "2019-05-01", playedMinutes: "42:30" }));
    expect((await onlyCompleted(bk.id)).playedMinutes).toBe(2550);

    const other = await makeGame();
    await addPastPlaythrough({}, form({ gameId: other.id, playedMinutes: "  " }));
    expect((await onlyCompleted(other.id)).playedMinutes).toBeNull();
  });

  it("addPastPlaythrough explains a time it can't read and records nothing", async () => {
    const bk = await makeGame();
    const res = await addPastPlaythrough({}, form({ gameId: bk.id, playedMinutes: "a while" }));

    expect(res.error).toMatch(/^Couldn't read “a while”\./);
    expect(await prisma.playthrough.count({ where: { gameId: bk.id } })).toBe(0);
  });

  it("updatePastPlaythrough changes the time when sent, keeps it when not, and a blank clears it", async () => {
    const bk = await makeGame();
    const pass = await prisma.playthrough.create({ data: { gameId: bk.id, playedMinutes: 600 } });

    await updatePastPlaythrough(pass.id, {}, form({ playedMinutes: "12h 30m" }));
    expect((await onlyCompleted(bk.id)).playedMinutes).toBe(750);

    // A request without the field (an older form) leaves the time alone.
    await updatePastPlaythrough(pass.id, {}, form({ rating: "7" }));
    expect(await onlyCompleted(bk.id)).toMatchObject({ playedMinutes: 750, rating: 7 });

    await updatePastPlaythrough(pass.id, {}, form({ playedMinutes: "" }));
    expect((await onlyCompleted(bk.id)).playedMinutes).toBeNull();
  });
});

describe("bulkUpdateGames", () => {
  it("applies status, tags and shelf together", async () => {
    const [b1, b2] = await Promise.all([makeGame(), makeGame()]);
    const shelf = await prisma.shelf.create({ data: { userId, name: "Shelf" } });

    const res = await bulkUpdateGames({
      gameIds: [b1.id, b2.id],
      status: PlayStatus.COMPLETED,
      addShelfId: shelf.id,
      addTags: ["metroidvania"],
    });

    expect(res.count).toBe(2);
    const games = await prisma.game.findMany({
      where: { id: { in: [b1.id, b2.id] } },
      include: { shelves: true },
    });
    for (const b of games) {
      expect(b.status).toBe(PlayStatus.COMPLETED);
      expect(b.tags).toContain("metroidvania");
      expect(b.shelves).toHaveLength(1);
    }
  });

  it("dates and counts games moved to Completed, as the playthrough card does", async () => {
    // A bare status update left these undated with timesCompleted 0, so they
    // were missing from the yearly stats and the goal.
    const fresh = await makeGame({ status: PlayStatus.PLAYING });
    const dated = await makeGame({
      status: PlayStatus.PLAYING,
      dateFinished: new Date("2026-02-03T00:00:00.000Z"),
    });
    const replayed = await makeGame({ status: PlayStatus.PLAYING });
    await prisma.playthrough.create({ data: { gameId: replayed.id } });

    const res = await bulkUpdateGames({
      gameIds: [fresh.id, dated.id, replayed.id],
      status: PlayStatus.COMPLETED,
    });
    expect(res.count).toBe(3);

    const rows = await prisma.game.findMany({
      where: { id: { in: [fresh.id, dated.id, replayed.id] } },
    });
    const byId = new Map(rows.map((r) => [r.id, r]));
    expect(byId.get(fresh.id)?.dateFinished?.toDateString()).toBe(new Date().toDateString());
    expect(byId.get(fresh.id)?.timesCompleted).toBe(1);
    expect(byId.get(dated.id)?.dateFinished?.toISOString()).toBe("2026-02-03T00:00:00.000Z");
    expect(byId.get(replayed.id)?.timesCompleted).toBe(2);
  });

  it("uncounts games moved off Completed and clears their time", async () => {
    const bk = await makeGame({ status: PlayStatus.COMPLETED, timesCompleted: 1, playedMinutes: 50 });
    await bulkUpdateGames({ gameIds: [bk.id], status: PlayStatus.WANT_TO_PLAY });

    const after = await prisma.game.findUniqueOrThrow({ where: { id: bk.id } });
    expect(after.status).toBe(PlayStatus.WANT_TO_PLAY);
    expect(after.timesCompleted).toBe(0);
    expect(after.playedMinutes).toBeNull();
  });

  it("merges tags instead of appending duplicates", async () => {
    const bk = await makeGame({ tags: ["metroidvania", "indie"] });
    await bulkUpdateGames({ gameIds: [bk.id], addTags: ["metroidvania", "replay"] });

    const after = await prisma.game.findFirstOrThrow({ where: { id: bk.id } });
    expect([...after.tags].sort()).toEqual(["indie", "metroidvania", "replay"]);
  });

  it("silently drops ids belonging to another account", async () => {
    const mine = await makeGame();
    const theirs = await makeGame({}, otherUserId);

    const res = await bulkUpdateGames({
      gameIds: [mine.id, theirs.id],
      status: PlayStatus.DROPPED,
    });

    expect(res.count).toBe(1);
    expect((await prisma.game.findFirstOrThrow({ where: { id: theirs.id } })).status).toBe(
      PlayStatus.WANT_TO_PLAY,
    );
  });

  it("takes games off a shelf, leaving the others on it", async () => {
    const [a, b, c] = await Promise.all([makeGame(), makeGame(), makeGame()]);
    const shelf = await prisma.shelf.create({
      data: { userId, name: "Shelf", games: { connect: [{ id: a.id }, { id: b.id }, { id: c.id }] } },
    });

    const res = await bulkUpdateGames({ gameIds: [a.id, b.id], removeShelfId: shelf.id });
    expect(res.count).toBe(2);

    const after = await prisma.shelf.findUniqueOrThrow({
      where: { id: shelf.id },
      select: { games: { select: { id: true } } },
    });
    expect(after.games.map((x) => x.id)).toEqual([c.id]);
  });

  it("won't take games off another account's shelf", async () => {
    const bk = await makeGame();
    const theirShelf = await prisma.shelf.create({ data: { userId: otherUserId, name: "Theirs" } });
    expect(await bulkUpdateGames({ gameIds: [bk.id], removeShelfId: theirShelf.id })).toEqual({
      error: "Shelf not found",
    });
  });

  it("rejects a shelf belonging to another account without writing anything", async () => {
    const bk = await makeGame();
    const theirShelf = await prisma.shelf.create({
      data: { userId: otherUserId, name: "Theirs" },
    });

    const res = await bulkUpdateGames({
      gameIds: [bk.id],
      status: PlayStatus.COMPLETED,
      addShelfId: theirShelf.id,
    });

    expect(res.error).toBeTruthy();
    // The status must not have been applied either — the whole action is one
    // unit, so a rejected shelf leaves nothing behind.
    const after = await prisma.game.findFirstOrThrow({ where: { id: bk.id } });
    expect(after.status).toBe(PlayStatus.WANT_TO_PLAY);
  });
});

describe("tag management", () => {
  it("renames a tag across the library, merging onto an existing one", async () => {
    await makeGame({ tags: ["scifi"] });
    await makeGame({ tags: ["scifi", "fantasy"] });

    const res = await renameTag("scifi", "fantasy");
    expect(res.count).toBe(2);

    const games = await prisma.game.findMany({ where: { userId } });
    for (const b of games) {
      expect(b.tags).toContain("fantasy");
      expect(b.tags).not.toContain("scifi");
      // Merging must not leave a duplicate behind.
      expect(b.tags.filter((t) => t === "fantasy")).toHaveLength(1);
    }
  });

  it("won't rename a tag to one with a comma", async () => {
    // The library's tag filter keeps its tags comma-separated in the URL.
    await makeGame({ tags: ["scifi"] });
    expect(await renameTag("scifi", "science, fiction")).toEqual({
      error: "Tags can't contain commas.",
    });
    const bk = await prisma.game.findFirstOrThrow({ where: { userId } });
    expect(bk.tags).toEqual(["scifi"]);
  });

  it("deletes a tag everywhere without touching other tags", async () => {
    await makeGame({ tags: ["scifi", "fantasy"] });
    const res = await deleteTag("scifi");

    expect(res.count).toBe(1);
    const bk = await prisma.game.findFirstOrThrow({ where: { userId } });
    expect(bk.tags).toEqual(["fantasy"]);
  });

  it("leaves another account's tags alone", async () => {
    const theirs = await makeGame({ tags: ["scifi"] }, otherUserId);
    await deleteTag("scifi");

    const after = await prisma.game.findFirstOrThrow({ where: { id: theirs.id } });
    expect(after.tags).toEqual(["scifi"]);
  });
});

describe("shelves", () => {
  it("refuses a second shelf whose name differs only by case or spaces", async () => {
    expect(await createShelf({}, form({ name: "Favourites" }))).toEqual({ success: true });
    expect(await createShelf({}, form({ name: "favourites " }))).toEqual({
      error: 'You already have a shelf called "Favourites"',
    });
    expect(await prisma.shelf.count({ where: { userId } })).toBe(1);
  });

  it("doesn't count another account's shelf as a duplicate", async () => {
    await prisma.shelf.create({ data: { userId: otherUserId, name: "Favourites" } });
    expect(await createShelf({}, form({ name: "Favourites" }))).toEqual({ success: true });
  });
});

describe("lending", () => {
  it("lends a game out and reports who has it", async () => {
    const bk = await makeGame();
    const res = await lendGame(bk.id, {}, form({ borrower: "Kari", note: "back by June" }));
    expect(res).toEqual({ success: true });

    const loans = await prisma.loan.findMany({ where: { gameId: bk.id } });
    expect(loans).toHaveLength(1);
    expect(loans[0].borrower).toBe("Kari");
    expect(loans[0].returnedAt).toBeNull();
    expect(loans[0].note).toBe("back by June");
  });

  it("refuses a second loan while the game is still out", async () => {
    // Two open loans would make "who has it?" unanswerable.
    const bk = await makeGame();
    await lendGame(bk.id, {}, form({ borrower: "Kari" }));
    const res = await lendGame(bk.id, {}, form({ borrower: "Ola" }));

    expect(res.error).toContain("Kari");
    expect(await prisma.loan.count({ where: { gameId: bk.id } })).toBe(1);
  });

  it("allows lending again once the previous loan came back", async () => {
    const bk = await makeGame();
    await lendGame(bk.id, {}, form({ borrower: "Kari" }));
    const first = await prisma.loan.findFirstOrThrow({ where: { gameId: bk.id } });

    await returnLoan(first.id);
    const res = await lendGame(bk.id, {}, form({ borrower: "Ola" }));

    expect(res).toEqual({ success: true });
    const loans = await prisma.loan.findMany({ where: { gameId: bk.id }, orderBy: { lentAt: "asc" } });
    expect(loans).toHaveLength(2);
    // The returned one stays as history rather than being overwritten.
    expect(loans[0].returnedAt).not.toBeNull();
    expect(loans[1].returnedAt).toBeNull();
  });

  it("requires a borrower", async () => {
    const bk = await makeGame();
    const res = await lendGame(bk.id, {}, form({ borrower: "   " }));
    expect(res.error).toBeTruthy();
    expect(await prisma.loan.count({ where: { gameId: bk.id } })).toBe(0);
  });

  it("only lends a copy you own", async () => {
    // The card hides "Lend out" for these; the action refuses them too.
    for (const ownership of ["BORROWED", "GIVEN_AWAY", "WISHLIST"]) {
      const bk = await makeGame({ ownership });
      const res = await lendGame(bk.id, {}, form({ borrower: "Kari" }));

      expect(res.error).toBe("Only a copy you own can be lent out.");
      expect(await prisma.loan.count({ where: { gameId: bk.id } })).toBe(0);
    }
  });

  it("only lends a physical copy", async () => {
    // A download or a subscription game has no disc or cartridge to hand over.
    for (const format of ["DIGITAL", "SUBSCRIPTION"]) {
      const bk = await makeGame({ format });
      const res = await lendGame(bk.id, {}, form({ borrower: "Kari" }));

      expect(res.error).toBe("Only a physical copy can be lent out.");
      expect(await prisma.loan.count({ where: { gameId: bk.id } })).toBe(0);
    }
  });

  it("refuses to lend another account's game", async () => {
    const theirs = await makeGame({}, otherUserId);
    const res = await lendGame(theirs.id, {}, form({ borrower: "Kari" }));

    expect(res.error).toBeTruthy();
    expect(await prisma.loan.count({ where: { gameId: theirs.id } })).toBe(0);
  });

  it("refuses to return or delete another account's loan", async () => {
    const theirs = await makeGame({}, otherUserId);
    const loan = await prisma.loan.create({
      data: { gameId: theirs.id, borrower: "Someone" },
    });

    await returnLoan(loan.id);
    expect((await prisma.loan.findFirstOrThrow({ where: { id: loan.id } })).returnedAt).toBeNull();

    await deleteLoan(loan.id);
    expect(await prisma.loan.count({ where: { id: loan.id } })).toBe(1);
  });

  it("returning an already-returned loan does not move the date", async () => {
    const bk = await makeGame();
    await lendGame(bk.id, {}, form({ borrower: "Kari" }));
    const loan = await prisma.loan.findFirstOrThrow({ where: { gameId: bk.id } });

    await returnLoan(loan.id);
    const firstReturn = (await prisma.loan.findFirstOrThrow({ where: { id: loan.id } })).returnedAt;
    await returnLoan(loan.id);
    const secondReturn = (await prisma.loan.findFirstOrThrow({ where: { id: loan.id } })).returnedAt;

    expect(secondReturn?.toISOString()).toBe(firstReturn?.toISOString());
  });

  it("deleting a loan removes it from the history", async () => {
    const bk = await makeGame();
    await lendGame(bk.id, {}, form({ borrower: "Kari" }));
    const loan = await prisma.loan.findFirstOrThrow({ where: { gameId: bk.id } });

    await deleteLoan(loan.id);
    expect(await prisma.loan.count({ where: { gameId: bk.id } })).toBe(0);
  });

  it("loans disappear with the game", async () => {
    const bk = await makeGame();
    await lendGame(bk.id, {}, form({ borrower: "Kari" }));
    await prisma.game.delete({ where: { id: bk.id } });

    expect(await prisma.loan.count({ where: { gameId: bk.id } })).toBe(0);
  });
});

describe("tag rules for future imports", () => {
  async function prefsOf(id: string) {
    const user = await prisma.user.findUniqueOrThrow({ where: { id } });
    return (user.preferences ?? {}) as Record<string, unknown>;
  }

  it("renameTag with remember stores the rule, without it stores nothing", async () => {
    await makeGame({ tags: ["science fiction"] });

    const plain = await renameTag("science fiction", "scifi");
    expect(plain.ruleSaved).toBeUndefined();
    expect((await prefsOf(userId)).tagRenames).toBeUndefined();

    // Recorded even though no game carries the tag any more.
    const res = await renameTag("Science Fiction", "sci-fi", { remember: true });
    expect(res).toEqual({ count: 0, ruleSaved: true });
    expect((await prefsOf(userId)).tagRenames).toEqual([{ from: "science fiction", to: "sci-fi" }]);
  });

  it("refuses a new name with a comma in it", async () => {
    await makeGame({ tags: ["sf"] });
    expect((await renameTag("sf", "sci, fi", { remember: true })).error).toBe(
      "Tags can't contain commas.",
    );
    expect((await prisma.game.findFirstOrThrow({ where: { userId } })).tags).toEqual(["sf"]);
  });

  it("deleteTag with neverImport stores the skip", async () => {
    await makeGame({ tags: ["indie"] });
    const res = await deleteTag("indie", { neverImport: true });
    expect(res).toEqual({ count: 1, ruleSaved: true });
    expect((await prefsOf(userId)).tagSkips).toEqual(["indie"]);
  });

  it("keeps the other preferences when it writes a rule", async () => {
    await prisma.user.update({
      where: { id: userId },
      data: { preferences: { dateFormat: "iso", tagSkips: ["general"] } },
    });
    await renameTag("sf", "sci-fi", { remember: true });

    const prefs = await prefsOf(userId);
    expect(prefs.dateFormat).toBe("iso");
    expect(prefs.tagSkips).toEqual(["general"]);
    expect(prefs.tagRenames).toEqual([{ from: "sf", to: "sci-fi" }]);
  });

  it("removeTagRule takes one rule out and keeps the rest", async () => {
    await renameTag("sf", "sci-fi", { remember: true });
    await renameTag("rpg", "role-playing", { remember: true });
    await deleteTag("general", { neverImport: true });

    expect(await removeTagRule({ from: "sf" })).toEqual({});
    expect(await removeTagRule({ skip: "general" })).toEqual({});
    const prefs = await prefsOf(userId);
    expect(prefs.tagRenames).toEqual([{ from: "rpg", to: "role-playing" }]);
    expect(prefs.tagSkips).toEqual([]);
    expect((await removeTagRule({})).error).toBe("Invalid input");
  });

  it("stores rules on the signed-in account only", async () => {
    await renameTag("sf", "sci-fi", { remember: true });
    await deleteTag("indie", { neverImport: true });
    expect(await prefsOf(otherUserId)).toEqual({});
  });
});

describe("bulk Set status: Completed and the finish-date preference", () => {
  it("leaves the finish date empty when undated is chosen, and keeps a date already there", async () => {
    await prisma.user.update({
      where: { id: userId },
      data: { preferences: { addedAsCompletedFinished: "undated" } },
    });
    const finished = new Date("2024-03-10T00:00:00.000Z");
    const plain = await makeGame({ status: PlayStatus.PLAYING });
    const dated = await makeGame({ status: PlayStatus.DROPPED, dateFinished: finished });

    const res = await bulkUpdateGames({ gameIds: [plain.id, dated.id], status: PlayStatus.COMPLETED });
    expect(res.count).toBe(2);

    const a = await prisma.game.findUniqueOrThrow({ where: { id: plain.id } });
    expect(a.dateFinished).toBeNull();
    expect(a.timesCompleted).toBe(1);
    const b = await prisma.game.findUniqueOrThrow({ where: { id: dated.id } });
    expect(b.dateFinished).toEqual(finished);
  });

  it("still finishes them today by default", async () => {
    const bk = await makeGame({ status: PlayStatus.WANT_TO_PLAY });
    await bulkUpdateGames({ gameIds: [bk.id], status: PlayStatus.COMPLETED });
    const after = await prisma.game.findUniqueOrThrow({ where: { id: bk.id } });
    expect(after.dateFinished?.toDateString()).toBe(new Date().toDateString());
  });
});
