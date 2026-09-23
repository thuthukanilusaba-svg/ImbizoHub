// lib/badges.ts
//
// The chip on a listing card: Verified, Dealer, or New.
//
// WHY THIS FILE EXISTS — a real bug, found 23 September 2026.
//
// listings.badge was written ONCE, at post time, from whether the seller
// was Dealer Pro at that moment, and post.tsx deliberately excludes it
// from edits. That is correct as a RECORD of what the seller was. It is
// wrong as a DISPLAY of what the seller is, and it was being used for
// both. Two ways it failed, in opposite directions:
//
//   A dealer subscribes on Monday. Every listing they already had still
//   says "New". They paid $30 and nothing visibly changed — which is
//   the worst possible first hour of a subscription.
//
//   A dealer's Pro lapses. Every listing they posted while paying still
//   says "Dealer", for ever. The badge outlives the subscription, so
//   the thing being sold keeps being given away.
//
// The same column carried a second, quieter version of the same fault.
// "New" was also frozen at post time, so a listing posted in August
// still announced itself as new in late September. Every one of the 11
// listings in the database says "New", including ones 24 days old.
//
// THE FIX IS THE PATTERN THE APP ALREADY USED FOR VERIFIED. index.tsx
// and listing.tsx never trusted the column for the Verified chip — they
// read the seller's profile and checked is_verified against
// verified_expires_at at render time. Dealer now works the same way,
// and "New" is derived from created_at. Nothing about a badge is stored
// any more; all three are computed from facts that are already true.
//
// listings.badge is still WRITTEN by post.tsx and whatsapp-import.tsx.
// Nothing reads it. It is kept as a historical record of what the
// seller was when they posted, which is genuinely useful and genuinely
// different from what to show a buyer today. If you ever find yourself
// rendering from it again, re-read the two paragraphs above first.
//
// EXPIRY IS CHECKED, NOT ASSUMED. Neither dealer_pro_active nor
// is_verified is ever set back to false when the period runs out — no
// cron does that, deliberately. Every consumer ANDs the flag with its
// expiry date instead, which means a subscription lapses on its own the
// moment the clock passes it. isProNow() and isVerifiedNow() are that
// check, written once instead of the five hand-copied versions that
// were spread across the app.

// How long a listing reads as new.
//
// TUNE THIS FREELY — it is the only thing deciding whether the chip
// shows. 14 days is roughly how long a marketplace item stays
// interesting; the previous behaviour was "for ever", which is why a
// 24-day-old bicycle was still being announced as new.
export const NEW_LISTING_DAYS = 14;

export type ListingBadge = 'Verified' | 'Dealer' | 'New';

type ProFields = {
  dealer_pro_active?: boolean | null;
  dealer_pro_expires_at?: string | null;
};

type VerifiedFields = {
  is_verified?: boolean | null;
  verified_expires_at?: string | null;
};

export type BadgeSeller = ProFields & VerifiedFields;

// Active Dealer Pro RIGHT NOW. The flag alone is not enough and never
// was — see the note about expiry above.
export function isProNow(seller: ProFields | null | undefined): boolean {
  return !!(
    seller?.dealer_pro_active &&
    seller?.dealer_pro_expires_at &&
    new Date(seller.dealer_pro_expires_at).getTime() > Date.now()
  );
}

// Verified RIGHT NOW. Same shape, same reasoning.
export function isVerifiedNow(seller: VerifiedFields | null | undefined): boolean {
  return !!(
    seller?.is_verified &&
    seller?.verified_expires_at &&
    new Date(seller.verified_expires_at).getTime() > Date.now()
  );
}

export function isNewListing(createdAt: string | null | undefined): boolean {
  if (!createdAt) return false;
  const posted = new Date(createdAt).getTime();
  // An unparseable date is not new. Returning true would put a "New"
  // chip on anything with a malformed timestamp, which is the loudest
  // possible response to a data problem nobody can see.
  if (!isFinite(posted)) return false;
  return Date.now() - posted < NEW_LISTING_DAYS * 24 * 60 * 60 * 1000;
}

// ONE chip, in this order of precedence:
//
//   Verified beats Dealer — it is the stronger claim and the harder one
//   to get. Verified means a human reviewed an ID document; Dealer means
//   a subscription is paid. A seller who is both should show the one
//   that took more to earn.
//
//   Dealer beats New, because "New" describes the listing and "Dealer"
//   describes the seller, and a buyer deciding whether to message
//   someone cares more about who they are than how recently they posted.
//
// Returns null when none apply — an established, unsubscribed seller's
// older listing carries no chip at all, which is correct. The chip is
// supposed to mean something.
export function listingBadge(
  seller: BadgeSeller | null | undefined,
  createdAt: string | null | undefined
): ListingBadge | null {
  if (isVerifiedNow(seller)) return 'Verified';
  if (isProNow(seller)) return 'Dealer';
  if (isNewListing(createdAt)) return 'New';
  return null;
}

// The columns every screen needs on the profiles row for the above to
// work. Kept here so a screen cannot render a badge from a SELECT that
// forgot to fetch what the badge depends on — which returns a missing
// chip rather than an error, and so survives review.
export const BADGE_PROFILE_COLUMNS =
  'dealer_pro_active, dealer_pro_expires_at, is_verified, verified_expires_at';
