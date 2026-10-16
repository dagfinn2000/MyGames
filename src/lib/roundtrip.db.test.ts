import fs from "node:fs/promises";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import JSZip from "jszip";
import { GameOwnership, PrismaClient, PlayStatus, type Prisma } from "@prisma/client";
import { coverFilePath, coversDir } from "@/lib/covers";
import { buildSearchText, foldForSearch } from "@/lib/utils";

/**
 * Export a library, restore it into an empty account, and check that what
 * comes out the far end is the library that went in.
 *
 * This is the test the project most needed. Backup and restore are the only
 * features whose failure loses data you cannot get back, and the two halves
 * are written independently — an export field the import doesn't read, or a
 * shape change on one side, would go unnoticed until someone actually needed
 * their backup. So the main case compares the two libraries whole, row by
 * row and field by field, rather than spot-checking the fields someone
 * remembered: a column added later fails here until the restore reads it.
 */
const prisma = new PrismaClient();

let sourceUserId: string;
let targetUserId: string;

vi.mock("@/auth", () => ({
  auth: async () => ({ user: { id: process.env.__ROUNDTRIP_USER, name: "src" } }),
  signOut: async () => {},
}));

const { GET: exportRoute } = await import("@/app/api/export/route");
const { importLibrary } = await import("@/lib/import");

beforeEach(async () => {
  const stamp = `${Date.now()}-${Math.random()}`;
  const [a, b] = await Promise.all([
    prisma.user.create({ data: { username: `src-${stamp}`, passwordHash: "x" } }),
    prisma.user.create({ data: { username: `dst-${stamp}`, passwordHash: "x" } }),
  ]);
  sourceUserId = a.id;
  targetUserId = b.id;
  process.env.__ROUNDTRIP_USER = sourceUserId;
});

afterEach(async () => {
  await prisma.user.deleteMany({ where: { id: { in: [sourceUserId, targetUserId] } } });
  delete process.env.__ROUNDTRIP_USER;
});

/** Runs the real export route and returns the zip. */
async function exportZip() {
  const res = await exportRoute();
  expect(res.status).toBe(200);
  return JSZip.loadAsync(new Uint8Array(await res.arrayBuffer()));
}

/** Runs the real export route and returns the parsed library.json. */
async function exportLibrary() {
  const file = (await exportZip()).file("library.json");
  expect(file).not.toBeNull();
  return JSON.parse(await file!.async("text"));
}

const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

/** A game row as the app would have saved it, search text included. */
function gameData(
  userId: string,
  g: Omit<Prisma.GameUncheckedCreateInput, "userId" | "searchText" | "reviewSearchText">,
): Prisma.GameUncheckedCreateInput {
  return {
    ...g,
    userId,
    searchText: buildSearchText(g.title, (g.developers as string[]) ?? [], g.seriesName, g.platform),
    reviewSearchText: foldForSearch(g.review ?? ""),
  };
}

/**
 * Everything an account's library holds, with the ids that are new on every
 * instance left out and every list in a fixed order, so two accounts'
 * libraries can be compared whole.
 */
async function snapshot(userId: string) {
  const [games, shelves, goals] = await Promise.all([
    prisma.game.findMany({
      where: { userId },
      orderBy: [{ createdAt: "asc" }, { title: "asc" }],
      include: {
        shelves: { select: { name: true }, orderBy: { name: "asc" } },
        playthroughs: { orderBy: { createdAt: "asc" } },
        progress: { orderBy: [{ date: "asc" }, { minutes: "asc" }] },
        loans: { orderBy: { lentAt: "asc" } },
      },
    }),
    prisma.shelf.findMany({ where: { userId }, orderBy: { name: "asc" }, select: { name: true } }),
    prisma.playGoal.findMany({
      where: { userId },
      orderBy: { year: "asc" },
      select: { year: true, target: true, unit: true, countReplays: true },
    }),
  ]);
  const own = <T extends { id: string; gameId: string }>({ id: _id, gameId: _gameId, ...rest }: T) =>
    rest;
  return {
    shelves,
    goals,
    games: games.map(({ id: _id, userId: _userId, playthroughs, progress, loans, ...game }) => ({
      ...game,
      playthroughs: playthroughs.map(own),
      progress: progress.map(own),
      loans: loans.map(own),
    })),
  };
}

