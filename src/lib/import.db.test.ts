import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PrismaClient, PlayStatus } from "@prisma/client";
import { importLibrary } from "@/lib/import";

/**
 * Restore is the one path that can quietly mangle a library: it decides which
 * games are duplicates, materializes play history, and rebuilds relations.
 * These run against a real Postgres because the failures worth catching —
 * unique constraints, cascades, nested creates — are exactly the ones a
 * hand-written fake would reproduce faithfully and wrongly.
 */
const prisma = new PrismaClient();

let userId: string;

/** A minimal valid backup; `games` are merged over the defaults. */
function payload(games: unknown[], extra: Record<string, unknown> = {}) {
  return { format: "mygames-export", version: 1, games, ...extra };
}

function game(over: Record<string, unknown> = {}) {
  return {
    title: "Hollow Knight",
    developers: ["Team Cherry"],
    platform: "Nintendo Switch",
    catalogueId: "igdb:hollow-knight",
    lengthMinutes: 1620,
    tags: ["metroidvania"],
    format: "PHYSICAL",
    ownership: "OWNED",
    status: "COMPLETED",
    rating: 9,
    timesCompleted: 1,
    shelves: [],
    quotes: [],
    playthroughs: [],
    progress: [],
    ...over,
  };
}

type Summary = Extract<Awaited<ReturnType<typeof importLibrary>>, { gamesCreated: number }>;

beforeEach(async () => {
  const user = await prisma.user.create({
    data: { username: `imp-${Date.now()}-${Math.random()}`, passwordHash: "x" },
  });
  userId = user.id;
});

afterEach(async () => {
  await prisma.user.delete({ where: { id: userId } }).catch(() => {});
});

