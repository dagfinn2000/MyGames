import { GameFormat, GameOwnership } from "@prisma/client";

/**
 * Pure lending helpers, kept out of the card component so they're testable —
 * the same split as lib/progress.ts and its playing card.
 */

/**
 * How long a game has been out, in words.
 *
 * Floors rather than rounds: a game lent this morning has been out for zero
 * whole days, and rounding turned that into "1 days" by mid-afternoon —
 * wrong on both the count and the grammar.
 */
export function outFor(lentAt: Date, now: Date): string {
  const days = Math.max(0, Math.floor((now.getTime() - lentAt.getTime()) / 86_400_000));
  if (days === 0) return "lent today";
  if (days === 1) return "out for 1 day";
  return `out for ${days} days`;
}

/** What the Lending card can do with this copy. Only a physical copy you
 *  own can be lent out (there's no disc or cartridge to hand over for a
 *  digital or subscription game); for the others the card says why not. */
export type LendingMode =
  | "lendable"
  | "borrowed"
  | "given-away"
  | "wishlist"
  | "digital"
  | "subscription";

export function lendingMode(ownership: GameOwnership, format: GameFormat): LendingMode {
  switch (ownership) {
    case GameOwnership.BORROWED:
      return "borrowed";
    case GameOwnership.GIVEN_AWAY:
      return "given-away";
    case GameOwnership.WISHLIST:
      return "wishlist";
  }
  switch (format) {
    case GameFormat.DIGITAL:
      return "digital";
    case GameFormat.SUBSCRIPTION:
      return "subscription";
    default:
      return "lendable";
  }
}

/** The Lending card is for physical copies you have or had. A wishlist,
 *  digital or subscription game has nothing to lend, so it gets no card,
 *  unless it has loans on record (it was a lendable copy once), which must
 *  not vanish. */
export function showsLendingCard(
  ownership: GameOwnership,
  format: GameFormat,
  loanCount: number,
): boolean {
  if (loanCount > 0) return true;
  return ownership !== GameOwnership.WISHLIST && format === GameFormat.PHYSICAL;
}

/** The card's line while nothing is lent out. */
export const LENDING_NOTE: Record<LendingMode, string> = {
  lendable: "This copy is on your shelf.",
  borrowed: "Borrowed copy. It isn't yours to lend.",
  "given-away": "You no longer have this copy.",
  wishlist: "On your wishlist, so there's no copy to lend.",
  digital: "A digital copy, so there's nothing to hand over.",
  subscription: "Part of a subscription, so there's no copy to lend.",
};
