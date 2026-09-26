// lib/initials.ts
//
// ONE implementation of "what letters go in the circle when someone has
// no photo". There were six, and they disagreed.
//
// The rule:
//   "Tatenda Dube"        -> TD    first letter of first and last name
//   "Tatenda John Dube"   -> TD    middle names are skipped, not used
//   "Masha"               -> MA    one word gives two letters, not one
//   "  anne-marie  dube " -> AD    whitespace and case are not the user's job
//   ""                    -> the caller's fallback
//
// WHY THIS FILE EXISTS (26 Sep 2026): the six copies split three ways.
// index.tsx, messages.tsx and chat.tsx took first+last. profile.tsx,
// dealer.tsx and seller.tsx took the first letter of the first TWO words,
// so "Tatenda John Dube" came out TJ on the profile screen and TD in the
// inbox — the same person, two different circles. And a one-word name was
// a single letter in three of them and two letters in the other three.
// The seller-preview edge function had a seventh copy, with a comment
// admitting they should not disagree.
//
// Middle names are skipped deliberately. A person is identified by the
// name they are called and the name they share with their family; the
// name in between is the one nobody uses.

const FALLBACK = '?';

export function initialsFrom(name?: string | null, fallback: string = FALLBACK): string {
  // filter(Boolean) matters: splitting "  Tatenda  Dube " on whitespace
  // yields empty strings at both ends, and parts[0][0] on an empty string
  // is undefined, which renders as the word "undefined" in the circle.
  const parts = (name ?? '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  if (parts.length === 0) return fallback;

  if (parts.length === 1) {
    // Two letters from a single name. One lonely letter in a large circle
    // reads as a placeholder that failed to load.
    return parts[0].slice(0, 2).toUpperCase();
  }

  const first = parts[0][0] ?? '';
  const last = parts[parts.length - 1][0] ?? '';
  const out = (first + last).toUpperCase();

  return out || fallback;
}

/**
 * The name to greet someone by — their first name alone.
 *
 * Here rather than inline at the call site because keeping the two apart
 * is exactly what broke the home screen: it stored
 * `full_name.split(' ')[0]` in one piece of state, used it for the
 * greeting, and then passed that same truncated string to the initials
 * function. "Thuthukani Lusaba" became "Thuthukani" became TH.
 *
 * Greet with this. Draw the circle from the FULL name.
 */
export function firstNameFrom(name?: string | null): string {
  const parts = (name ?? '').trim().split(/\s+/).filter(Boolean);
  return parts[0] ?? '';
}
