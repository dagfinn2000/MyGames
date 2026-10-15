import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The Wikipedia and Wikidata client: finding the articles, reading the
 * Wikidata claims (and their labels) into a catalogue row, and trimming an
 * article's introduction to a description. fetch is stubbed with answers
 * shaped like the real APIs', and the cache passes every lookup through.
 */

/** What each lookup would have kept, by source. */
const kept = new Map<string, unknown>();
vi.mock("@/lib/metadata/cache", () => ({
  cachedLookup: async (source: string, _query: string, fetcher: () => Promise<unknown>) => {
    try {
      const answer = await fetcher();
      if (answer !== null) kept.set(source, answer);
      return answer;
    } catch {
      return null;
    }
  },
}));

const {
  earliestRelease,
  gameTitle,
  getWikipediaGame,
  parseWikiPages,
  parseWikidataEntity,
  searchWikipedia,
  trimExtract,
  wikidataTime,
} = await import("@/lib/metadata/wikipedia");

const item = (id: string) => ({
  mainsnak: {
    snaktype: "value",
    property: "P",
    datavalue: { value: { "entity-type": "item", "numeric-id": Number(id.slice(1)), id }, type: "wikibase-entityid" },
    datatype: "wikibase-item",
  },
  type: "statement",
  rank: "normal" as const,
});

const date = (time: string, precision: number, rank: "normal" | "deprecated" = "normal") => ({
  mainsnak: {
    snaktype: "value",
    property: "P577",
    datavalue: { value: { time, timezone: 0, before: 0, after: 0, precision }, type: "time" },
    datatype: "time",
  },
  type: "statement",
  rank,
});

const SEARCH = {
  batchcomplete: true,
  query: {
    pages: [
      {
        pageid: 2,
        ns: 0,
        title: "Portal (video game)",
        index: 2,
        pageprops: { wikibase_item: "Q309535" },
        extract: "Portal is a 2007 puzzle-platform game developed and published by Valve.",
      },
      {
        pageid: 1,
        ns: 0,
        title: "Portal 2",
        index: 1,
        thumbnail: {
          source: "https://upload.wikimedia.org/wikipedia/en/f/f9/Portal2cover.jpg",
          width: 256,
          height: 320,
        },
        original: { source: "https://upload.wikimedia.org/wikipedia/en/f/f9/Portal2cover.jpg" },
        pageimage: "Portal2cover.jpg",
        pageprops: { wikibase_item: "Q279744" },
        extract:
          "Portal 2 is a 2011 puzzle-platform game developed by Valve.\nThe game was announced in March 2010.",
      },
      { pageid: 3, ns: 0, title: "Portal Stories: Mel", index: 3 },
    ],
  },
};

const ENTITIES = {
  entities: {
    Q279744: {
      type: "item",
      id: "Q279744",
      claims: {
        P178: [item("Q193559")],
        P123: [item("Q193559"), item("Q173941")],
        P400: [item("Q1406"), item("Q10683"), item("Q48263"), item("Q14116")],
        P136: [item("Q2532848"), item("Q1347381")],
        P577: [date("+2011-04-19T00:00:00Z", 11), date("+2011-04-21T00:00:00Z", 11)],
        P179: [item("Q1063829")],
      },
      sitelinks: { enwiki: { site: "enwiki", title: "Portal 2", badges: [] } },
    },
    Q309535: {
      type: "item",
      id: "Q309535",
      claims: { P178: [item("Q193559")], P577: [date("+2007-00-00T00:00:00Z", 9)] },
      sitelinks: { enwiki: { site: "enwiki", title: "Portal (video game)", badges: [] } },
    },
  },
  success: 1,
};

const LABELS: Record<string, string> = {
  Q279744: "Portal 2",
  Q309535: "Portal",
  Q193559: "Valve Corporation",
  Q173941: "Electronic Arts",
  Q1406: "Microsoft Windows",
  Q10683: "PlayStation 3",
  Q48263: "Xbox 360",
  Q14116: "macOS",
  Q2532848: "puzzle video game",
  Q1347381: "platform game",
  Q1063829: "Portal",
};

