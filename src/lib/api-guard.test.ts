import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The metadata routes' gate: a session, then one unit of that user's
 * lookup budget per call. The session is stubbed; what's under test is
 * who gets through and when the budget says no.
 */

let session: { user?: { id?: string } } | null = null;
vi.mock("@/auth", () => ({ auth: async () => session }));

const { guardMetadataRequest } = await import("@/lib/api-guard");

beforeEach(() => {
  vi.useFakeTimers();
  // A fresh user per test, so each starts with a full budget.
  session = { user: { id: `user-${Math.random()}` } };
});
afterEach(() => {
  vi.useRealTimers();
});

describe("guardMetadataRequest", () => {
  it("turns away a caller without a session", async () => {
    session = null;
    const guard = await guardMetadataRequest();
    expect(guard.ok).toBe(false);
    if (!guard.ok) expect(guard.response.status).toBe(401);
  });

  it("lets a signed-in user through, and says who", async () => {
    const guard = await guardMetadataRequest();
    expect(guard).toEqual({ ok: true, userId: session?.user?.id });
  });

  it("allows 90 lookups a minute, then asks the caller to wait until it is up", async () => {
    for (let i = 0; i < 90; i++) expect((await guardMetadataRequest()).ok, `lookup ${i + 1}`).toBe(true);

    const refused = await guardMetadataRequest();
    expect(refused.ok).toBe(false);
    if (refused.ok) return;
    expect(refused.response.status).toBe(429);
    expect(refused.response.headers.get("Retry-After")).toBe("60");

    vi.advanceTimersByTime(60_000);
    expect((await guardMetadataRequest()).ok).toBe(true);
  });

  it("keeps each user's budget apart", async () => {
    for (let i = 0; i < 90; i++) await guardMetadataRequest();
    expect((await guardMetadataRequest()).ok).toBe(false);

    session = { user: { id: "someone-else" } };
    expect((await guardMetadataRequest()).ok).toBe(true);
  });
});
