// supabase/functions/seller-preview/index.ts
//
// Tier 1 of the shareable-seller-profile web piece. Returns raw,
// server-rendered HTML (not a React app) with real Open Graph tags
// populated from the actual seller's data — this is the part that
// makes WhatsApp/Facebook show a genuine preview card (their bots
// don't execute JavaScript, so a client-rendered React page would
// only ever show a generic, empty-looking preview).
//
// Canonical URL: https://imbizohub.app/seller/[id]
// This function itself lives at the Supabase Functions URL; getting
// https://imbizohub.app/seller/[id] to actually reach it requires a
// DNS/proxy step — see DEPLOY-NOTES at the bottom of this file. That
// domain-to-function connection is ALSO a hard requirement for Tier 2
// (Universal Links/App Links only work when the .well-known
// verification files live on the SAME domain as the links being
// intercepted) — so this isn't optional infrastructure, it's shared
// by both tiers.
//
// On load, the page attempts to open the app via its custom URL
// scheme; if that doesn't happen within ~1.5s (a reasonable signal the
// app isn't installed), it reveals "Download the app" store buttons
// instead. This is the standard "smart banner" pattern most apps use
// BEFORE proper Universal Links are configured — once Tier 2's
// apple-app-site-association / assetlinks.json are live, iOS/Android
// intercept the link at the OS level before this page even loads for
// users who have the app, making this fallback logic only relevant to
// users who genuinely don't have it yet.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const APP_SCHEME = 'imbizohub://seller';
// TODO: replace with the real store URLs once ImbizoHub is actually
// published — these don't exist yet since the app hasn't launched.
const APP_STORE_URL = 'https://apps.apple.com/app/imbizohub/idXXXXXXXXX';
const PLAY_STORE_URL = 'https://play.google.com/store/apps/details?id=com.imbizohub.app';

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const id = url.pathname.split('/').filter(Boolean).pop();

  if (!id) {
    return new Response('Missing seller id', { status: 400 });
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('full_name, avatar_url, rating, rating_count, dealer_pro_active, dealer_pro_expires_at, is_verified, verified_expires_at')
    .eq('id', id)
    .maybeSingle();

  if (!profile) {
    return new Response('Seller not found', { status: 404 });
  }

  const name = escapeHtml(profile.full_name || 'ImbizoHub Seller');
  const ratingText = profile.rating_count > 0
    ? `${Number(profile.rating).toFixed(1)}\u2605 (${profile.rating_count} review${profile.rating_count === 1 ? '' : 's'}) on ImbizoHub`
    : 'A seller on ImbizoHub';
  const avatarUrl = profile.avatar_url || 'https://imbizohub.app/default-avatar.png';
  const canonicalUrl = `https://imbizohub.app/seller/${id}`;
  const deepLink = `${APP_SCHEME}/${id}`;

  const isDealerPro = !!(profile.dealer_pro_active && profile.dealer_pro_expires_at && new Date(profile.dealer_pro_expires_at).getTime() > Date.now());
  const isVerified = !!(profile.is_verified && profile.verified_expires_at && new Date(profile.verified_expires_at).getTime() > Date.now());
  const badges = [isDealerPro ? '\u2b50 Dealer' : null, isVerified ? '\u2705 Verified' : null].filter(Boolean).join(' \u00b7 ');

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${name} — ImbizoHub</title>
<link rel="canonical" href="${canonicalUrl}">

<meta property="og:type" content="profile">
<meta property="og:title" content="${name} on ImbizoHub">
<meta property="og:description" content="${escapeHtml(ratingText)}">
<meta property="og:image" content="${escapeHtml(avatarUrl)}">
<meta property="og:url" content="${canonicalUrl}">

<meta name="twitter:card" content="summary">
<meta name="twitter:title" content="${name} on ImbizoHub">
<meta name="twitter:description" content="${escapeHtml(ratingText)}">
<meta name="twitter:image" content="${escapeHtml(avatarUrl)}">

<style>
  body { font-family: -apple-system, Roboto, Arial, sans-serif; background: #111; color: #fff; margin: 0; padding: 40px 20px; text-align: center; }
  img { width: 96px; height: 96px; border-radius: 48px; object-fit: cover; margin-bottom: 16px; }
  h1 { font-size: 20px; margin: 0 0 6px; }
  .rating { color: #B8860B; font-size: 14px; margin-bottom: 8px; }
  .badges { color: #B8860B; font-size: 12px; margin-bottom: 24px; }
  .btn { display: inline-block; background: #B8860B; color: #1A1A18; font-weight: 800; padding: 14px 28px; border-radius: 12px; text-decoration: none; margin: 6px; }
  .btn-outline { display: inline-block; border: 1.5px solid #B8860B; color: #B8860B; font-weight: 700; padding: 13px 28px; border-radius: 12px; text-decoration: none; margin: 6px; }
  #fallback { display: none; margin-top: 20px; }
</style>
</head>
<body>
  <img src="${escapeHtml(avatarUrl)}" alt="${name}">
  <h1>${name}</h1>
  <div class="rating">${escapeHtml(ratingText)}</div>
  ${badges ? `<div class="badges">${badges}</div>` : ''}

  <div id="opening">
    <p>Opening in the ImbizoHub app…</p>
  </div>

  <div id="fallback">
    <p>Don't have the app yet?</p>
    <a class="btn" href="${APP_STORE_URL}">Download for iPhone</a>
    <a class="btn-outline" href="${PLAY_STORE_URL}">Download for Android</a>
  </div>

  <script>
    window.location.href = ${JSON.stringify(deepLink)};
    setTimeout(function () {
      document.getElementById('opening').style.display = 'none';
      document.getElementById('fallback').style.display = 'block';
    }, 1500);
  </script>
</body>
</html>`;

  return new Response(html, {
    status: 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
});

// ── DEPLOY NOTES ──
//
// 1. Deploy this function normally:
//      supabase functions deploy seller-preview
//
// 2. Point imbizohub.app/seller/* at this function. Supabase Edge
//    Functions don't natively serve on a custom domain by default —
//    check whether "Custom Domains" is available on your current
//    Supabase plan (Dashboard -> Settings -> General). If it is, that's
//    the simplest path: map imbizohub.app directly, no extra service
//    needed. If not, a lightweight reverse proxy (e.g. a Cloudflare
//    Worker or Vercel rewrite rule) forwarding imbizohub.app/seller/:id
//    to this function's real URL is the standard workaround.
//
// 3. TODO before this is fully real: replace APP_STORE_URL and
//    PLAY_STORE_URL above with the actual store links once ImbizoHub
//    is published -- they're placeholders right now since the app
//    hasn't launched yet.
//
// 4. TODO: host a real default-avatar image at
//    https://imbizohub.app/default-avatar.png for sellers with no
//    avatar set, referenced above -- currently points at a path that
//    doesn't exist yet.