describe("parsing", () => {
  it("puts the search's pages in order and drops the missing", () => {
    const pages = parseWikiPages({
      query: { pages: [...SEARCH.query.pages, { title: "Gone", index: 0, missing: true }] },
    });
    expect(pages.map((p) => p.title)).toEqual(["Portal 2", "Portal (video game)", "Portal Stories: Mel"]);
  });

  it("drops the disambiguation from an article title", () => {
    expect(gameTitle("Portal (video game)")).toBe("Portal");
    expect(gameTitle("Doom (2016 video game)")).toBe("Doom");
    expect(gameTitle("Hollow Knight")).toBe("Hollow Knight");
    expect(gameTitle("Halo (franchise)")).toBe("Halo (franchise)");
  });

  it("reads a Wikidata time at its precision", () => {
    expect(wikidataTime({ time: "+2011-04-19T00:00:00Z", precision: 11 })).toBe("2011-04-19");
    expect(wikidataTime({ time: "+2011-04-00T00:00:00Z", precision: 10 })).toBe("2011-04");
    expect(wikidataTime({ time: "+2011-01-01T00:00:00Z", precision: 9 })).toBe("2011");
    expect(wikidataTime({ time: "+2010-00-00T00:00:00Z", precision: 8 })).toBeNull();
  });

  it("takes the first release, preferring an exact date to a vague one in the same year", () => {
    expect(
      earliestRelease([
        date("+2017-02-24T00:00:00Z", 11),
        date("+2017-00-00T00:00:00Z", 9),
        date("+2018-06-12T00:00:00Z", 11),
      ]),
    ).toBe("2017-02-24");
    expect(earliestRelease([date("+2018-06-12T00:00:00Z", 11), date("+2017-00-00T00:00:00Z", 9)])).toBe("2017");
    expect(earliestRelease([date("+2001-01-01T00:00:00Z", 11, "deprecated")])).toBeNull();
  });

  it("collects the claims a game's item makes", () => {
    expect(parseWikidataEntity(ENTITIES.entities.Q279744)).toEqual({
      developers: ["Q193559"],
      publishers: ["Q193559", "Q173941"],
      platforms: ["Q1406", "Q10683", "Q48263", "Q14116"],
      genres: ["Q2532848", "Q1347381"],
      series: ["Q1063829"],
      releaseDate: "2011-04-19",
      enwikiTitle: "Portal 2",
    });
  });
});

describe("trimExtract", () => {
  it("keeps whole paragraphs while they fit", () => {
    expect(trimExtract("One.\nTwo.\n\nThree is longer.", 12)).toBe("One.\n\nTwo.");
    expect(trimExtract("  \n ")).toBeNull();
  });

  it("cuts a long first paragraph after its last whole sentence", () => {
    const text = "Hades is a roguelike from Supergiant Games. It came out in 2020. It sold well.";
    expect(trimExtract(text, 70)).toBe("Hades is a roguelike from Supergiant Games. It came out in 2020.");
    expect(trimExtract("A very long sentence without an end", 10)).toBe("A very lon…");
  });
});

