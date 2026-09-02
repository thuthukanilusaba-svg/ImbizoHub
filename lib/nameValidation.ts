// lib/nameValidation.ts
//
// One rule for what a person may call themselves, used by every screen
// that accepts a name.
//
// WHY THIS EXISTS. Registration accepted anything at all. The profiles
// table currently contains a row whose full_name is  '  or  "  — a SQL
// injection probe, typed into the sign-up form by a person or a scanner
// looking for a way in. It did no damage (supabase-js parameterises every
// query, so it was only ever stored as text) but it should never have been
// accepted, and the same field would just as happily hold a URL, an emoji
// wall, or "ImbizoHub Support".
//
// THAT LAST ONE IS THE REAL RISK. This is a marketplace where strangers
// agree to meet and hand over money. A seller who can name themselves
// "ImbizoHub Official" or "Admin — Verified" is impersonating the one
// party everyone in the transaction is trusting. Rejecting punctuation is
// tidiness; rejecting that is fraud prevention, and it is why RESERVED
// below matters more than the character rule.
//
// WHAT IT MUST NOT BREAK. "No special characters" cannot mean "A-Z only".
// Real names in this market carry:
//   - double-barrelled surnames: Sibanda-Lusaba
//   - apostrophes: N'dlovu, O'Brien, and the typographic ’ that iOS
//     substitutes automatically as you type
//   - accented letters from Portuguese and French-speaking neighbours:
//     José, Chloé, Nuño
// A rule that rejects any of those tells a real person their real name is
// invalid, which is a worse failure than accepting a bad one.
//
// The allowed set is written as explicit ranges rather than \p{L}, for the
// same reason lib/money.ts avoids toLocaleString: Unicode property escapes
// depend on the JS engine's build, and this has to behave identically on
// every Android phone the app runs on.

/** Letters: ASCII, Latin-1 Supplement, Latin Extended-A and -B. */
const LETTER = "A-Za-z\\u00C0-\\u024F";

/** Marks (combining accents), for names typed as base letter + accent. */
const MARK = "\\u0300-\\u036F";

/** Joiners a name may legitimately contain, between letters. */
const JOINER = "\\s'’\\-.";

const NAME_RE = new RegExp(
  `^[${LETTER}][${LETTER}${MARK}${JOINER}]*$`
);

/** Two letters in a row somewhere — rules out "A .", "- -" and similar. */
const HAS_REAL_LETTERS = new RegExp(`[${LETTER}]{2}`);

export const NAME_MAX = 60;
export const NAME_MIN = 2;

/**
 * Names nobody may take, because using one is impersonation rather than a
 * naming choice. Matched loosely — spaces, punctuation and case are
 * stripped first — so "I m b i z o  H u b" and "imbizo-hub" are caught too.
 */
const RESERVED = [
  'imbizohub', 'imbizo', 'thusissystems',
  'support', 'admin', 'administrator', 'moderator',
  'official', 'verified', 'help', 'helpdesk', 'customercare',
  'sindie', 'system', 'security', 'payments', 'ecocash', 'paynow',
];

export type NameCheck = { ok: true; value: string } | { ok: false; error: string };

/**
 * Validate and normalise a person's name.
 *
 * Returns the cleaned value on success — always use it rather than the raw
 * input, because it trims and collapses runs of spaces. Two existing rows
 * ("Khumbulani ", "Methembe ") carry trailing spaces precisely because
 * registration stored the raw string.
 */
export function checkName(raw: string): NameCheck {
  // Collapse internal whitespace as well as trimming the ends: "Nkosi
  // <tab> Nyathi" and "Nkosi  Nyathi" should both store identically.
  const value = String(raw ?? '').replace(/\s+/g, ' ').trim();

  if (!value) {
    return { ok: false, error: 'Please enter your name.' };
  }
  if (value.length < NAME_MIN) {
    return { ok: false, error: 'That name is too short.' };
  }
  if (value.length > NAME_MAX) {
    return { ok: false, error: `Please keep your name under ${NAME_MAX} characters.` };
  }
  if (!NAME_RE.test(value) || !HAS_REAL_LETTERS.test(value)) {
    // Names the exact offending character, because "invalid name" leaves
    // someone guessing which part of their own name the app dislikes.
    const bad = Array.from(value).find(
      (ch) => !new RegExp(`[${LETTER}${MARK}${JOINER}]`).test(ch)
    );
    return {
      ok: false,
      error: bad
        ? `Names can't contain "${bad}". Letters, spaces and hyphens only.`
        : 'Please enter your name using letters.',
    };
  }

  const squashed = value.toLowerCase().replace(new RegExp(`[^${LETTER}]`, 'g'), '');
  if (RESERVED.some((word) => squashed === word || squashed.startsWith(word))) {
    return {
      ok: false,
      error: 'That name is reserved. Please use your own name.',
    };
  }

  return { ok: true, value };
}
