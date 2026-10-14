import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The metadata cache only remembers answers; it must never be the reason a
 * lookup fails. The table is stubbed: what's under test is when it is used.
 */

const findUnique = vi.fn();
const upsert = vi.fn();
vi.mock("@/lib/prisma", () => ({
  prisma: { metadataCache: { findUnique: (a: unknown) => findUnique(a), upsert: (a: unknown) => upsert(a) } },
}));

const { cachedLookup } = await import("@/lib/metadata/cache");

beforeEach(() => {
  findUnique.mockReset().mockResolvedValue(null);
  upsert.mockReset().mockResolvedValue({});
});

describe("cachedLookup", () => {
  it("keeps a fresh answer", async () => {
    expect(await cachedLookup("igdb-search", "Hollow Knight", async () => ["hit"])).toEqual(["hit"]);
    expect(upsert).toHaveBeenCalledOnce();
  });

  it("answers a lookup too long to keep, without touching the table", async () => {
    // Postgres refuses to index a key this long, which failed the lookup.
    const long = "word ".repeat(1000);
    expect(await cachedLookup("wiki-search", long, async () => ["hit"])).toEqual(["hit"]);
    expect(findUnique).not.toHaveBeenCalled();
    expect(upsert).not.toHaveBeenCalled();
  });

  it("keeps nothing when the lookup failed, so the next one asks again", async () => {
    expect(await cachedLookup("steam-app", "620", async () => null)).toBeNull();
    expect(await cachedLookup("steam-app", "620", () => Promise.reject(new Error("down")))).toBeNull();
    expect(upsert).not.toHaveBeenCalled();
  });

  it("answers from a stale entry while the catalogue is down, and from a fresh one without asking", async () => {
    const fetcher = vi.fn(async () => null);
    findUnique.mockResolvedValue({ payload: ["old"], expiresAt: new Date(Date.now() - 1000) });
    expect(await cachedLookup("wiki-search", "Portal", fetcher)).toEqual(["old"]);
    expect(fetcher).toHaveBeenCalledOnce();

    findUnique.mockResolvedValue({ payload: ["kept"], expiresAt: new Date(Date.now() + 60_000) });
    expect(await cachedLookup("wiki-search", "Portal", fetcher)).toEqual(["kept"]);
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it("still answers when the answer can't be kept", async () => {
    upsert.mockRejectedValue(new Error("index row size exceeds maximum"));
    expect(await cachedLookup("igdb-search", "Hollow Knight", async () => ["hit"])).toEqual(["hit"]);
  });
});
