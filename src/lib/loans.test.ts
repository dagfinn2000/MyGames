import { describe, expect, it } from "vitest";
import { GameFormat, GameOwnership } from "@prisma/client";
import { LENDING_NOTE, lendingMode, outFor, showsLendingCard } from "@/lib/loans";

const at = (iso: string) => new Date(iso);

describe("outFor", () => {
  it("says 'lent today' before a full day has passed", () => {
    // The case that was wrong first time round: lent in the morning, looked
    // at in the evening. Rounding made that "1 days" — wrong count, wrong grammar.
    expect(outFor(at("2026-07-28T08:00:00Z"), at("2026-07-28T22:00:00Z"))).toBe("lent today");
    expect(outFor(at("2026-07-28T00:00:00Z"), at("2026-07-28T00:00:00Z"))).toBe("lent today");
  });

  it("uses the singular for exactly one day", () => {
    expect(outFor(at("2026-07-27T08:00:00Z"), at("2026-07-28T08:00:00Z"))).toBe("out for 1 day");
    expect(outFor(at("2026-07-27T08:00:00Z"), at("2026-07-28T23:00:00Z"))).toBe("out for 1 day");
  });

  it("counts whole days after that", () => {
    expect(outFor(at("2026-07-01T08:00:00Z"), at("2026-07-28T08:00:00Z"))).toBe("out for 27 days");
  });

  it("never reports negative time for a future-dated loan", () => {
    expect(outFor(at("2026-08-05T00:00:00Z"), at("2026-07-28T00:00:00Z"))).toBe("lent today");
  });
});

describe("lendingMode", () => {
  const { PHYSICAL, DIGITAL, SUBSCRIPTION } = GameFormat;

  it("only lets a copy you own be lent", () => {
    expect(lendingMode(GameOwnership.OWNED, PHYSICAL)).toBe("lendable");
    expect(lendingMode(GameOwnership.BORROWED, PHYSICAL)).toBe("borrowed");
    expect(lendingMode(GameOwnership.GIVEN_AWAY, PHYSICAL)).toBe("given-away");
    expect(lendingMode(GameOwnership.WISHLIST, PHYSICAL)).toBe("wishlist");
  });

  it("has nothing to hand over for a digital or subscription game", () => {
    expect(lendingMode(GameOwnership.OWNED, DIGITAL)).toBe("digital");
    expect(lendingMode(GameOwnership.OWNED, SUBSCRIPTION)).toBe("subscription");
    // Whose copy it is comes first: a borrowed download still isn't yours.
    expect(lendingMode(GameOwnership.BORROWED, DIGITAL)).toBe("borrowed");
  });

  it("says why for each kind of copy", () => {
    expect(LENDING_NOTE.lendable).toBe("This copy is on your shelf.");
    expect(LENDING_NOTE.borrowed).toBe("Borrowed copy. It isn't yours to lend.");
    expect(LENDING_NOTE["given-away"]).toBe("You no longer have this copy.");
    expect(LENDING_NOTE.wishlist).toBe("On your wishlist, so there's no copy to lend.");
    expect(LENDING_NOTE.digital).toBe("A digital copy, so there's nothing to hand over.");
    expect(LENDING_NOTE.subscription).toBe("Part of a subscription, so there's no copy to lend.");
  });
});

describe("showsLendingCard", () => {
  const { PHYSICAL, DIGITAL, SUBSCRIPTION } = GameFormat;

  it("hides the card for a wishlist game with nothing on record", () => {
    expect(showsLendingCard(GameOwnership.WISHLIST, PHYSICAL, 0)).toBe(false);
  });

  it("hides the card for a digital or subscription game with nothing on record", () => {
    for (const o of Object.values(GameOwnership)) {
      expect(showsLendingCard(o, DIGITAL, 0)).toBe(false);
      expect(showsLendingCard(o, SUBSCRIPTION, 0)).toBe(false);
    }
  });

  it("keeps a game's loan history visible whatever it is now", () => {
    expect(showsLendingCard(GameOwnership.WISHLIST, PHYSICAL, 2)).toBe(true);
    expect(showsLendingCard(GameOwnership.OWNED, DIGITAL, 1)).toBe(true);
  });

  it("shows the card for every other physical copy", () => {
    for (const o of [GameOwnership.OWNED, GameOwnership.BORROWED, GameOwnership.GIVEN_AWAY]) {
      expect(showsLendingCard(o, PHYSICAL, 0)).toBe(true);
    }
  });
});
