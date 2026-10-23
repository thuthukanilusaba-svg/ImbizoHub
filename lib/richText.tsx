// lib/richText.tsx
//
// Makes links and phone numbers inside user-written text tappable.
//
// WHY THIS EXISTS. Milli fabrics put her WhatsApp catalogue link in her
// listing description — the whole URL, stored perfectly, rendered on
// screen in full. It was completely inert. listing.tsx drew the
// description as a plain <Text>, and a plain <Text> in React Native is
// not a browser: a URL in it is just characters. She had done
// everything right and the app quietly made it useless.
//
// (For a while I believed a 60-character cap had truncated that link.
// It had not. There is no such cap anywhere — no maxLength on the title
// input, no length constraint in Postgres, and the longest title in the
// database is 55 characters. The link was always complete. The bug was
// only ever that nobody could tap it. Worth recording, because "the
// data is broken" and "the rendering is broken" lead to opposite fixes,
// and the wrong one would have changed a table for no reason.)
//
// Mandisa's description has "0719 636 649" in it. Chris and Geo's
// placements business, every seller who writes "call me on" — all the
// same. People put their contact details in the description because
// that is how WhatsApp selling works, and until now the app treated all
// of it as decoration.
//
// WHAT IT DELIBERATELY DOES NOT DO. No email detection, no @handles, no
// auto-linking of anything that merely looks like a domain. Each new
// pattern is a new way to produce a false positive in the middle of
// somebody's sentence, and a tappable thing that leads nowhere is worse
// than plain text. Two patterns, both tested against the real
// descriptions in the database.

import { useCallback } from 'react';
import { Linking, StyleProp, Text, TextStyle } from 'react-native';

// http(s), or a bare www. — stops at whitespace and at the punctuation
// that usually ends a sentence containing a link rather than belonging
// to it. A trailing full stop or bracket is trimmed below, because
// "see https://imbizohub.com." should not link to a URL ending in a dot.
const URL_RE = /\b(?:https?:\/\/|www\.)[^\s<>"')\]]+/gi;

// Zimbabwe numbers as people actually type them: +263 77 850 6634,
// 0785544908, 0719 636 649. Requires 9 or 10 digits after the prefix and
// allows single spaces or hyphens between them.
//
// The lookbehind for a digit or slash is what keeps it off the inside of
// other numbers — without it, the 263714620799 inside Milli's wa.me URL
// matches as a phone number and the link is cut in half by a second,
// overlapping match. (URL spans are also skipped outright below; this is
// the belt to that's braces.)
//
// Tested against every description in the database: it does NOT match
// "0.9m high, 1m wide and 0.5m deep" or "2630 x 1000mm". Any change to
// this pattern should be re-checked against those two, because
// dimensions and prices are the false positives that matter here.
const PHONE_RE = /(?<![\d/])(?:\+?263|0)(?:[\s-]?\d){8,9}\b/g;

type Segment =
  | { kind: 'text'; value: string }
  | { kind: 'url'; value: string }
  | { kind: 'tel'; value: string };

// Exported for testing and for any other screen that wants the spans
// without the rendering.
export function segmentRichText(text: string): Segment[] {
  const marks: { start: number; end: number; kind: 'url' | 'tel'; value: string }[] = [];

  for (const m of text.matchAll(URL_RE)) {
    if (m.index === undefined) continue;
    // Trailing sentence punctuation belongs to the sentence, not the URL.
    const trimmed = m[0].replace(/[.,;:!?)\]]+$/, '');
    marks.push({ start: m.index, end: m.index + trimmed.length, kind: 'url', value: trimmed });
  }

  for (const m of text.matchAll(PHONE_RE)) {
    if (m.index === undefined) continue;
    const start = m.index;
    const end = start + m[0].length;
    // Never inside a URL — see PHONE_RE's comment.
    if (marks.some((k) => start < k.end && end > k.start)) continue;
    marks.push({ start, end, kind: 'tel', value: m[0] });
  }

  marks.sort((a, b) => a.start - b.start);

  const out: Segment[] = [];
  let cursor = 0;
  for (const mark of marks) {
    if (mark.start < cursor) continue; // overlapping leftovers, skip
    if (mark.start > cursor) out.push({ kind: 'text', value: text.slice(cursor, mark.start) });
    out.push({ kind: mark.kind, value: mark.value });
    cursor = mark.end;
  }
  if (cursor < text.length) out.push({ kind: 'text', value: text.slice(cursor) });

  return out;
}

function hrefFor(segment: Segment): string | null {
  if (segment.kind === 'url') {
    return segment.value.startsWith('www.') ? `https://${segment.value}` : segment.value;
  }
  if (segment.kind === 'tel') {
    return `tel:${segment.value.replace(/[\s-]/g, '')}`;
  }
  return null;
}

export function LinkedText({
  children,
  style,
  linkStyle,
}: {
  children: string | null | undefined;
  style?: StyleProp<TextStyle>;
  linkStyle?: StyleProp<TextStyle>;
}) {
  // Never throws at the person. A link that will not open is a
  // disappointment; a crash on a listing page loses the sale.
  const open = useCallback(async (href: string) => {
    try {
      await Linking.openURL(href);
    } catch {
      // Deliberately silent — nothing useful to say, and an error
      // banner over a listing because a tel: handler is missing on a
      // desktop browser would be worse than nothing happening.
    }
  }, []);

  if (!children) return null;

  const segments = segmentRichText(children);

  return (
    <Text style={style}>
      {segments.map((segment, i) => {
        const href = hrefFor(segment);
        if (!href) return <Text key={i}>{segment.value}</Text>;
        return (
          <Text
            key={i}
            style={linkStyle}
            onPress={() => open(href)}
            // So a long URL inside a description cannot push the layout
            // sideways on a narrow phone.
            numberOfLines={undefined}
          >
            {segment.value}
          </Text>
        );
      })}
    </Text>
  );
}