describe("importLibrary", () => {
  it("rejects anything that isn't a MyGames backup", async () => {
    for (const bad of [
      {},
      { format: "other", version: 1, games: [] },
      { format: "myreads-export", version: 1, books: [] },
      null,
      42,
    ]) {
      const res = await importLibrary(userId, bad);
      expect(res).toEqual({ error: "That isn't a MyGames backup." });
    }
  });

  it("says so when a backup comes from a newer MyGames", async () => {
    const res = await importLibrary(userId, { format: "mygames-export", version: 2, games: [] });
    expect(res).toHaveProperty("error");
    expect((res as { error: string }).error).toContain("newer version of MyGames");
  });

  it("restores a game with its quotes, playthroughs and play log", async () => {
    const res = await importLibrary(
      userId,
      payload([
        game({
          publisher: "Team Cherry",
          releaseDate: "2017-02-24",
          playedMinutes: 1700,
          quotes: [{ text: "Hallownest is a vast kingdom.", speaker: "Elderbug", note: "the first line" }],
          playthroughs: [
            {
              dateFinished: "2019-05-01T00:00:00.000Z",
              rating: 8,
              playedMinutes: 1500,
              note: "Steel Soul",
            },
          ],
          progress: [
            { minutes: 0, date: "2026-01-01T10:00:00.000Z" },
            { minutes: 120, date: "2026-01-02T10:00:00.000Z" },
          ],
          timesCompleted: 2,
        }),
      ]),
    );

    expect(res).toMatchObject({
      gamesCreated: 1,
      gamesSkipped: 0,
      gamesInvalid: 0,
      quotesRestored: 1,
      playthroughsRestored: 1,
      progressRestored: 2,
    });

    const saved = await prisma.game.findFirstOrThrow({
      where: { userId },
      include: { quotes: true, playthroughs: true, progress: { orderBy: { date: "asc" } } },
    });
    expect(saved).toMatchObject({
      title: "Hollow Knight",
      developers: ["Team Cherry"],
      publisher: "Team Cherry",
      platform: "Nintendo Switch",
      catalogueId: "igdb:hollow-knight",
      lengthMinutes: 1620,
      releaseDate: "2017-02-24",
      // Kept on a completed game: the time that playthrough took.
      playedMinutes: 1700,
    });
    expect(saved.quotes[0]).toMatchObject({
      text: "Hallownest is a vast kingdom.",
      speaker: "Elderbug",
      note: "the first line",
    });
    expect(saved.playthroughs[0]).toMatchObject({ rating: 8, playedMinutes: 1500, note: "Steel Soul" });
    // The 0-minute anchor is a real entry, not a blank.
    expect(saved.progress.map((p) => p.minutes)).toEqual([0, 120]);
    // Derived, not trusted from the file: one archived pass + the current one.
    expect(saved.timesCompleted).toBe(2);
  });

  it("splits a tag with a comma in it, which the tag filter couldn't hold", async () => {
    await importLibrary(
      userId,
      payload([game({ tags: ["Action, Adventure", "metroidvania", "metroidvania,", "x".repeat(51)] })]),
    );
    const saved = await prisma.game.findFirstOrThrow({ where: { userId } });
    expect([...saved.tags].sort()).toEqual(["action", "adventure", "metroidvania"]);
  });

  it("skips a game already present by catalogue id and platform, whatever its title", async () => {
    await importLibrary(userId, payload([game()]));
    const second = await importLibrary(userId, payload([game({ title: "Hollow Knight (Voidheart Edition)" })]));

    expect(second).toMatchObject({ gamesCreated: 0, gamesSkipped: 1 });
    expect(await prisma.game.count({ where: { userId } })).toBe(1);
  });

  it("restores the same catalogue entry on another platform as another game", async () => {
    await importLibrary(userId, payload([game()]));
    const second = await importLibrary(userId, payload([game({ platform: "PC" })]));

    expect(second).toMatchObject({ gamesCreated: 1, gamesSkipped: 0 });
    expect(await prisma.game.count({ where: { userId } })).toBe(2);
  });

  it("tells a remake from the original by catalogue id, though the names match", async () => {
    const original = game({
      title: "Resident Evil",
      developers: ["Capcom"],
      platform: "PC",
      catalogueId: "igdb:resident-evil",
    });
    await importLibrary(userId, payload([original]));
    const second = await importLibrary(
      userId,
      payload([{ ...original, catalogueId: "igdb:resident-evil--1" }]),
    );

    expect(second).toMatchObject({ gamesCreated: 1, gamesSkipped: 0 });
  });

  it("skips a game without a catalogue id by title, platform and developers", async () => {
    const plain = game({ catalogueId: null, developers: ["Team Cherry", "Nintendo"] });
    await importLibrary(userId, payload([plain]));
    // Case, accents, spacing and the order of developers aside.
    const second = await importLibrary(
      userId,
      payload([
        {
          ...plain,
          title: "  HOLLOW   knight ",
          platform: "nintendo switch",
          developers: ["Nintendo", "Team Chérry"],
        },
      ]),
    );

    expect(second).toMatchObject({ gamesCreated: 0, gamesSkipped: 1 });
    expect(await prisma.game.count({ where: { userId } })).toBe(1);
  });

  it("does not take a game on another platform, or by other developers, for the same one", async () => {
    await importLibrary(userId, payload([game({ catalogueId: null })]));
    const second = await importLibrary(
      userId,
      payload([
        game({ catalogueId: null, platform: "PC" }),
        game({ catalogueId: null, developers: ["Someone Else"] }),
      ]),
    );

    expect(second).toMatchObject({ gamesCreated: 2, gamesSkipped: 0 });
  });

  it.each([
    ["with a catalogue id", "igdb:hollow-knight"],
    ["without a catalogue id", null],
  ])("takes a game with no platform for the same one on any platform, %s", async (_, catalogueId) => {
    // The platform filled in here after the backup was made: restoring
    // that backup again mustn't bring the game back a second time.
    const backup = payload([game({ catalogueId, platform: null })]);
    await importLibrary(userId, backup);
    await prisma.game.updateMany({ where: { userId }, data: { platform: "Nintendo Switch" } });
    expect(await importLibrary(userId, backup)).toMatchObject({ gamesCreated: 0, gamesSkipped: 1 });

    // And the other way round: a platform in the backup, none here.
    await prisma.game.updateMany({ where: { userId }, data: { platform: null } });
    expect(await importLibrary(userId, payload([game({ catalogueId })]))).toMatchObject({
      gamesCreated: 0,
      gamesSkipped: 1,
    });
    expect(await prisma.game.count({ where: { userId } })).toBe(1);
  });

  it("matches by title when only one side has a catalogue id", async () => {
    // Found in the catalogue later, or typed in by hand here: the same game.
    await importLibrary(userId, payload([game({ catalogueId: null })]));
    expect(await importLibrary(userId, payload([game()]))).toMatchObject({
      gamesCreated: 0,
      gamesSkipped: 1,
    });

    await prisma.game.deleteMany({ where: { userId } });
    await importLibrary(userId, payload([game()]));
    expect(await importLibrary(userId, payload([game({ catalogueId: null })]))).toMatchObject({
      gamesCreated: 0,
      gamesSkipped: 1,
    });
  });

  it("skips the second copy when one payload contains a game twice", async () => {
    // The dedup sets are updated as the payload is walked; this is the case
    // that breaks if that pass is ever parallelised.
    const res = await importLibrary(userId, payload([game(), game()]));
    expect(res).toMatchObject({ gamesCreated: 1, gamesSkipped: 1 });
    expect(await prisma.game.count({ where: { userId } })).toBe(1);
  });

  it("keeps a physical and a digital copy of one game from the same file", async () => {
    const res = await importLibrary(
      userId,
      payload([
        game(),
        game({ format: "DIGITAL" }),
        game({ catalogueId: null, format: "SUBSCRIPTION" }),
        game({ catalogueId: null, format: "SUBSCRIPTION" }),
      ]),
    );
    expect(res).toMatchObject({ gamesCreated: 3, gamesSkipped: 1 });
    expect(await prisma.game.count({ where: { userId } })).toBe(3);

    // And a second restore of that file still adds nothing.
    const again = await importLibrary(userId, payload([game(), game({ format: "DIGITAL" })]));
    expect(again).toMatchObject({ gamesCreated: 0, gamesSkipped: 2 });
  });

  it("is safe to re-run: a second restore of the same file adds nothing", async () => {
    const file = payload([
      game(),
      game({ title: "Hollow Knight: Silksong", catalogueId: "igdb:hollow-knight-silksong" }),
    ]);
    const first = await importLibrary(userId, file);
    const second = await importLibrary(userId, file);

    expect(first).toMatchObject({ gamesCreated: 2 });
    expect(second).toMatchObject({ gamesCreated: 0, gamesSkipped: 2 });
    expect(await prisma.game.count({ where: { userId } })).toBe(2);
  });

  it("counts invalid games without aborting the rest of the restore", async () => {
    const res = await importLibrary(
      userId,
      payload([
        game(),
        { title: "" },
        "not a game",
        game({ title: "Celeste", developers: ["Maddy Makes Games"], catalogueId: "igdb:celeste" }),
      ]),
    );
    expect(res).toMatchObject({ gamesCreated: 2, gamesInvalid: 2 });
  });

  it("drops a value the form would refuse on its own, keeping the game", async () => {
    const res = await importLibrary(
      userId,
      payload([
        game({
          catalogueId: "isbn:9780765311788",
          publisher: "p".repeat(201),
          platform: "x".repeat(101),
          lengthMinutes: 0,
          playedMinutes: -5,
          releaseDate: "",
          developers: ["Team Cherry", "", 7, "d".repeat(201)],
          quotes: [
            { text: "" },
            { text: "Kept", speaker: "s".repeat(201) },
            { text: "Also kept", speaker: "  The Hornet  " },
          ],
          playthroughs: [{ playedMinutes: "lots", rating: 11 }],
          progress: [
            { minutes: "ten", date: "2026-01-01T10:00:00.000Z" },
            { minutes: 30, date: "2026-01-02T10:00:00.000Z" },
            { minutes: 60 },
          ],
        }),
      ]),
    );
    expect(res).toMatchObject({
      gamesCreated: 1,
      gamesInvalid: 0,
      quotesRestored: 2,
      playthroughsRestored: 1,
      progressRestored: 1,
    });

    const saved = await prisma.game.findFirstOrThrow({
      where: { userId },
      include: { quotes: { orderBy: { text: "asc" } }, playthroughs: true, progress: true },
    });
    expect(saved).toMatchObject({
      catalogueId: null,
      publisher: null,
      platform: null,
      lengthMinutes: null,
      playedMinutes: null,
      releaseDate: null,
      developers: ["Team Cherry"],
    });
    expect(saved.quotes.map((q) => [q.text, q.speaker])).toEqual([
      ["Also kept", "The Hornet"],
      ["Kept", null],
    ]);
    expect(saved.playthroughs[0]).toMatchObject({ playedMinutes: null, rating: null });
    expect(saved.progress.map((p) => p.minutes)).toEqual([30]);
  });

  it("keeps time played past the usual time to beat", async () => {
    // Time played is never capped at the time to beat: plenty of games
    // take longer than the usual run.
    await importLibrary(
      userId,
      payload([game({ status: "PLAYING", lengthMinutes: 600, playedMinutes: 2710 })]),
    );
    const saved = await prisma.game.findFirstOrThrow({ where: { userId } });
    expect(saved).toMatchObject({ lengthMinutes: 600, playedMinutes: 2710 });
  });

  it("creates shelves referenced only by games, and links them", async () => {
    const res = await importLibrary(
      userId,
      payload([game({ shelves: ["Metroidvanias", "Favourites"] })], {
        shelves: [{ name: "Metroidvanias" }],
      }),
    );
    expect(res).toMatchObject({ gamesCreated: 1 });

    const saved = await prisma.game.findFirstOrThrow({
      where: { userId },
      include: { shelves: true },
    });
    expect(saved.shelves.map((s) => s.name).sort()).toEqual(["Favourites", "Metroidvanias"]);
  });

  it("reuses an existing shelf rather than duplicating it", async () => {
    await prisma.shelf.create({ data: { userId, name: "Metroidvanias" } });
    await importLibrary(userId, payload([game({ shelves: ["Metroidvanias"] })]));

    expect(await prisma.shelf.count({ where: { userId, name: "Metroidvanias" } })).toBe(1);
  });

  it("matches an existing shelf whatever the case, as the shelf form does", async () => {
    const mine = await prisma.shelf.create({ data: { userId, name: "Favourites" } });
    const res = await importLibrary(
      userId,
      payload([game({ shelves: ["favourites", "FAVOURITES"] })], {
        shelves: [{ name: "favourites" }],
      }),
    );
    expect(res).toMatchObject({ gamesCreated: 1, shelvesCreated: 0 });

    const saved = await prisma.game.findFirstOrThrow({
      where: { userId },
      include: { shelves: true },
    });
    expect(saved.shelves.map((s) => s.id)).toEqual([mine.id]);
  });

  it("takes shelf names the way the shelf form does, one at a time", async () => {
    // Trimmed, and a name past 50 characters dropped on its own rather than
    // taking the game's other shelves with it.
    const res = await importLibrary(
      userId,
      payload([game({ shelves: ["  Padded  ", "x".repeat(5000), "Kept", 7] })], {
        shelves: [{ name: "y".repeat(51) }, { name: " Listed " }, null],
      }),
    );
    expect(res).toMatchObject({ gamesCreated: 1, shelvesCreated: 3 });

    const shelves = await prisma.shelf.findMany({ where: { userId }, orderBy: { name: "asc" } });
    expect(shelves.map((s) => s.name)).toEqual(["Kept", "Listed", "Padded"]);
    const saved = await prisma.game.findFirstOrThrow({
      where: { userId },
      include: { shelves: true },
    });
    expect(saved.shelves.map((s) => s.name).sort()).toEqual(["Kept", "Padded"]);
  });

  it("materializes history from timesCompleted when a file gives only the count", async () => {
    // A file put together by hand may say "completed three times" and
    // nothing more. Three = the current pass plus two archived ones, so
    // timesCompleted stays consistent with the rows created.
    await importLibrary(userId, payload([game({ timesCompleted: 3, playthroughs: [] })]));

    const saved = await prisma.game.findFirstOrThrow({
      where: { userId },
      include: { playthroughs: true },
    });
    expect(saved.playthroughs).toHaveLength(2);
    expect(saved.timesCompleted).toBe(3);
  });

  it("upserts play goals in their own unit", async () => {
    await prisma.playGoal.create({ data: { userId, year: 2026, target: 12 } });
    const res = await importLibrary(
      userId,
      payload([], {
        playGoals: [
          { year: 2026, target: 300, unit: "HOURS", countReplays: false },
          { year: 2025, target: 12, unit: "GAMES" },
        ],
      }),
    );
    expect(res).toMatchObject({ goalsRestored: 2 });

    const goals = await prisma.playGoal.findMany({ where: { userId }, orderBy: { year: "asc" } });
    expect(goals.map((g) => [g.year, g.target, g.unit, g.countReplays])).toEqual([
      [2025, 12, "GAMES", true],
      [2026, 300, "HOURS", false],
    ]);
  });

  it("drops a goal it can't read, keeping the others", async () => {
    // Without its unit, 300 could be games or hours; guessing would make a
    // different goal.
    const res = await importLibrary(
      userId,
      payload([], {
        playGoals: [
          { year: 2026, target: 300 },
          { year: 2025, target: 0, unit: "GAMES" },
          { year: 2024, target: 10, unit: "GAMES" },
        ],
      }),
    );
    expect(res).toMatchObject({ goalsRestored: 1 });
    const goals = await prisma.playGoal.findMany({ where: { userId } });
    expect(goals.map((g) => g.year)).toEqual([2024]);
  });

  it("clears a local cover path whose file cannot be restored", async () => {
    await importLibrary(userId, payload([game({ coverUrl: "/api/covers/gone-12345678.jpg" })]));

    const saved = await prisma.game.findFirstOrThrow({ where: { userId } });
    expect(saved.coverUrl).toBeNull();
  });

  it("keeps a remote cover URL as-is", async () => {
    const url = "https://images.igdb.com/igdb/image/upload/t_cover_big/co93cr.jpg";
    await importLibrary(userId, payload([game({ coverUrl: url })]));

    const saved = await prisma.game.findFirstOrThrow({ where: { userId } });
    expect(saved.coverUrl).toBe(url);
  });

  it("writes a cover bundled with the backup and points the game at it", async () => {
    // Unique per run: a fixed name would be left behind in COVERS_DIR, and
    // resolveCoverUrl treats an already-present file as "nothing to restore",
    // so the assertion below would pass once and fail on every re-run against
    // the same directory.
    const name = `restored-${Date.now().toString(16)}${Math.floor(Math.random() * 1e6).toString(16)}.png`;
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
    const res = await importLibrary(
      userId,
      payload([game({ coverUrl: `/api/covers/${name}` })]),
      async (f) => (f === name ? png : null),
    );

    expect(res).toMatchObject({ coversRestored: 1 });
    const saved = await prisma.game.findFirstOrThrow({ where: { userId } });
    expect(saved.coverUrl).toBe(`/api/covers/${name}`);
  });

  it("refuses a cover filename that isn't one the cache would produce", async () => {
    // A hand-edited backup must not be able to plant arbitrary files.
    let requested: string | null = null;
    await importLibrary(
      userId,
      payload([game({ coverUrl: "/api/covers/../../evil.sh" })]),
      async (f) => {
        requested = f;
        return new Uint8Array([1]);
      },
    );

    expect(requested).toBeNull();
    const saved = await prisma.game.findFirstOrThrow({ where: { userId } });
    expect(saved.coverUrl).toBeNull();
  });

  it("refuses a bundled cover whose bytes are not an image", async () => {
    // Same check as /api/covers/upload: an HTML page renamed to .jpg in a
    // hand-made backup must not land in the cache.
    const name = `fake-${Date.now().toString(16)}${Math.floor(Math.random() * 1e6).toString(16)}.jpg`;
    const html = new TextEncoder().encode("<html><script>alert(1)</script></html>");
    const res = await importLibrary(
      userId,
      payload([game({ coverUrl: `/api/covers/${name}` })]),
      async (f) => (f === name ? html : null),
    );

    expect(res).toMatchObject({ coversRestored: 0 });
    const saved = await prisma.game.findFirstOrThrow({ where: { userId } });
    expect(saved.coverUrl).toBeNull();
  });

  it("drops a cover URL the game form would refuse, but keeps the game", async () => {
    await importLibrary(
      userId,
      payload([
        game({ title: "A", catalogueId: null, coverUrl: "javascript:alert(1)" }),
        game({ title: "B", catalogueId: null, coverUrl: "//evil.example/x.jpg" }),
      ]),
    );

    const saved = await prisma.game.findMany({ where: { userId }, orderBy: { title: "asc" } });
    expect(saved.map((g) => [g.title, g.coverUrl])).toEqual([
      ["A", null],
      ["B", null],
    ]);
  });

  it("preserves the dates added and last edited, so both sorts survive", async () => {
    const added = "2020-03-04T05:06:07.000Z";
    const edited = "2024-08-09T10:11:12.000Z";
    await importLibrary(userId, payload([game({ createdAt: added, updatedAt: edited })]));

    const saved = await prisma.game.findFirstOrThrow({ where: { userId } });
    expect(saved.createdAt.toISOString()).toBe(added);
    expect(saved.updatedAt.toISOString()).toBe(edited);
  });

  it("builds searchText so restored games are findable", async () => {
    await importLibrary(userId, payload([game({ seriesName: "Hollow Knight" })]));

    for (const word of ["team cherry", "switch"]) {
      const found = await prisma.game.findFirst({
        where: { userId, searchText: { contains: word } },
      });
      expect(found).not.toBeNull();
    }
  });

  it("restores into the right account and cascades away with it", async () => {
    const other = await prisma.user.create({
      data: { username: `other-${Date.now()}`, passwordHash: "x" },
    });
    await importLibrary(userId, payload([game()]));

    expect(await prisma.game.count({ where: { userId: other.id } })).toBe(0);

    await prisma.user.delete({ where: { id: userId } });
    expect(await prisma.game.count({ where: { userId } })).toBe(0);
    // Recreate so afterEach's delete stays harmless.
    const revived = await prisma.user.create({
      data: { username: `imp-revived-${Date.now()}`, passwordHash: "x" },
    });
    userId = revived.id;
    await prisma.user.delete({ where: { id: other.id } });
  });

  describe("when a restore fails partway through", () => {
    /** Fails the Nth game create, delegating the rest to the real client. */
    async function failOnNthCreate(n: number) {
      const { prisma: lib } = await import("@/lib/prisma");
      const real = lib.game.create.bind(lib.game);
      let calls = 0;
      return vi
        .spyOn(lib.game, "create")
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .mockImplementation((async (args: any) => {
          if (++calls === n) throw new Error("connection lost");
          return real(args);
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
        }) as any);
    }

    /** Distinct games, told apart by title. */
    const titled = (titles: string[]) =>
      payload(titles.map((title) => game({ title, catalogueId: null })));

    afterEach(() => vi.restoreAllMocks());

    it("reports the restore as incomplete instead of claiming success", async () => {
      await failOnNthCreate(3);

      const res = await importLibrary(userId, titled(["One", "Two", "Three", "Four"]));

      expect(res).not.toHaveProperty("error");
      const summary = res as Summary;

      // The whole point: the caller must be able to tell this apart from a
      // clean run, rather than seeing a smaller number and assuming that was
      // simply all there was.
      expect(summary.incomplete).toBeDefined();
      expect(summary.incomplete?.reason).toContain("connection lost");
      expect(summary.gamesCreated).toBeLessThan(4);
    });

    it("reports a count that matches what actually reached the database", async () => {
      // The number the user is told to trust when deciding whether to re-run.
      // It is read after the failure, so every sibling write must have
      // settled by then — otherwise it silently undercounts.
      await failOnNthCreate(3);

      const res = await importLibrary(
        userId,
        titled(Array.from({ length: 8 }, (_, i) => `Game ${i}`)),
      );
      const summary = res as Summary;

      const actuallyStored = await prisma.game.count({ where: { userId } });
      expect(summary.gamesCreated).toBe(actuallyStored);
    });

    it("is resumable: re-running finishes the job and skips what landed", async () => {
      const file = titled(["One", "Two", "Three", "Four"]);

      const spy = await failOnNthCreate(3);
      const first = (await importLibrary(userId, file)) as Summary;
      expect(first.incomplete).toBeDefined();
      spy.mockRestore();

      // Same file again, nothing failing this time.
      const second = (await importLibrary(userId, file)) as Summary;
      expect(second.incomplete).toBeUndefined();
      expect(second.gamesSkipped).toBe(first.gamesCreated);

      // Every game present exactly once — the advice to re-run must not
      // produce duplicates.
      expect(await prisma.game.count({ where: { userId } })).toBe(4);
      const titles = (await prisma.game.findMany({ where: { userId } })).map((g) => g.title);
      expect([...titles].sort()).toEqual(["Four", "One", "Three", "Two"]);
    });

    it("leaves a clean run with no incomplete marker", async () => {
      const res = await importLibrary(userId, payload([game()]));
      const summary = res as Summary;
      expect(summary.incomplete).toBeUndefined();
      expect(summary.gamesCreated).toBe(1);
    });
  });

  it("restores a status other than COMPLETED without inventing history", async () => {
    await importLibrary(
      userId,
      payload([game({ status: "PLAYING", playedMinutes: 120, timesCompleted: 0, rating: null })]),
    );

    const saved = await prisma.game.findFirstOrThrow({
      where: { userId },
      include: { playthroughs: true },
    });
    expect(saved.status).toBe(PlayStatus.PLAYING);
    expect(saved.playedMinutes).toBe(120);
    expect(saved.timesCompleted).toBe(0);
    expect(saved.playthroughs).toHaveLength(0);
  });
});

