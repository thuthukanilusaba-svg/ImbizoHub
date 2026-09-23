// lib/slug.ts
//
// The short shop link: imbizohub.com/s/kombi-spares instead of
// imbizohub.com/seller?id=be32a5f4-... Nobody puts a UUID in a WhatsApp
// status, which is the entire reason this exists.
//
// THIS FILE IS A MIRROR, NOT A SOURCE OF TRUTH.
// The database owns every rule below, three times over:
//
//   profiles_slug_format        CHECK  ^[a-z0-9]([a-z0-9-]{1,28})[a-z0-9]$
//   profiles_slug_not_reserved  CHECK  slug <> ALL (ARRAY[...])
//   enforce_slug_requires_dealer_pro  trigger — normalises, then requires
//                               an unexpired Dealer Pro (service_role
//                               bypasses, clearing is always allowed)
//
// Everything here is for TELLING THE USER SOONER. A rule enforced only
// in the client is not enforced; a rule enforced only in the database
// makes someone type a name, tap Save, and find out. Both, and the
// server wins.
//
// KEEPING THEM IN STEP: if the CHECK constraints are ever changed, change
// these too in the same commit. The failure mode when they drift is
// quiet in the direction that matters least (client stricter than server
// = a valid name refused locally) and loud in the other (client looser =
// the save fails with a raw Postgres error). Neither is acceptable, but
// only one is visible in testing, which is why this comment exists.
//
// normaliseSlug() in particular must match the trigger's regexp_replace
// pair EXACTLY. If it does not, the user is shown one link and the
// database stores another, and the link they share is not the link they
// have.

export const SLUG_MIN_LENGTH = 3;
export const SLUG_MAX_LENGTH = 30;

// Mirrors profiles_slug_format. Reads as: starts alphanumeric, ends
// alphanumeric, 1–28 of [a-z0-9-] in between — so 3 to 30 characters,
// never a leading or trailing hyphen.
export const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,28}[a-z0-9]$/;

// Mirrors profiles_slug_not_reserved. Two kinds of name are in here and
// both matter:
//
//   ROUTES — 's', 'seller', 'app', 'contact', 'terms'... A slug that
//   collides with a real path on imbizohub.com does not merely look
//   confusing, it is unreachable: the site's own route wins and the
//   dealer's link opens the wrong page forever.
//
//   IDENTITIES — 'imbizohub', 'official', 'support', 'billing',
//   'paynow', 'ecocash'. imbizohub.com/s/support is a phishing address
//   wearing our domain. Nobody gets to be us.
export const RESERVED_SLUGS: readonly string[] = [
  'a', 's', 'api', 'app', 'www', 'admin', 'administrator', 'root', 'system',
  'seller', 'sellers', 'shop', 'shops', 'store', 'stores',
  'user', 'users', 'profile', 'profiles',
  'listing', 'listings', 'wanted', 'transport',
  'pricing', 'safety', 'contact', 'about', 'help', 'support', 'faq',
  'privacy', 'terms', 'legal', 'data-retention', 'delete-account',
  'login', 'logout', 'register', 'signup', 'signin', 'reset-password',
  'auth', 'auth-callback', 'well-known', 'static', 'assets', 'public',
  'imbizohub', 'imbizo', 'hub', 'official', 'team', 'staff', 'moderator',
  'billing', 'payment', 'payments', 'paynow', 'ecocash', 'dealer', 'pro',
];

export const SHOP_LINK_HOST = 'imbizohub.com';

// What the dealer actually hands out. Kept here so the app, the edge
// function's canonical tag and the marketing copy cannot drift apart.
export function shopLinkUrl(slug: string): string {
  return `https://${SHOP_LINK_HOST}/s/${slug}`;
}

// What the dealer reads on screen. No scheme — a link is easier to
// recognise as a link without https:// in front of it, and this string
// is never used to navigate.
export function shopLinkDisplay(slug: string): string {
  return `${SHOP_LINK_HOST}/s/${slug}`;
}

// Mirrors step 1 of enforce_slug_requires_dealer_pro EXACTLY:
//   lower(trim(x)) -> [^a-z0-9]+ becomes '-' -> strip leading/trailing '-'
//
// Deliberately forgiving. "Kombi Spares", "KombiSpares" and
// "  Kombi Spares!!  " all become kombi-spares. Somebody naming their
// own shop should not have to learn our character rules first — they
// should type the name of their shop and see what it turns into.
export function normaliseSlug(input: string | null | undefined): string {
  if (!input) return '';
  return input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// Returns a sentence to show the user, or null when the slug is
// structurally fine. Structurally — it says nothing about whether
// somebody else already has it, which only the database knows.
//
// The messages describe the NORMALISED value, because that is what will
// be saved and what the checks below actually ran against. Telling
// someone "that is too short" about a string they can see is 9
// characters long ("Kombi!!!!" -> "kombi") would be baffling.
export function slugProblem(slug: string): string | null {
  if (!slug) return 'Type a name for your shop link.';

  if (slug.length < SLUG_MIN_LENGTH) {
    return `Too short — use at least ${SLUG_MIN_LENGTH} letters or numbers.`;
  }
  if (slug.length > SLUG_MAX_LENGTH) {
    return `Too long — ${SLUG_MAX_LENGTH} characters at most.`;
  }
  if (RESERVED_SLUGS.includes(slug)) {
    return 'That name is reserved by ImbizoHub. Try adding your town or what you sell.';
  }
  // Anything normaliseSlug() produced should pass this. It is here for
  // the case that it does not — a value arriving from somewhere else,
  // or this file drifting from the constraint it mirrors.
  if (!SLUG_RE.test(slug)) {
    return 'Use letters, numbers and hyphens only.';
  }
  return null;
}
