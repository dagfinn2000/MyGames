import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The IGDB client: turning IGDB's games into catalogue rows, and talking to
 * it (a Twitch token first, kept and renewed; Apicalypse queries). fetch is
 * stubbed with answers shaped like IGDB's, and the cache passes every
 * lookup straight through.
 */

const cacheKeys: string[] = [];
vi.mock("@/lib/metadata/cache", () => ({
  cachedLookup: async (source: string, query: string, fetcher: () => Promise<unknown>) => {
    cacheKeys.push(`${source}:${query}`);
    try {
      return await fetcher();
    } catch {
      return null;
    }
  },
}));

const {
  apicalypseString,
  getIgdbGame,
  igdbDate,
  igdbReleaseDate,
  parseIgdbGame,
  parseTimesToBeat,
  resetIgdbToken,
  searchIgdb,
} = await import("@/lib/metadata/igdb");

const PORTAL_2 = {
  id: 72,
  name: "Portal 2",
  slug: "portal-2",
  cover: { id: 82660, image_id: "co1rs4" },
  first_release_date: 1303171200, // 2011-04-19 00:00 UTC
  platforms: [
    { id: 6, name: "PC (Microsoft Windows)" },
    { id: 9, name: "PlayStation 3" },
    { id: 12, name: "Xbox 360" },
    { id: 14, name: "Mac" },
    { id: 3, name: "Linux" },
  ],
  genres: [
    { id: 5, name: "Shooter" },
    { id: 9, name: "Puzzle" },
  ],
  themes: [
    { id: 18, name: "Science fiction" },
    { id: 27, name: "Comedy" },
  ],
  involved_companies: [
    { id: 1, company: { id: 56, name: "Valve Corporation" }, developer: true, publisher: true },
    { id: 2, company: { id: 104, name: "Electronic Arts" }, developer: false, publisher: true },
  ],
  summary: "Sequel to the acclaimed Portal (2007), Portal 2 pits the protagonist against the AI GLaDOS.",
  collections: [{ id: 87, name: "Portal" }],
  franchises: [{ id: 2, name: "Half-Life" }],
};

describe("parseIgdbGame", () => {
  it("turns an IGDB game into a catalogue row", () => {
    expect(parseIgdbGame(PORTAL_2, new Map([[72, 520]]))).toEqual({
      title: "Portal 2",
      developers: ["Valve Corporation"],
      publisher: "Valve Corporation",
      platforms: ["PC", "PlayStation 3", "Xbox 360", "Mac", "Linux"],
      coverUrl: "https://images.igdb.com/igdb/image/upload/t_cover_big_2x/co1rs4.jpg",
      description: PORTAL_2.summary,
      lengthMinutes: 520,
      releaseDate: "2011-04-19",
      tags: ["Shooter", "Puzzle", "Science fiction", "Comedy"],
      seriesName: "Portal",
      catalogueId: "igdb:portal-2",
      source: "igdb",
    });
  });

  it("falls back to the franchise for the series, and copes with missing fields", () => {
    const row = parseIgdbGame({ id: 1, name: "Celeste", slug: "celeste", franchises: [{ name: "Celeste" }] });
    expect(row).toMatchObject({
      developers: [],
      publisher: null,
      platforms: [],
      coverUrl: null,
      lengthMinutes: null,
      releaseDate: null,
      seriesName: "Celeste",
    });
    expect(parseIgdbGame({ id: 2, slug: "nameless" })).toBeNull();
  });

  it("reads the release date in UTC", () => {
    // 2017-02-24 00:00 UTC is still the 23rd west of Greenwich.
    expect(igdbDate(1487894400)).toBe("2017-02-24");
    expect(igdbDate(undefined)).toBeNull();
  });

  it("keeps only as much of the release date as IGDB knows", () => {
    // A release known to the year is stored as its last day.
    const endOf2026 = 1798675200; // 2026-12-31 00:00 UTC
    const year = { date: endOf2026, date_format: { format: "YYYY" } };
    const game = (release_dates: object[]) => ({ first_release_date: endOf2026, release_dates });
    expect(igdbReleaseDate(game([year]))).toBe("2026");
    expect(igdbReleaseDate(game([{ date: endOf2026, date_format: { format: "YYYYQ4" } }]))).toBe("2026");
    expect(igdbReleaseDate(game([{ date: endOf2026, category: 1 }]))).toBe("2026-12");
    // An exact date on one platform beats a vaguer one on another.
    expect(igdbReleaseDate(game([year, { date: endOf2026, category: 0 }]))).toBe("2026-12-31");
    // Releases on other days, or none, leave the whole day.
    expect(igdbReleaseDate(game([{ date: 1487894400, date_format: { format: "YYYY" } }]))).toBe("2026-12-31");
    expect(igdbReleaseDate({ first_release_date: 1487894400 })).toBe("2017-02-24");
    expect(igdbReleaseDate({})).toBeNull();
  });
});

