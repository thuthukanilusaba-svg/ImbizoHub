# ImbizoHub Website Deployment (Vercel)

This documents how imbizohub.com was set up, so it can be repeated, debugged, or handed off later without having to rediscover any of it.

## Overview

The website is the same Expo Router codebase as the phone app, exported as a static website and hosted on Vercel. It is a **separate deployment pipeline** from the phone apps — updating one does not update the other. See "Keeping things in sync" below.

## Vercel account

- **Account/team name:** `imbizohub`
- **Plan:** Hobby (free tier)
- **Why Hobby and not Pro:** Vercel's Hobby plan is restricted to non-commercial use. The website's first launch is browsing/listings only, with no checkout/payment flow live on the web yet, so Hobby is appropriate for now.
- **⚠️ Action required before enabling web checkout:** Once Paynow/checkout is wired up for the website, this must be upgraded to a **Pro plan** (Settings → Billing → Upgrade) before that goes live — running real payment processing on the free Hobby tier is against Vercel's terms.

## GitHub connection

- Vercel's GitHub App is installed on the `thuthukanilusaba-svg` GitHub account, scoped to **only the ImbizoHub repository** (not "all repositories").
- The Vercel project (`imbizo-hub`) is connected to the `main` branch. Every push to `main` on GitHub automatically triggers a new Vercel build and deployment — no manual deploy step needed for the website.

## Build settings

Vercel's automatic framework detection does not understand Expo Router, so these are manually overridden in **Project → Settings → Build and Deployment**:

| Setting | Value |
|---|---|
| Framework Preset | Other |
| Build Command | `npx expo export --platform web` |
| Output Directory | `dist` |
| Install Command | (default — `npm install`) |

If a future deployment starts 404ing on every page, check this screen first — it's the most common failure point, and defaults will silently revert to guesses that don't match Expo's output.

## Domain / DNS

Domain `imbizohub.com` is registered at **Namecheap**, DNS pointed at Vercel:

| Type | Host | Value |
|---|---|---|
| A | `@` | `216.198.79.1` |
| CNAME | `www` | `6f60eeddfe7284e6.vercel-dns-017.com` |

`imbizohub.com` redirects (308) to `www.imbizohub.com`, which is the actual production deployment.

**Note:** Namecheap ships new domains with placeholder "parking page" records (a URL Redirect record on `@`, and a CNAME on `www` pointing to `parkingpage.namecheap.com`) — these had to be deleted/edited before the records above would take effect. If DNS ever needs to be redone from scratch, watch for those same placeholders.

There is also a pre-existing `TXT` record on `privateemail._...` for email (DKIM signing) — unrelated to the website, do not touch it.

## Code changes made specifically for the website

The app was originally built phone-width-first, so a few things needed adjusting once it was actually running in a browser. All of these are gated so they only affect web — the phone apps render exactly as before:

- **`src/app/_layout.tsx`** — the whole app is now wrapped in a `Platform.OS === 'web'`-gated container that caps content to a phone-like width (480px) and centers it in the browser, rather than stretching full-width. This is the single biggest fix — most of the "looks broken on desktop" issues traced back to this.
- **`src/app/listing.tsx`** — the photo carousel used to size itself off the raw browser window width; it now measures its actual rendered container width instead, so it stays correctly proportioned inside the centered layout above.
- **`components/BottomNav.tsx`** — on web, the bottom nav tabs share the available width evenly instead of using the phone app's horizontal-scroll-to-reveal-more-tabs pattern (dragging a nav bar sideways isn't a discoverable gesture with a mouse). Native keeps the original scrollable version.

If other screens turn out to have similar issues (something measuring the raw window/screen width instead of its actual container), the same pattern applies: replace `Dimensions.get('window').width` with an `onLayout`-measured value.

## Keeping things in sync

There are **three separate places** this codebase gets published to, and none of them update automatically from the others:

| Target | How it updates | Review required? |
|---|---|---|
| Website (imbizohub.com) | Automatic — any push to `main` on GitHub | No |
| Android/iOS (JS-only changes) | Manual — `eas update --branch production` / `--branch preview` | No |
| Android/iOS (native changes, e.g. new packages) | Manual — `eas build` then `eas submit` | Yes (Google Play / App Store review) |

A typical change: push to GitHub (website updates itself) → separately decide whether it also needs `eas update` or a full `eas build`/`eas submit` for the phone apps.

## Open items

- Upgrade Vercel to Pro before enabling web checkout/payments (see above).
- No other screens besides the listing carousel have been checked yet for the "measures raw window width" issue — worth a pass if more layout bugs show up on web.
- DNS is live and both `imbizohub.com` and `www.imbizohub.com` show Valid Configuration in Vercel as of this writing.