describe("ownership and lending", () => {
  it("restores every ownership state", async () => {
    await importLibrary(
      userId,
      payload(
        ["OWNED", "WISHLIST", "BORROWED", "GIVEN_AWAY"].map((ownership) =>
          game({ title: ownership, catalogueId: null, ownership }),
        ),
      ),
    );
    const rows = await prisma.game.findMany({ where: { userId }, orderBy: { title: "asc" } });
    expect(rows.map((g) => [g.title, g.ownership])).toEqual([
      ["BORROWED", "BORROWED"],
      ["GIVEN_AWAY", "GIVEN_AWAY"],
      ["OWNED", "OWNED"],
      ["WISHLIST", "WISHLIST"],
    ]);
  });

  it("defaults to OWNED when a backup says nothing usable about ownership", async () => {
    await importLibrary(
      userId,
      payload([
        { ...game({ title: "Unsaid", catalogueId: null }), ownership: undefined },
        game({ title: "Unknown", catalogueId: null, ownership: "LENT" }),
      ]),
    );
    const rows = await prisma.game.findMany({ where: { userId } });
    expect(rows.map((g) => g.ownership)).toEqual(["OWNED", "OWNED"]);
  });

  it("restores lending records, open and returned", async () => {
    const res = await importLibrary(
      userId,
      payload([
        game({
          loans: [
            { borrower: "Kari", lentAt: "2026-01-05T00:00:00.000Z", returnedAt: "2026-02-01T00:00:00.000Z" },
            { borrower: "Ola", lentAt: "2026-03-01T00:00:00.000Z", returnedAt: null, note: "with the case" },
          ],
        }),
      ]),
    );
    expect(res).toMatchObject({ loansRestored: 2 });

    const saved = await prisma.game.findFirstOrThrow({
      where: { userId },
      include: { loans: { orderBy: { lentAt: "asc" } } },
    });
    expect(saved.loans).toHaveLength(2);
    expect(saved.loans[0].returnedAt).not.toBeNull();
    // The still-open loan is what makes the game "lent out".
    expect(saved.loans[1].borrower).toBe("Ola");
    expect(saved.loans[1].returnedAt).toBeNull();
    expect(saved.loans[1].note).toBe("with the case");
  });

  it("gives an undated loan a date rather than dropping it", async () => {
    await importLibrary(
      userId,
      payload([game({ loans: [{ borrower: "Someone" }] })]),
    );
    const saved = await prisma.game.findFirstOrThrow({
      where: { userId },
      include: { loans: true },
    });
    expect(saved.loans).toHaveLength(1);
    expect(saved.loans[0].lentAt).toBeInstanceOf(Date);
  });

  it("drops a loan with no borrower on its own, keeping the game and its other loans", async () => {
    const res = await importLibrary(
      userId,
      payload([game({ loans: [{ borrower: "" }, { borrower: "Kari" }] })]),
    );
    // The game still lands; only the unusable loan is discarded.
    expect(res).toMatchObject({ gamesCreated: 1, loansRestored: 1 });
  });
});