describe("parseTimesToBeat", () => {
  it("takes the main-story time in minutes, or the time with extras when that's all there is", () => {
    const times = parseTimesToBeat([
      { game_id: 72, hastily: 25230, normally: 31200, completely: 54000 },
      { game_id: 1, normally: 28800 },
      { game_id: 2, normally: 0, hastily: 0 },
    ]);
    expect([...times]).toEqual([
      [72, 421],
      [1, 480],
    ]);
  });
});

describe("apicalypseString", () => {
  it("quotes and escapes, so a title can't end the query", () => {
    expect(apicalypseString('Say "hi"')).toBe('"Say \\"hi\\""');
    expect(apicalypseString("back\\slash")).toBe('"back\\\\slash"');
  });
});

describe("talking to IGDB", () => {
  type Call = { url: string; init?: RequestInit };
  let calls: Call[] = [];
  let tokens = 0;
  let gamesStatus: number[] = [];

  function respond(url: string, init?: RequestInit): Response {
    calls.push({ url, init });
    if (url.startsWith("https://id.twitch.tv/oauth2/token")) {
      tokens++;
      return Response.json({ access_token: `token-${tokens}`, expires_in: 5000000, token_type: "bearer" });
    }
    if (url === "https://api.igdb.com/v4/games") {
      const status = gamesStatus.shift() ?? 200;
      if (status !== 200) return new Response("", { status });
      return Response.json([PORTAL_2]);
    }
    if (url === "https://api.igdb.com/v4/game_time_to_beats") {
      return Response.json([{ id: 9, game_id: 72, hastily: 25200, normally: 31200, completely: 54000 }]);
    }
    return new Response("", { status: 404 });
  }

  beforeEach(() => {
    calls = [];
    tokens = 0;
    gamesStatus = [];
    cacheKeys.length = 0;
    resetIgdbToken();
    vi.stubEnv("IGDB_CLIENT_ID", "client-id");
    vi.stubEnv("IGDB_CLIENT_SECRET", "secret");
    vi.stubGlobal("fetch", vi.fn(async (url: string | URL, init?: RequestInit) => respond(String(url), init)));
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("searches with a token and Apicalypse, then fetches the times to beat", async () => {
    const rows = await searchIgdb('portal "2"');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ title: "Portal 2", lengthMinutes: 420 });

    const tokenUrl = new URL(calls[0].url);
    expect(tokenUrl.searchParams.get("client_id")).toBe("client-id");
    expect(tokenUrl.searchParams.get("client_secret")).toBe("secret");
    expect(tokenUrl.searchParams.get("grant_type")).toBe("client_credentials");
    expect(calls[0].init?.method).toBe("POST");

    const search = calls[1];
    expect(search.init?.headers).toMatchObject({ "Client-ID": "client-id", Authorization: "Bearer token-1" });
    expect(search.init?.body).toContain('search "portal \\"2\\"";');
    expect(search.init?.body).toContain("where version_parent = null;");
    expect(search.init?.body).toContain("limit 10;");
    expect(calls[2].init?.body).toContain("where game_id = (72);");
    expect(cacheKeys).toEqual(['igdb-search:portal "2"|10', "igdb-ttb:72"]);
  });

  it("keeps the token for the next request", async () => {
    await searchIgdb("portal");
    await searchIgdb("portal 2", { timeToBeat: false });
    expect(tokens).toBe(1);
    expect(calls.filter((c) => c.url.includes("game_time_to_beats"))).toHaveLength(1);
  });

  it("fetches a new token once when IGDB says the old one is no good", async () => {
    gamesStatus = [401];
    expect(await searchIgdb("portal", { timeToBeat: false })).toHaveLength(1);
    expect(tokens).toBe(2);
    expect(calls[3].init?.headers).toMatchObject({ Authorization: "Bearer token-2" });

    gamesStatus = [401, 401];
    resetIgdbToken();
    await expect(searchIgdb("portal")).rejects.toThrow("IGDB unavailable");
  });

  it("says IGDB is down rather than that it found nothing", async () => {
    gamesStatus = [500];
    await expect(searchIgdb("portal")).rejects.toThrow("IGDB unavailable");
  });

  it("isn't asked at all without credentials", async () => {
    vi.stubEnv("IGDB_CLIENT_SECRET", "");
    expect(await searchIgdb("portal")).toEqual([]);
    expect(await getIgdbGame("portal-2")).toBeNull();
    expect(calls).toEqual([]);
  });

  it("fetches one game by its slug", async () => {
    const game = await getIgdbGame("portal-2");
    expect(game).toMatchObject({ catalogueId: "igdb:portal-2", lengthMinutes: 420 });
    expect(calls[1].init?.body).toContain('where slug = "portal-2";');
  });
});
