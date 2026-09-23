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

export const CATEGORIES: readonly Category[] = [
  { icon: '📱', label: 'Phones' },
  { icon: '💻', label: 'Electronics' },
  { icon: '🚗', label: 'Vehicles' },
  { icon: '🛋️', label: 'Furniture' },
  { icon: '👕', label: 'Clothing' },
  { icon: '🏠', label: 'Appliances' },
  { icon: '🧱', label: 'Building' },
  { icon: '👶', label: 'Baby' },
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