describe("talking to Wikipedia and Wikidata", () => {
  let urls: URL[] = [];
  let agents: (string | null)[] = [];
  let wikidataUp = true;

  function respond(url: URL): Response {
    const p = url.searchParams;
    if (url.host === "en.wikipedia.org" && p.get("generator") === "search") return Response.json(SEARCH);
    if (url.host === "en.wikipedia.org" && p.get("titles") === "Portal 2") {
      return Response.json({ query: { pages: [SEARCH.query.pages[1]] } });
    }
    if (url.host === "www.wikidata.org") {
      if (!wikidataUp) return new Response("", { status: 503 });
      const ids = p.get("ids")!.split("|");
      if (p.get("props") === "labels") {
        return Response.json({
          entities: Object.fromEntries(
            ids.map((id) => [id, { id, labels: LABELS[id] ? { en: { language: "en", value: LABELS[id] } } : {} }]),
          ),
        });
      }
      const all = ENTITIES.entities as Record<string, unknown>;
      return Response.json({
        entities: Object.fromEntries(ids.map((id) => [id, all[id] ?? { id, missing: "" }])),
      });
    }
    return new Response("", { status: 404 });
  }

  beforeEach(() => {
    urls = [];
    agents = [];
    wikidataUp = true;
    kept.clear();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL, init?: RequestInit) => {
        const url = new URL(String(input));
        urls.push(url);
        agents.push(new Headers(init?.headers).get("User-Agent"));
        return respond(url);
      }),
    );
  });
  afterEach(() => vi.unstubAllGlobals());

  it("finds video game articles and fills them in from Wikidata", async () => {
    const rows = await searchWikipedia("portal");
    expect(rows.map((r) => r.title)).toEqual(["Portal 2", "Portal"]);
    expect(rows[0]).toEqual({
      title: "Portal 2",
      developers: ["Valve Corporation"],
      publisher: "Valve Corporation",
      platforms: ["PC", "PlayStation 3", "Xbox 360", "Mac"],
      coverUrl: "https://upload.wikimedia.org/wikipedia/en/f/f9/Portal2cover.jpg",
      description: "Portal 2 is a 2011 puzzle-platform game developed by Valve.\n\nThe game was announced in March 2010.",
      lengthMinutes: null,
      releaseDate: "2011-04-19",
      tags: ["puzzle", "platform game"],
      seriesName: "Portal",
      catalogueId: "wikidata:Q279744",
      source: "wikipedia",
    });
    expect(rows[1]).toMatchObject({ releaseDate: "2007", coverUrl: null });

    const search = urls[0].searchParams;
    expect(search.get("gsrsearch")).toBe('hastemplate:"Infobox video game" portal');
    expect(search.get("pilicense")).toBe("any");
    expect(agents.every((a) => a?.startsWith("mygames/"))).toBe(true);
  });

  it("still shows what Wikipedia knows when Wikidata is down", async () => {
    wikidataUp = false;
    const rows = await searchWikipedia("portal");
    expect(rows[0]).toMatchObject({ title: "Portal 2", developers: [], description: expect.any(String) });
  });

  it("leaves Wikidata out when only covers are wanted", async () => {
    const rows = await searchWikipedia("portal", { limit: 6, facts: false });
    expect(rows).toHaveLength(2);
    expect(urls.map((u) => u.host)).toEqual(["en.wikipedia.org"]);
    expect(urls[0].searchParams.get("gsrlimit")).toBe("6");
  });

  it("keeps only the claims it reads, and asks for labels with their fallback", async () => {
    await searchWikipedia("portal");
    expect(kept.get("wiki-claims")).toEqual({
      Q279744: parseWikidataEntity(ENTITIES.entities.Q279744),
      Q309535: parseWikidataEntity(ENTITIES.entities.Q309535),
    });
    const labels = urls.find((u) => u.searchParams.get("props") === "labels")!;
    expect(labels.searchParams.get("languagefallback")).toBe("1");
  });

  it("says Wikipedia is down rather than that it found nothing", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 503 })));
    await expect(searchWikipedia("portal")).rejects.toThrow("Wikipedia unavailable");
  });

  it("takes an error the API answers with 200 for a failure, keeping nothing", async () => {
    // CirrusSearch under load, say: HTTP 200 with an `error` member.
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({ error: { code: "search-error", info: "Search is currently too busy." } }),
      ),
    );
    await expect(searchWikipedia("portal")).rejects.toThrow("Wikipedia unavailable");
    expect(await getWikipediaGame("Q279744")).toBeNull();
    expect(kept.size).toBe(0);
  });

  it("fetches one game by its Wikidata item, then its article", async () => {
    const game = await getWikipediaGame("Q279744");
    expect(game).toMatchObject({
      title: "Portal 2",
      developers: ["Valve Corporation"],
      coverUrl: "https://upload.wikimedia.org/wikipedia/en/f/f9/Portal2cover.jpg",
      catalogueId: "wikidata:Q279744",
    });
    expect(await getWikipediaGame("Q1")).toBeNull();
  });
});
