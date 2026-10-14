import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GameOwnership, PrismaClient, PlayStatus, type Prisma } from "@prisma/client";
import { parseFilters } from "@/lib/library-filters";
import { resolveGameWhere } from "@/lib/library-where";
import type { Preferences } from "@/lib/preferences";

/**
 * The library's filters against a real database: array containment on tags
 * and developers, a year's finishes across time zones and archived
 * playthroughs, and every lookup kept to the player's own games.
 */
const prisma = new PrismaClient();

let userId: string;
let otherUserId: string;

beforeEach(async () => {
  const stamp = `${Date.now()}-${Math.random()}`;
  const [a, b] = await Promise.all([
    prisma.user.create({ data: { username: `whr-${stamp}`, passwordHash: "x" } }),
    prisma.user.create({ data: { username: `wh2-${stamp}`, passwordHash: "x" } }),
  ]);
  userId = a.id;
  otherUserId = b.id;
});

afterEach(async () => {
  await prisma.user.deleteMany({ where: { id: { in: [userId, otherUserId] } } });
});

function add(title: string, data: Partial<Prisma.GameUncheckedCreateInput> = {}, owner = userId) {
  return prisma.game.create({
    data: { userId: owner, title, searchText: title.toLowerCase(), ...data },
  });
}

async function titles(
  sp: Record<string, string>,
  prefs: Pick<Preferences, "searchAlsoIn" | "timeZone"> = { searchAlsoIn: [], timeZone: "UTC" },
): Promise<string[]> {
  const where = await resolveGameWhere(userId, parseFilters(sp), prefs);
  const rows = await prisma.game.findMany({ where, select: { title: true }, orderBy: { title: "asc" } });
  return rows.map((r) => r.title);
}

const COMPLETED = PlayStatus.COMPLETED;

describe("Finished in", () => {
  it("files a late-night finish in the player's own year", async () => {
    await add("New Year's Eve", { status: COMPLETED, dateFinished: new Date("2025-12-31T23:30:00Z") });
    const oslo = { searchAlsoIn: [], timeZone: "Europe/Oslo" };
    expect(await titles({ finished: "2026" }, oslo)).toEqual(["New Year's Eve"]);
    expect(await titles({ finished: "2025" }, oslo)).toEqual([]);
    expect(await titles({ finished: "2025" })).toEqual(["New Year's Eve"]);
  });

  it("keeps a date typed into a field on that day everywhere", async () => {
    await add("Typed", { status: COMPLETED, dateFinished: new Date("2026-01-01T00:00:00Z") });
    const ny = { searchAlsoIn: [], timeZone: "America/New_York" };
    expect(await titles({ finished: "2026" }, ny)).toEqual(["Typed"]);
    expect(await titles({ finished: "2025" }, ny)).toEqual([]);
  });

  it("counts replays, but not a date left on a game that isn't Completed", async () => {
    const replay = await add("Replay", { status: PlayStatus.PLAYING });
    await prisma.playthrough.create({ data: { gameId: replay.id, dateFinished: new Date("2024-05-01T00:00:00Z") } });
    // Near New Year too, so the edge lookup has to find it.
    const late = await add("Late replay", { status: PlayStatus.WANT_TO_PLAY });
    await prisma.playthrough.create({ data: { gameId: late.id, dateFinished: new Date("2024-12-31T20:00:00Z") } });
    await add("Stale", { status: PlayStatus.WANT_TO_PLAY, dateFinished: new Date("2024-05-01T00:00:00Z") });
    await add("Mid-year", { status: COMPLETED, dateFinished: new Date("2024-07-14T18:00:00Z") });

    expect(await titles({ finished: "2024" })).toEqual(["Late replay", "Mid-year", "Replay"]);
    // On the Playing tab, the archived playthrough still counts.
    expect(await titles({ finished: "2024", shelf: "PLAYING" })).toEqual(["Replay"]);
  });

  it("never finds another player's games", async () => {
    await add("Theirs", { status: COMPLETED, dateFinished: new Date("2024-01-01T02:00:00Z") }, otherUserId);
    const theirs = await add("Their replay", {}, otherUserId);
    await prisma.playthrough.create({ data: { gameId: theirs.id, dateFinished: new Date("2024-12-31T23:00:00Z") } });
    expect(await titles({ finished: "2024" })).toEqual([]);
  });
});