describe("export -> import round trip", () => {
  it("restores a full library into an empty account unchanged", async () => {
    const [favourites, coop] = await Promise.all([
      prisma.shelf.create({ data: { userId: sourceUserId, name: "Favourites" } }),
      prisma.shelf.create({ data: { userId: sourceUserId, name: "Couch co-op" } }),
    ]);
    await prisma.playGoal.createMany({
      data: [
        { userId: sourceUserId, year: 2026, target: 24, unit: "GAMES", countReplays: true },
        { userId: sourceUserId, year: 2025, target: 300, unit: "HOURS", countReplays: false },
      ],
    });

    // Completed twice: the latest pass on the row (its time kept, "Completed
    // in 102 h"), the first one archived with its own time.
    await prisma.game.create({
      data: {
        ...gameData(sourceUserId, {
          title: "The Witcher 3: Wild Hunt",
          developers: ["CD Projekt Red"],
          publisher: "CD Projekt",
          platform: "PC",
          description: "Geralt looks for Ciri.",
          coverUrl: "https://images.igdb.com/igdb/image/upload/t_cover_big/co1wyy.jpg",
          lengthMinutes: 3060,
          releaseDate: "2015-05-19",
          tags: ["rpg", "open world"],
          format: "DIGITAL",
          ownership: GameOwnership.OWNED,
          seriesName: "The Witcher",
          seriesNumber: 3,
          catalogueId: "igdb:the-witcher-3-wild-hunt",
          status: PlayStatus.COMPLETED,
          rating: 9,
          review: "Superb. Gwent alone is worth it.",
          dateStarted: day("2026-01-01"),
          dateFinished: day("2026-03-20"),
          timesCompleted: 2,
          playedMinutes: 6120,
          createdAt: new Date("2024-05-01T10:00:00.000Z"),
        }),
        shelves: { connect: { id: favourites.id } },
        playthroughs: {
          create: [
            {
              dateStarted: day("2019-05-01"),
              dateFinished: day("2019-06-01"),
              rating: 8,
              playedMinutes: 5400,
              note: "Death March",
              createdAt: new Date("2019-06-01T12:00:00.000Z"),
            },
          ],
        },
        progress: {
          create: [
            { minutes: 0, date: new Date("2026-01-01T09:00:00.000Z") },
            { minutes: 3000, date: new Date("2026-02-10T21:00:00.000Z") },
            { minutes: 6120, date: new Date("2026-03-20T22:00:00.000Z") },
          ],
        },
      },
    });

    // Being played on the Switch, lent out once and out again now.
    await prisma.game.create({
      data: {
        ...gameData(sourceUserId, {
          title: "Hollow Knight",
          developers: ["Team Cherry"],
          publisher: "Team Cherry",
          platform: "Nintendo Switch",
          lengthMinutes: 1620,
          releaseDate: "2017",
          tags: ["metroidvania"],
          format: "PHYSICAL",
          catalogueId: "igdb:hollow-knight",
          status: PlayStatus.PLAYING,
          dateStarted: day("2026-09-01"),
          playedMinutes: 750,
          createdAt: new Date("2025-01-01T10:00:00.000Z"),
        }),
        shelves: { connect: [{ id: favourites.id }, { id: coop.id }] },
        progress: {
          create: [
            { minutes: 0, date: new Date("2026-09-01T18:00:00.000Z") },
            { minutes: 750, date: new Date("2026-09-14T22:30:00.000Z") },
          ],
        },
        loans: {
          create: [
            { borrower: "Kari", lentAt: day("2026-02-01"), returnedAt: day("2026-02-20") },
            { borrower: "Ola", lentAt: day("2026-10-01"), note: "with the case" },
          ],
        },
      },
    });

    // The same catalogue entry on another system: a second game, not a
    // duplicate of the first.
    await prisma.game.create({
      data: gameData(sourceUserId, {
        title: "Hollow Knight",
        developers: ["Team Cherry"],
        platform: "PC",
        format: "SUBSCRIPTION",
        catalogueId: "igdb:hollow-knight",
        createdAt: new Date("2025-02-01T10:00:00.000Z"),
      }),
    });

    // Dropped part-way, typed in by hand, and since sold.
    await prisma.game.create({
      data: {
        ...gameData(sourceUserId, {
          title: "Portal 2",
          developers: ["Valve"],
          platform: "PlayStation 3",
          ownership: GameOwnership.GIVEN_AWAY,
          status: PlayStatus.DROPPED,
          dateStarted: day("2023-04-01"),
          playedMinutes: 240,
          seriesName: "Portal",
          seriesNumber: 2,
          createdAt: new Date("2023-03-01T10:00:00.000Z"),
        }),
        progress: { create: [{ minutes: 240, date: new Date("2023-04-02T20:00:00.000Z") }] },
      },
    });

    // On the wishlist, with almost nothing filled in.
    await prisma.game.create({
      data: gameData(sourceUserId, {
        title: "Hades II",
        developers: ["Supergiant Games"],
        ownership: GameOwnership.WISHLIST,
        createdAt: new Date("2026-06-01T10:00:00.000Z"),
      }),
    });

    const payload = await exportLibrary();
    expect(payload).toMatchObject({ format: "mygames-export", version: 1 });
    expect(payload.games).toHaveLength(5);

    const summary = await importLibrary(targetUserId, payload);
    expect(summary).toEqual({
      gamesCreated: 5,
      gamesSkipped: 0,
      gamesInvalid: 0,
      shelvesCreated: 2,
      goalsRestored: 2,
      savedViewsRestored: 0,
      settingsRestored: false,
      coversRestored: 0,
      playthroughsRestored: 1,
      progressRestored: 6,
      loansRestored: 2,
    });

    const [before, after] = await Promise.all([snapshot(sourceUserId), snapshot(targetUserId)]);
    expect(after).toEqual(before);

    // The comparison above is the test; these say in words what it covers,
    // and keep it honest should both sides ever come back empty.
    expect(after.games.map((g) => [g.title, g.platform])).toEqual([
      ["Portal 2", "PlayStation 3"],
      ["The Witcher 3: Wild Hunt", "PC"],
      ["Hollow Knight", "Nintendo Switch"],
      ["Hollow Knight", "PC"],
      ["Hades II", null],
    ]);
    const witcher = after.games[1];
    expect(witcher).toMatchObject({
      developers: ["CD Projekt Red"],
      publisher: "CD Projekt",
      lengthMinutes: 3060,
      releaseDate: "2015-05-19",
      catalogueId: "igdb:the-witcher-3-wild-hunt",
      format: "DIGITAL",
      playedMinutes: 6120,
      timesCompleted: 2,
      // Rebuilt, so search and review search find a restored game.
      searchText: "the witcher 3: wild hunt cd projekt red the witcher pc",
      reviewSearchText: "superb. gwent alone is worth it.",
    });
    expect(witcher.playthroughs).toMatchObject([{ playedMinutes: 5400, rating: 8, note: "Death March" }]);
    expect(witcher.progress.map((p) => p.minutes)).toEqual([0, 3000, 6120]);
    // Lending survives, including which loan is still open.
    const switchCopy = after.games[2];
    expect(switchCopy.loans.filter((l) => l.returnedAt === null).map((l) => l.borrower)).toEqual(["Ola"]);
    expect(switchCopy.shelves.map((s) => s.name)).toEqual(["Couch co-op", "Favourites"]);
    expect(after.goals).toEqual([
      { year: 2025, target: 300, unit: "HOURS", countReplays: false },
      { year: 2026, target: 24, unit: "GAMES", countReplays: true },
    ]);
  });

  it("brings bundled covers back from the zip", async () => {
    // Unique per run, so a file left in COVERS_DIR by an earlier run can't
    // make the restore find it already there.
    const name = `roundtrip-${Date.now().toString(16)}${Math.floor(Math.random() * 1e6).toString(16)}.png`;
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 7, 7, 7]);
    await fs.mkdir(coversDir(), { recursive: true });
    await fs.writeFile(coverFilePath(name), png);
    await prisma.game.create({
      data: gameData(sourceUserId, { title: "Celeste", coverUrl: `/api/covers/${name}` }),
    });

    const zip = await exportZip();
    expect(zip.file(`covers/${name}`)).not.toBeNull();
    const payload = JSON.parse(await zip.file("library.json")!.async("text"));

    // A fresh instance: the cover cache doesn't have the file.
    await fs.rm(coverFilePath(name));
    const summary = await importLibrary(targetUserId, payload, async (filename) => {
      const entry = zip.file(`covers/${filename}`);
      return entry ? entry.async("uint8array") : null;
    });
    expect(summary).toMatchObject({ gamesCreated: 1, coversRestored: 1 });

    const restored = await prisma.game.findFirstOrThrow({ where: { userId: targetUserId } });
    expect(restored.coverUrl).toBe(`/api/covers/${name}`);
    expect(new Uint8Array(await fs.readFile(coverFilePath(name)))).toEqual(png);
    await fs.rm(coverFilePath(name), { force: true });
  });

  it("keeps every ownership state", async () => {
    for (const ownership of Object.values(GameOwnership)) {
      await prisma.game.create({
        data: gameData(sourceUserId, { title: `Copy ${ownership}`, ownership }),
      });
    }

    await importLibrary(targetUserId, await exportLibrary());
    const rows = await prisma.game.findMany({
      where: { userId: targetUserId },
      orderBy: { title: "asc" },
    });
    expect(rows.map((g) => [g.title, g.ownership])).toEqual(
      Object.values(GameOwnership)
        .map((o) => [`Copy ${o}`, o])
        .sort(([a], [b]) => (a < b ? -1 : 1)),
    );
  });

  it("does not leak the internal columns into the backup", async () => {
    await prisma.game.create({
      data: gameData(sourceUserId, { title: "Inside", review: "Good" }),
    });

    const payload = await exportLibrary();
    // userId would tie a backup to an account it may be restored away from;
    // searchText and reviewSearchText are derived and rebuilt on import.
    expect(payload.games[0]).not.toHaveProperty("userId");
    expect(payload.games[0]).not.toHaveProperty("searchText");
    expect(payload.games[0]).not.toHaveProperty("reviewSearchText");
    expect(payload.games[0].review).toBe("Good");
  });

  it("survives a library with nothing in it", async () => {
    const payload = await exportLibrary();
    expect(payload.games).toEqual([]);

    const summary = await importLibrary(targetUserId, payload);
    expect(summary).toMatchObject({ gamesCreated: 0, gamesInvalid: 0 });
  });

  it("is idempotent: restoring the same backup twice changes nothing", async () => {
    await prisma.game.createMany({
      data: [
        gameData(sourceUserId, {
          title: "Hollow Knight",
          developers: ["Team Cherry"],
          platform: "PC",
          catalogueId: "igdb:hollow-knight",
        }),
        gameData(sourceUserId, { title: "Hollow Knight", developers: ["Team Cherry"], platform: "Nintendo Switch" }),
        gameData(sourceUserId, { title: "Portal 2", developers: ["Valve"] }),
      ],
    });

    const payload = await exportLibrary();
    const first = await importLibrary(targetUserId, payload);
    const second = await importLibrary(targetUserId, payload);

    expect(first).toMatchObject({ gamesCreated: 3, gamesSkipped: 0 });
    expect(second).toMatchObject({ gamesCreated: 0, gamesSkipped: 3 });
    expect(await prisma.game.count({ where: { userId: targetUserId } })).toBe(3);
  });

  it("carries settings, saved views and goal options across", async () => {
    const view = await prisma.savedView.create({
      data: {
        userId: sourceUserId,
        name: "Next up",
        query: "shelf=WANT_TO_PLAY&group=none&sort=createdAt&dir=desc",
      },
    });
    await prisma.savedView.create({
      data: {
        userId: sourceUserId,
        name: "RPGs",
        query: "tag=rpg&group=none&sort=title&dir=asc",
      },
    });
    await prisma.user.update({
      where: { id: sourceUserId },
      data: {
        theme: "auto:sage:obsidian",
        libraryView: { layout: "list", sort: "title", dir: "asc" },
        preferences: {
          dateFormat: "iso",
          ratingStyle: "ten",
          quickLogSteps: "15m-30m",
          statsHoursPlayed: "finished",
          timeZone: "America/New_York",
          defaultViewId: view.id,
        },
      },
    });
    await prisma.playGoal.create({
      data: {
        userId: sourceUserId,
        year: 2026,
        target: 300,
        unit: "HOURS",
        countReplays: false,
      },
    });
    // The new account has already been visited once, which saved its zone.
    await prisma.user.update({
      where: { id: targetUserId },
      data: { preferences: { timeZone: "Europe/Oslo" } },
    });

    const payload = await exportLibrary();
    // The unit travels with the target: 300 is hours, not games.
    expect(payload.playGoals).toEqual([
      { year: 2026, target: 300, unit: "HOURS", countReplays: false },
    ]);

    const summary = await importLibrary(targetUserId, payload);
    expect(summary).toMatchObject({
      goalsRestored: 1,
      savedViewsRestored: 2,
      settingsRestored: true,
    });

    const target = await prisma.user.findUniqueOrThrow({
      where: { id: targetUserId },
      include: { savedViews: true },
    });
    expect(target.theme).toBe("auto:sage:obsidian");
    expect(target.libraryView).toMatchObject({ layout: "list", sort: "title", dir: "asc" });
    const nextUp = target.savedViews.find((v) => v.name === "Next up");
    expect(target.savedViews.map((v) => v.name).sort()).toEqual(["Next up", "RPGs"]);
    expect(target.preferences).toEqual({
      // What the account already had stays; the rest comes from the backup.
      timeZone: "Europe/Oslo",
      dateFormat: "iso",
      ratingStyle: "ten",
      quickLogSteps: "15m-30m",
      statsHoursPlayed: "finished",
      // The default view points at the restored copy, not the old id.
      defaultViewId: nextUp?.id,
    });

    const goal = await prisma.playGoal.findFirstOrThrow({ where: { userId: targetUserId } });
    expect(goal).toMatchObject({ target: 300, unit: "HOURS", countReplays: false });
  });

  it("keeps the shelf and saved-view order by name", async () => {
    const [a, b, hidden] = await Promise.all(
      ["Alpha", "Beta", "Hidden"].map((name) =>
        prisma.shelf.create({ data: { userId: sourceUserId, name } }),
      ),
    );
    const [v1, v2] = await Promise.all(
      ["One", "Two"].map((name) =>
        prisma.savedView.create({
          data: { userId: sourceUserId, name, query: "group=none&sort=title&dir=asc" },
        }),
      ),
    );
    await prisma.user.update({
      where: { id: sourceUserId },
      data: {
        preferences: {
          shelfOrder: [b.id, a.id, "gone-shelf"],
          hiddenShelves: [hidden.id],
          savedViewOrder: [v2.id, v1.id],
        },
      },
    });

    const payload = await exportLibrary();
    expect(payload.shelves.every((s: object) => !("id" in s))).toBe(true);
    expect(payload.settings).toMatchObject({
      shelfOrderNames: ["Beta", "Alpha"],
      hiddenShelfNames: ["Hidden"],
      savedViewOrderNames: ["Two", "One"],
    });

    await importLibrary(targetUserId, payload);
    const target = await prisma.user.findUniqueOrThrow({
      where: { id: targetUserId },
      include: { shelves: true, savedViews: true },
    });
    const shelfId = (name: string) => target.shelves.find((s) => s.name === name)?.id;
    const viewId = (name: string) => target.savedViews.find((v) => v.name === name)?.id;
    expect(target.preferences).toMatchObject({
      shelfOrder: [shelfId("Beta"), shelfId("Alpha")],
      hiddenShelves: [shelfId("Hidden")],
      savedViewOrder: [viewId("Two"), viewId("One")],
    });
  });

  it("points a saved view kept to one shelf at the restored shelf", async () => {
    const shelf = await prisma.shelf.create({ data: { userId: sourceUserId, name: "Cosy" } });
    await prisma.savedView.create({
      data: {
        userId: sourceUserId,
        name: "Cosy games",
        query: `shelfId=${shelf.id}&group=none&sort=title&dir=asc`,
      },
    });

    const payload = await exportLibrary();
    expect(payload.savedViews).toEqual([
      { name: "Cosy games", query: expect.any(String), shelfName: "Cosy" },
    ]);

    await importLibrary(targetUserId, payload);
    const [restoredShelf, view] = await Promise.all([
      prisma.shelf.findFirstOrThrow({ where: { userId: targetUserId, name: "Cosy" } }),
      prisma.savedView.findFirstOrThrow({ where: { userId: targetUserId } }),
    ]);
    expect(restoredShelf.id).not.toBe(shelf.id);
    expect(new URLSearchParams(view.query).get("shelfId")).toBe(restoredShelf.id);
  });

  it("leaves a theme the account already chose alone", async () => {
    await prisma.user.update({ where: { id: sourceUserId }, data: { theme: "dracula" } });
    await prisma.user.update({ where: { id: targetUserId }, data: { theme: "sage" } });

    await importLibrary(targetUserId, await exportLibrary());
    const target = await prisma.user.findUniqueOrThrow({ where: { id: targetUserId } });
    expect(target.theme).toBe("sage");
  });
});
