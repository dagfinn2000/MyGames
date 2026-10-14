import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The Steam store client: reading the store's search and app details into
 * catalogue rows (its dates are written for people, its descriptions carry
 * HTML entities), and finding the portrait art. fetch is stubbed with
 * answers shaped like the store's, and the cache passes lookups through.
 */

vi.mock("@/lib/metadata/cache", () => ({
  cachedLookup: async (_source: string, _query: string, fetcher: () => Promise<unknown>) => {
    try {
      return await fetcher();
    } catch {
      return null;
    }
  },
}));

const { decodeHtml, getSteamGame, parseSteamApp, parseSteamDate, parseSteamSearch, searchSteam } =
  await import("@/lib/metadata/steam");

const SEARCH = {
  total: 4,
  items: [
    {
      type: "app",
      name: "Hollow Knight",
      id: 367520,
      price: { currency: "USD", initial: 1499, final: 1499 },
      tiny_image: "https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/367520/capsule_231x87.jpg?t=1695270428",
      metascore: "87",
      platforms: { windows: true, mac: true, linux: true },
      streamingvideo: false,
      controller_support: "full",
    },
    {
      type: "app",
      name: "Hollow Knight Soundtrack",
      id: 663090,
      tiny_image: "https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/663090/capsule_231x87.jpg",
      platforms: { windows: true, mac: true, linux: true },
    },
    {
      type: "sub",
      name: "Hollow Knight + Soundtrack",
      id: 205570,
      platforms: { windows: true },
    },
    {
      type: "app",
      name: "Hollow Knight: Silksong",
      id: 1030300,
      tiny_image: "https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/1030300/capsule_231x87.jpg",
      platforms: { windows: true, mac: false, linux: false },
    },
  ],
};

const APP = {
  "620": {
    success: true,
    data: {
      type: "game",
      name: "Portal 2",
      steam_appid: 620,
      short_description:
        "The &quot;Perpetual Testing Initiative&quot; has been expanded to allow you to design co-op puzzles for you and your friends!",
      header_image: "https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/620/header.jpg?t=1745363004",
      developers: ["Valve"],
      publishers: ["Valve"],
      platforms: { windows: true, mac: true, linux: true },
      genres: [
        { id: "2", description: "Adventure" },
        { id: "1", description: "Action" },
      ],
      release_date: { coming_soon: false, date: "18 Apr, 2011" },
    },
  },
};

describe("parseSteamDate", () => {
  it("reads the store's ways of writing a date", () => {
    expect(parseSteamDate("14 Nov, 2023")).toBe("2023-11-14");
    expect(parseSteamDate("Nov 14, 2023")).toBe("2023-11-14");
    expect(parseSteamDate("3 May, 2024")).toBe("2024-05-03");
    expect(parseSteamDate("September 2025")).toBe("2025-09");
    expect(parseSteamDate("Q1 2026")).toBe("2026");
    expect(parseSteamDate("2026")).toBe("2026");
  });

  it("has no date for an unreleased game without one, or a day that doesn't exist", () => {
    expect(parseSteamDate("Coming soon")).toBeNull();
    expect(parseSteamDate("To be announced")).toBeNull();
    expect(parseSteamDate(undefined)).toBeNull();
    expect(parseSteamDate("31 Feb, 2024")).toBe("2024-02");
  });
});

describe("decodeHtml", () => {
  it("decodes entities and drops tags", () => {
    expect(decodeHtml("Tom &amp; Jerry&#39;s &#x2018;game&#x2019;<br>&nbsp;now")).toBe("Tom & Jerry's ‘game’ now");
    expect(decodeHtml("&bogus; stays")).toBe("&bogus; stays");
  });
});

describe("parseSteamSearch", () => {
  it("keeps the apps, without soundtracks, with their platforms and capsule", () => {
    const rows = parseSteamSearch(SEARCH);
    expect(rows.map((r) => r.title)).toEqual(["Hollow Knight", "Hollow Knight: Silksong"]);
    expect(rows[0]).toMatchObject({
      platforms: ["PC", "Mac", "Linux"],
      coverUrl: SEARCH.items[0].tiny_image,
      catalogueId: "steam:367520",
      source: "steam",
      releaseDate: null,
    });
    expect(rows[1].platforms).toEqual(["PC"]);
    expect(parseSteamSearch(SEARCH, 1)).toHaveLength(1);
  });
});

describe("parseSteamApp", () => {
  it("turns an app's details into a catalogue row", () => {
    expect(parseSteamApp("620", APP)).toEqual({
      title: "Portal 2",
      developers: ["Valve"],
      publisher: "Valve",
      platforms: ["PC", "Mac", "Linux"],
      coverUrl: APP["620"].data.header_image,
      description:
        'The "Perpetual Testing Initiative" has been expanded to allow you to design co-op puzzles for you and your friends!',
      lengthMinutes: null,
      releaseDate: "2011-04-18",
      tags: ["Adventure", "Action"],
      seriesName: null,
      catalogueId: "steam:620",
      source: "steam",
    });
  });

  it("has nothing for an app the store doesn't know", () => {
    expect(parseSteamApp("1", { "1": { success: false } })).toBeNull();
    expect(parseSteamApp("620", {})).toBeNull();
  });
});

describe("talking to the store", () => {
  let requests: { url: string; method: string }[] = [];
  let artStatus = 200;

  beforeEach(() => {
    requests = [];
    artStatus = 200;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL, init?: RequestInit) => {
        const url = new URL(String(input));
        requests.push({ url: url.toString(), method: init?.method ?? "GET" });
        if (url.pathname === "/api/storesearch/") return Response.json(SEARCH);
        if (url.pathname === "/api/appdetails") {
          const id = url.searchParams.get("appids")!;
          return Response.json(id === "620" ? APP : { [id]: { success: false } });
        }
        if (url.pathname.endsWith("/library_600x900_2x.jpg")) return new Response(null, { status: artStatus });
        return new Response("", { status: 404 });
      }),
    );
  });
  afterEach(() => vi.unstubAllGlobals());

  it("searches the store in English", async () => {
    expect((await searchSteam("hollow knight")).map((r) => r.catalogueId)).toEqual([
      "steam:367520",
      "steam:1030300",
    ]);
    const url = new URL(requests[0].url);
    expect(url.searchParams.get("term")).toBe("hollow knight");
    expect(url.searchParams.get("l")).toBe("english");
  });

  it("says the store is down rather than that it found nothing", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 502 })));
    await expect(searchSteam("portal")).rejects.toThrow("Steam unavailable");
  });

  it("uses the portrait art as the cover when the store has it", async () => {
    const game = await getSteamGame("620");
    expect(game?.coverUrl).toBe(
      "https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/620/library_600x900_2x.jpg",
    );
    expect(requests.find((r) => r.url.endsWith("library_600x900_2x.jpg"))?.method).toBe("HEAD");
  });

  it("falls back to the header image when there is no portrait art", async () => {
    artStatus = 404;
    expect((await getSteamGame("620"))?.coverUrl).toBe(APP["620"].data.header_image);
  });

  it("has nothing for an app the store doesn't know", async () => {
    expect(await getSteamGame("1")).toBeNull();
  });
});