describe("tags, developer, platform, rating and missing details", () => {
  beforeEach(async () => {
    await add("Chrono Trigger", {
      tags: ["rpg", "classic"],
      status: COMPLETED,
      rating: 8,
      platform: "SNES",
    });
    await add("Persona 5", { tags: ["rpg"], status: COMPLETED, platform: "PlayStation 4" });
    await add("Resident Evil", { tags: ["horror"], status: PlayStatus.WANT_TO_PLAY, platform: "PC" });
    await add("Hollow Knight", {
      developers: ["Team Cherry"],
      status: PlayStatus.DROPPED,
      coverUrl: "",
      lengthMinutes: 0,
      platform: "",
    });
    await add("Their RPG", { tags: ["rpg"], platform: "PC" }, otherUserId);
  });

  it("matches tags any, all or not", async () => {
    expect(await titles({ tag: "rpg,horror" })).toEqual(["Chrono Trigger", "Persona 5", "Resident Evil"]);
    expect(await titles({ tag: "rpg,classic", tagMatch: "all" })).toEqual(["Chrono Trigger"]);
    expect(await titles({ tag: "rpg", notTag: "classic" })).toEqual(["Persona 5"]);
    expect(await titles({ notTag: "rpg,horror" })).toEqual(["Hollow Knight"]);
  });

  it("matches the developer exactly", async () => {
    expect(await titles({ developer: "Team Cherry" })).toEqual(["Hollow Knight"]);
    expect(await titles({ developer: "Cherry" })).toEqual([]);
  });

  it("matches the platform exactly, and only the player's games on it", async () => {
    expect(await titles({ platform: "PC" })).toEqual(["Resident Evil"]);
    expect(await titles({ platform: "PlayStation 4" })).toEqual(["Persona 5"]);
    expect(await titles({ platform: "PlayStation" })).toEqual([]);
  });

  it("lists unrated games that aren't on Want to Play, keeping the tab", async () => {
    expect(await titles({ minRating: "unrated" })).toEqual(["Hollow Knight", "Persona 5"]);
    expect(await titles({ minRating: "unrated", shelf: "COMPLETED" })).toEqual(["Persona 5"]);
  });

  it("finds games missing a detail, empty or zero counting as missing", async () => {
    // Every fixture has a null or empty cover and no time to beat; only
    // Hollow Knight has no platform.
    expect(await titles({ missing: "cover" })).toHaveLength(4);
    expect(await titles({ missing: "length", tag: "horror" })).toEqual(["Resident Evil"]);
    expect(await titles({ missing: "length", developer: "Team Cherry" })).toEqual(["Hollow Knight"]);
    expect(await titles({ missing: "platform" })).toEqual(["Hollow Knight"]);
    expect(await titles({ missing: "tags" })).toEqual(["Hollow Knight"]);
    await prisma.game.updateMany({
      where: { userId },
      data: { coverUrl: "/api/covers/x.jpg", lengthMinutes: 1200, platform: "PC" },
    });
    expect(await titles({ missing: "cover" })).toEqual([]);
    expect(await titles({ missing: "length" })).toEqual([]);
    expect(await titles({ missing: "platform" })).toEqual([]);
  });

  it("ignores an ownership value it doesn't know", async () => {
    await prisma.game.updateMany({ where: { userId, title: "Resident Evil" }, data: { ownership: GameOwnership.WISHLIST } });
    expect(await titles({ owned: "constructor" })).toHaveLength(4);
    expect(await titles({ owned: "wishlist" })).toEqual(["Resident Evil"]);
  });
});
