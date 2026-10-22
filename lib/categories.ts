// lib/categories.ts
//
// The single list of marketplace categories, shared by every screen that
// offers or filters them: post.tsx, post-wanted.tsx, whatsapp-import.tsx
// (posting) and index.tsx, explore.tsx (browsing).
//
// WHY THIS FILE EXISTS:
// the list was hardcoded five times, and by the time it was collected
// here the copies had already drifted — index.tsx rendered Furniture as
// 🛋️ and Baby as 👶, explore.tsx rendered the same two as 🪑 and 🧸. The
// same category looked like a different thing depending on which screen
// you were standing on.
//
// The drift that matters more is the one that was about to happen:
// adding a category to the posting screens but not the browsing ones
// produces listings that exist, are searchable by text, and appear under
// no category filter at all. Nothing errors. The seller sees their
// listing; the buyer filtering by category never does.
//
// This is the same argument lib/cities.ts makes for city names, and it
// failed the same way there before the shared list existed.
//
// ORDER: roughly by how often people ask for them, with the two tech
// categories adjacent so a buyer looking for a laptop does not stop at
// Phones and assume that is as close as the app gets. 'Other' is last
// and is deliberately present — see CATEGORY_OTHER.
//
// NOT VALIDATED IN THE DATABASE. listings.category and
// item_requests.category are plain text with no CHECK constraint, so a
// value removed from this list does not disappear from existing rows.
// Renaming a category orphans every row that used the old name from its
// own filter. Add freely; rename with a backfill.

export type Category = {
  label: string;
  icon: string;
};

// REORDERED AND EXTENDED 22 Oct 2026, from usage rather than guesswork.
// The original order was "roughly by how often people ask for them",
// which at the time was a guess because nobody had asked for anything.
// Thirteen listings later the real shape is visible:
//
//   Services        5   plumbing, domestic work, two locticians, produce
//   Other           4   two cosmetics, fabrics, maize seed
//   Furniture /
//   Electronics /
//   Appliances      1 each
//   Phones, Vehicles, Clothing, Building, Baby   0
//
// Two of those tell us a category is missing rather than unpopular:
//
//   BEAUTY. Five of thirteen listings are hair or cosmetics - three
//   sisterlocs listings from two different Bulawayo stylists, and two
//   skincare products. One stylist joined and a second appeared the next
//   evening at a competing price, which is word of mouth inside a trade,
//   not advertising. They were scattered across Services and Other.
//
//   FARM & FOOD. Sweet potato filed under Services, maize seed under
//   Other, and an open Wanted post for cabbages. Produce has no home.
//
// The first seven non-'Other' entries are the home grid (see
// HOME_CATEGORY_COUNT in index.tsx); the rest hide behind More. So this
// order is a decision about what the app LOOKS like it is for. Leading
// with Services and Beauty is leading with what it actually is today.
// Phones and Electronics stay visible because they are what people
// search for in Zimbabwe even when nobody has listed one yet.
//
// Labels are kept to 11 characters or fewer: catLabel renders at font
// size 10 inside a width:'22%' tile with numberOfLines={1}, and
// 'Electronics' is the longest string proven to fit without an ellipsis.
// 'Hair & Beauty' would not; hence 'Beauty', whose icon carries the hair.
export const CATEGORIES: readonly Category[] = [
  { icon: '🔧', label: 'Services' },
  { icon: '💇', label: 'Beauty' },
  { icon: '📱', label: 'Phones' },
  { icon: '💻', label: 'Electronics' },
  { icon: '🌾', label: 'Farm & Food' },
  { icon: '🛋️', label: 'Furniture' },
  { icon: '🚗', label: 'Vehicles' },
  { icon: '👕', label: 'Clothing' },
  { icon: '🏠', label: 'Appliances' },
  { icon: '🧱', label: 'Building' },
  { icon: '👶', label: 'Baby' },
  // Existing rows filed under 'Other' are NOT migrated. The column is
  // free text with no constraint, and some of them genuinely are other.
  { icon: '📦', label: 'Other' },
] as const;

// The labels alone, for the screens that render plain chips with no icon.
export const CATEGORY_LABELS: readonly string[] = CATEGORIES.map((c) => c.label);

// A listing or want that fits none of the named categories. Kept last in
// the list and never used as a default — a default that is never changed
// is how three real Wanted posts ended up filed under 'Phones' before
// post-wanted.tsx made the field required.
export const CATEGORY_OTHER = 'Other';

export function isKnownCategory(value: string | null | undefined): boolean {
  return !!value && CATEGORY_LABELS.includes(value);
}

export function iconFor(label: string | null | undefined): string {
  return CATEGORIES.find((c) => c.label === label)?.icon ?? '📦';
}
