import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@prisma/client";

/**
 * The quote actions, now that the quotes page edits and deletes too: each
 * one only ever touches the signed-in player's own quotes.
 */
const prisma = new PrismaClient();

let currentUserId: string | null = null;
vi.mock("@/auth", () => ({
  auth: async () => (currentUserId ? { user: { id: currentUserId } } : null),
  signOut: async () => {},
}));

// Server actions call revalidatePath, which needs a request scope.
const revalidated: string[] = [];
vi.mock("next/cache", () => ({ revalidatePath: (p: string) => revalidated.push(p) }));

const { addQuote, updateQuote, deleteQuote } = await import("@/lib/actions/quotes");

let userId: string;
let otherUserId: string;

function form(fields: Record<string, string>) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

async function makeQuote(owner: string, text = "Original") {
  const game = await prisma.game.create({
    data: { userId: owner, title: "Hollow Knight", searchText: "hollow knight" },
  });
  return prisma.quote.create({ data: { gameId: game.id, text, speaker: "Elderbug", note: "n" } });
}

beforeEach(async () => {
  const stamp = `${Date.now()}-${Math.random()}`;
  const [a, b] = await Promise.all([
    prisma.user.create({ data: { username: `qa-${stamp}`, passwordHash: "x" } }),
    prisma.user.create({ data: { username: `qb-${stamp}`, passwordHash: "x" } }),
  ]);
  userId = a.id;
  otherUserId = b.id;
  currentUserId = userId;
  revalidated.length = 0;
});

afterEach(async () => {
  await prisma.user.deleteMany({ where: { id: { in: [userId, otherUserId] } } });
});

describe("quote actions", () => {
  it("updateQuote saves text, speaker and note, and refreshes the quotes page", async () => {
    const q = await makeQuote(userId);
    const res = await updateQuote(q.id, {}, form({ text: "Edited", speaker: "Zote", note: "" }));
    expect(res).toEqual({ success: true });

    const saved = await prisma.quote.findUniqueOrThrow({ where: { id: q.id } });
    expect(saved).toMatchObject({ text: "Edited", speaker: "Zote", note: null });
    expect(revalidated).toContain("/quotes");
    expect(revalidated).toContain(`/games/${q.gameId}`);
  });

  it("updateQuote clears who says it when the box is emptied", async () => {
    const q = await makeQuote(userId);
    expect(await updateQuote(q.id, {}, form({ text: "Original", speaker: "  ", note: "n" }))).toEqual({
      success: true,
    });
    const saved = await prisma.quote.findUniqueOrThrow({ where: { id: q.id } });
    expect(saved.speaker).toBeNull();
  });

  it("updateQuote refuses another player's quote and leaves it alone", async () => {
    const theirs = await makeQuote(otherUserId, "Theirs");
    const res = await updateQuote(theirs.id, {}, form({ text: "Hijacked" }));
    expect(res).toEqual({ error: "Quote not found" });
    const after = await prisma.quote.findUniqueOrThrow({ where: { id: theirs.id } });
    expect(after.text).toBe("Theirs");
  });

  it("deleteQuote removes your own quote", async () => {
    const q = await makeQuote(userId);
    await deleteQuote(q.id);
    expect(await prisma.quote.findUnique({ where: { id: q.id } })).toBeNull();
    expect(revalidated).toContain("/quotes");
  });

  it("deleteQuote does nothing to another player's quote", async () => {
    const theirs = await makeQuote(otherUserId);
    await deleteQuote(theirs.id);
    expect(await prisma.quote.findUnique({ where: { id: theirs.id } })).not.toBeNull();
  });

  it("addQuote refuses another player's game", async () => {
    const theirs = await makeQuote(otherUserId);
    const res = await addQuote({}, form({ gameId: theirs.gameId, text: "Sneaky" }));
    expect(res).toEqual({ error: "Game not found" });
    expect(await prisma.quote.count({ where: { gameId: theirs.gameId } })).toBe(1);
  });

  it("addQuote saves who says it, trimmed, or nobody when left blank", async () => {
    const q = await makeQuote(userId);
    const add = (speaker: string, text: string) =>
      addQuote({}, form({ gameId: q.gameId, text, speaker, note: "" }));

    expect(await add("  Zote the Mighty  ", "Precept One")).toEqual({ success: true });
    expect(await add("", "No one in particular")).toEqual({ success: true });
    const saved = await prisma.quote.findMany({
      where: { gameId: q.gameId, text: { not: "Original" } },
      orderBy: { text: "asc" },
    });
    expect(saved.map((x) => [x.text, x.speaker, x.note])).toEqual([
      ["No one in particular", null, null],
      ["Precept One", "Zote the Mighty", null],
    ]);
    expect(revalidated).toContain("/quotes");
  });

  it("refuses a speaker past the limit, and leaves the quote as it was", async () => {
    const q = await makeQuote(userId);
    const res = await updateQuote(q.id, {}, form({ text: "Edited", speaker: "x".repeat(201) }));
    expect(res).toEqual({ error: "Speaker must be at most 200 characters" });
    expect(await prisma.quote.findUniqueOrThrow({ where: { id: q.id } })).toMatchObject({
      text: "Original",
      speaker: "Elderbug",
    });
  });

  it("all of them need a session", async () => {
    const q = await makeQuote(userId);
    currentUserId = null;
    await expect(updateQuote(q.id, {}, form({ text: "x" }))).rejects.toThrow("Not authenticated");
    await expect(deleteQuote(q.id)).rejects.toThrow("Not authenticated");
  });
});