describe("game-page settings", () => {
  it("restores them cleaned the way a save is", async () => {
    await importLibrary(
      userId,
      payload([], {
        settings: {
          theme: null,
          defaultViewName: null,
          preferences: {
            gamePageCards: ["playing", "bogus", "playing"],
            hiddenGamePageCards: ["lending"],
            findLinks: [
              { name: "Old", url: "http://howlongtobeat.com/?q={title}" },
              { name: "Barcode", url: "https://shop.example/?q={isbn}" },
              { name: "HowLongToBeat", url: "https://howlongtobeat.com/?q={title}" },
            ],
          },
        },
      }),
    );
    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    expect(user.preferences).toEqual({
      gamePageCards: ["playing", "shelves", "history", "lending", "quotes"],
      hiddenGamePageCards: ["lending"],
      findLinks: [{ name: "HowLongToBeat", url: "https://howlongtobeat.com/?q={title}" }],
    });
  });
});

describe("saved views kept to one shelf", () => {
  const query = (shelfId: string) => `shelfId=${shelfId}&group=none&sort=title&dir=asc`;
  const restoredShelfId = async () =>
    new URLSearchParams(
      (await prisma.savedView.findFirstOrThrow({ where: { userId } })).query,
    ).get("shelfId");

  it("finds the shelf by name", async () => {
    const shelf = await prisma.shelf.create({ data: { userId, name: "Cosy" } });
    await importLibrary(
      userId,
      payload([], {
        savedViews: [{ name: "Cosy games", query: query("old-id"), shelfName: "Cosy" }],
      }),
    );
    expect(await restoredShelfId()).toBe(shelf.id);
  });

  it("drops the shelf when no shelf here has that name", async () => {
    await importLibrary(
      userId,
      payload([], {
        savedViews: [{ name: "Cosy games", query: query("old-id"), shelfName: "Cosy" }],
      }),
    );
    expect(await restoredShelfId()).toBeNull();
    expect(await prisma.savedView.count({ where: { userId } })).toBe(1);
  });

  it("keeps a bare shelf id only when it is one of this account's shelves", async () => {
    // A view that names its shelf only by id: fine on the same instance,
    // meaningless anywhere else.
    const shelf = await prisma.shelf.create({ data: { userId, name: "Cosy" } });
    await importLibrary(
      userId,
      payload([], {
        savedViews: [
          { name: "Here", query: query(shelf.id) },
          { name: "Elsewhere", query: query("old-id") },
        ],
      }),
    );
    const views = await prisma.savedView.findMany({ where: { userId } });
    const shelfOf = (name: string) =>
      new URLSearchParams(views.find((v) => v.name === name)!.query).get("shelfId");
    expect(shelfOf("Here")).toBe(shelf.id);
    expect(shelfOf("Elsewhere")).toBeNull();
  });
});
