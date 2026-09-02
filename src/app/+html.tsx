// app/+html.tsx
//
// Expo Router's HTML shell for the WEB build only. This file is never
// bundled into the iOS/Android app — it exists purely to control the
// <head> of the exported web pages.
//
// WHY THIS FILE EXISTS (real, confirmed problem, not a nice-to-have):
// without a +html.tsx, Expo's static export produced a document whose
// head was literally `<title data-rh="true"></title>` — an empty title,
// no meta description, and no Open Graph tags at all. Verified directly
// against dist/index.html and against the live site.
//
// Two concrete consequences, both of which were actually happening:
//
//   1. Sharing any imbizohub.com link in a WhatsApp group produced a
//      bare grey link with no name, no description and no image. For a
//      marketplace whose main growth channel in Zimbabwe IS WhatsApp
//      sharing, that's the single most expensive missing tag in the
//      codebase.
//   2. Google had nothing to index — no title, no description, and an
//      empty #root (the app renders client-side), so search results
//      would show the bare URL if they showed anything at all.
//
// The tags below are the site-wide defaults, applied to every route.
// Individual screens can still override the title at runtime — but a
// sensible default is what stops a shared /listing or /seller link from
// unfurling blank.
//
// NOTE: og:image must be an ABSOLUTE url. WhatsApp and Facebook do not
// resolve relative paths when scraping, so a relative "/og-image.png"
// silently yields no image. Keep it fully qualified.

import { ScrollViewStyleReset } from 'expo-router/html';
import type { PropsWithChildren } from 'react';

const SITE_URL = 'https://imbizohub.com';
// Keep these two in step with web/index.html's <title> and meta
// description. They are the same product said twice — this file supplies
// the tags for every /app/* route, index.html supplies the marketing
// site's, and a person who meets both should read the identical sentence.
// They drifted once already: this file kept the old tagline and the
// retired "small app fee" promise after the site had moved on.
const TITLE = 'ImbizoHub — Ask for it. Sellers come to you.';
const DESCRIPTION =
  'Post what you need — a fridge, a van, a builder — and sellers come to you ' +
  'with their price. Or post a trip and transport operators bid for the job. ' +
  'Free to ask, free to chat, free to do a deal.';
const OG_IMAGE = `${SITE_URL}/og-image.png`;

export default function Root({ children }: PropsWithChildren) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta httpEquiv="X-UA-Compatible" content="IE=edge" />
        <meta
          name="viewport"
          content="width=device-width, initial-scale=1, shrink-to-fit=no"
        />

        <title>{TITLE}</title>
        <meta name="description" content={DESCRIPTION} />
        <meta name="theme-color" content="#111111" />

        {/* Open Graph — what WhatsApp / Facebook read when a link is shared. */}
        <meta property="og:type" content="website" />
        <meta property="og:site_name" content="ImbizoHub" />
        <meta property="og:url" content={SITE_URL} />
        <meta property="og:title" content={TITLE} />
        <meta property="og:description" content={DESCRIPTION} />
        <meta property="og:image" content={OG_IMAGE} />
        <meta property="og:image:width" content="1200" />
        <meta property="og:image:height" content="630" />
        <meta property="og:locale" content="en_ZW" />

        <meta name="twitter:card" content="summary_large_image" />
        <meta name="twitter:title" content={TITLE} />
        <meta name="twitter:description" content={DESCRIPTION} />
        <meta name="twitter:image" content={OG_IMAGE} />

        {/*
          Disables body scrolling on web so ScrollView components work
          as they do on native. Remove this if you ever want the whole
          page to scroll natively instead. Expo ships this helper for
          exactly this purpose — it is not optional boilerplate.
        */}
        <ScrollViewStyleReset />

        {/*
          The app is dark. Without this the browser paints a white
          background for the split second before React mounts, which
          reads as a flash on every navigation — and leaves the area
          around the app pale on desktop, which is what made the live
          site look unfinished next to its own dark UI.
        */}
        <style dangerouslySetInnerHTML={{ __html: BACKGROUND_STYLE }} />
      </head>
      <body>{children}</body>
    </html>
  );
}

const BACKGROUND_STYLE = `
html, body, #root {
  background-color: #111111;
}
`;
