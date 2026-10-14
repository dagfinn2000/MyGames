import { describe, expect, it } from "vitest";
import { arrangeGameCards, descriptionMayOverflow } from "@/lib/game-page";
import { DEFAULT_PREFERENCES, type GamePageCard } from "@/lib/preferences";

const prefs = (
  gamePageCards: GamePageCard[] = DEFAULT_PREFERENCES.gamePageCards,
  hiddenGamePageCards: GamePageCard[] = [],
) => ({ gamePageCards, hiddenGamePageCards });

describe("arrangeGameCards", () => {
  it("shows every card in today's order by default", () => {
    expect(arrangeGameCards(prefs(), {})).toEqual([
      { key: "shelves", forced: false },
      { key: "reading", forced: false },
      { key: "history", forced: false },
      { key: "lending", forced: false },
      { key: "quotes", forced: false },
    ]);
  });

  it("follows the reader's order", () => {
    const order: GamePageCard[] = ["reading", "quotes", "shelves", "lending", "history"];
    expect(arrangeGameCards(prefs(order), {}).map((c) => c.key)).toEqual(order);
  });

  it("places a card the stored order leaves out, after the listed ones", () => {
    expect(arrangeGameCards(prefs(["quotes", "reading"]), {}).map((c) => c.key)).toEqual([
      "quotes",
      "reading",
      "shelves",
      "history",
      "lending",
    ]);
  });

  it("leaves out hidden cards with nothing in them", () => {
    const arranged = arrangeGameCards(prefs(undefined, ["lending", "quotes"]), {
      lending: false,
    });
    expect(arranged.map((c) => c.key)).toEqual(["shelves", "reading", "history"]);
  });

  it("keeps a hidden Lending card with an open loan, in its place", () => {
    const order: GamePageCard[] = ["reading", "lending", "shelves", "history", "quotes"];
    const arranged = arrangeGameCards(prefs(order, ["lending"]), { lending: true });
    expect(arranged).toEqual([
      { key: "reading", forced: false },
      { key: "lending", forced: true },
      { key: "shelves", forced: false },
      { key: "history", forced: false },
      { key: "quotes", forced: false },
    ]);
  });

  it("keeps hidden Quotes, Read history and My reading that have content", () => {
    const arranged = arrangeGameCards(
      prefs(undefined, ["reading", "history", "quotes", "lending", "shelves"]),
      { reading: true, history: true, quotes: true, lending: false },
    );
    expect(arranged).toEqual([
      { key: "reading", forced: true },
      { key: "history", forced: true },
      { key: "quotes", forced: true },
    ]);
  });

  it("never forces the Shelves card", () => {
    const arranged = arrangeGameCards(prefs(undefined, ["shelves"]), { shelves: true });
    expect(arranged.map((c) => c.key)).not.toContain("shelves");
  });

  it("can leave the page with no cards at all", () => {
    expect(arrangeGameCards(prefs(undefined, [...DEFAULT_PREFERENCES.gamePageCards]), {})).toEqual(
      [],
    );
  });
});

describe("descriptionMayOverflow", () => {
  it("is false for a short description", () => {
    expect(descriptionMayOverflow("A short game about a long walk.")).toBe(false);
    expect(descriptionMayOverflow("x".repeat(300))).toBe(false);
  });

  it("is true past 300 characters", () => {
    expect(descriptionMayOverflow("x".repeat(301))).toBe(true);
  });

  it("is true for more than four lines", () => {
    expect(descriptionMayOverflow("a\nb\nc\nd")).toBe(false);
    expect(descriptionMayOverflow("a\nb\nc\nd\ne")).toBe(true);
  });
});
