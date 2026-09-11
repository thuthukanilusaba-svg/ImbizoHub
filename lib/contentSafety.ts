// lib/contentSafety.ts
//
// Stops code being typed into a listing title or description, in the
// form, before anything is sent.
//
// THIS IS THE SECOND LINE, NOT THE FIRST. The database refuses the same
// content (enforce_listing_content_sane), and that is the boundary that
// actually holds — a client check protects nobody, because anyone can
// call the API directly and skip this file entirely. What it buys is a
// seller finding out immediately, in the field they are typing in,
// instead of after their photos have uploaded and the save has failed.
//
// The two must agree. If you change the rule here, change the trigger,
// and vice versa; a form that accepts what the database refuses is
// worse than no check at all, because it looks like a bug in the app.
//
// THE RULE: a '<' followed by a letter — optionally through a /, ! or ?
// — is a tag, and so is '<!--'. Nothing else in ordinary writing has
// that shape. This is deliberately a SHAPE and not a list of tag
// names: a list is a promise that the list is complete, and it never
// is.
//
// Deliberately still allowed: "under <$50", "5 > 3 bars", "Price < 100",
// "Love it <3", "8am <> 5pm". A '<' followed by a space, a digit or a
// symbol is how people write, not how they write code.
//
// Deliberately NOT allowed, and worth knowing: "T-shirt <M>". Sizes in
// angle brackets are the one real thing this costs. "T-shirt (M)" and
// "size M" both work.

const TAG_SHAPE = /<\s*[/!?]?\s*[A-Za-z]|<!--/;
const EVENT_ATTR = /[\s/]on[a-z]+\s*=/i;
const SCRIPT_URL = /(javascript|vbscript)\s*:|data\s*:\s*[a-z-]+\//i;

// ImbizoHub cannot be claimed as an endorsement. Mentioning it is fine
// — "bought on ImbizoHub" — but a status word next to it is not.
const BRAND = /imbizo\s*-?\s*hub/i;
const CLAIM =
  /\b(official|officially|verified|authorised|authorized|approved|certified|endorsed|accredited|partner|agent|staff|support|admin|administrator|moderator|team)\b/i;

function claimsEndorsement(text: string): boolean {
  const brand = BRAND.exec(text);
  if (!brand) return false;
  // Same 25-character window the database uses, checked both ways round.
  const start = Math.max(0, brand.index - 25);
  const end = Math.min(text.length, brand.index + brand[0].length + 25);
  return CLAIM.test(text.slice(start, end));
}

/**
 * Returns a message to show the person, or null when the text is fine.
 * Wording matches the database's, so the same problem reads the same
 * way whichever layer catches it.
 */
export function checkListingText(
  text: string,
  field: 'title' | 'description'
): string | null {
  const value = (text ?? '').trim();
  if (!value) return null;

  if (TAG_SHAPE.test(value) || EVENT_ATTR.test(value) || SCRIPT_URL.test(value)) {
    return field === 'title'
      ? 'Titles cannot contain code or HTML tags. Please use plain words.'
      : 'Descriptions cannot contain code or HTML tags. Please describe the item in plain words.';
  }

  if (claimsEndorsement(value)) {
    return 'Listings cannot claim to be official, verified or approved by ImbizoHub.';
  }

  return null;
}

/** Both fields at once; returns the first problem found, or null. */
export function checkListingContent(title: string, description: string): string | null {
  return checkListingText(title, 'title') ?? checkListingText(description, 'description');
}
