// lib/listingNav.ts
//
// Shared helper for "swipe to the next/previous posting" on
// listing.tsx. Every screen that links into a single listing FROM A
// LIST (Browse/Explore's grid, a category, the home page's recent-
// listings grid, a seller's shop, "My Listings") calls
// buildListingHref() with the id being opened AND the full ordered list
// of listing ids currently shown on that screen, so listing.tsx can
// compute what's next/previous in THAT SAME order when the user swipes
// — rather than a generic, out-of-context "newest citywide" feed that
// could jump from a "bicycle" search result straight into an unrelated
// sofa. One shared helper rather than five separate implementations so
// there's a single place to get the URL shape right, per the reasoning
// discussed with the user before building this.
//
// The context travels as a compact comma-joined id string in the
// route's own query params (Expo Router route params are always
// strings), NOT full listing objects — keeps the URL short-lived and
// avoids staleness, since listing.tsx always re-fetches whichever id it
// lands on fresh from Supabase regardless of what's in the context.
//
// Screens that DON'T show a list (e.g. a single featured-listing card)
// should just call router.push(\`/listing?id=${id}\`) directly, same as
// before — buildListingHref only helps when there's an actual list to
// carry along.

// Capped so an unusually long, unpaginated result set can't blow out
// the URL — swiping past the cap just runs out of "next", the same
// experience as reaching the real end of a shorter list.
const MAX_CONTEXT_IDS = 200;

export function buildListingHref(
  id: number | string,
  contextIds?: Array<number | string>
): string {
  if (!contextIds || contextIds.length === 0) {
    return `/listing?id=${id}`;
  }
  const capped = contextIds.slice(0, MAX_CONTEXT_IDS);
  return `/listing?id=${id}&ctx=${capped.join(',')}`;
}

export function parseListingContext(
  ctxParam: string | string[] | undefined
): number[] {
  if (!ctxParam) return [];
  const raw = Array.isArray(ctxParam) ? ctxParam[0] : ctxParam;
  if (!raw) return [];
  return raw
    .split(',')
    .map((s) => parseInt(s, 10))
    .filter((n) => !Number.isNaN(n));
}
