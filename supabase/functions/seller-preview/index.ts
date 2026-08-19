// supabase/functions/seller-preview/index.ts
//
// Server-rendered HTML for a public seller profile, with real Open Graph
// tags populated from that seller's actual data. This is what makes a
// shared link show a genuine preview card in WhatsApp and Facebook —
// their scrapers do not execute JavaScript, so the client-rendered React
// app can never produce anything but a generic card.
//
// Canonical URL: https://imbizohub.com/seller?id=<uuid>
// Reached via a Vercel rewrite in vercel.json that proxies
// imbizohub.com/seller -> this function. Vercel (not GitHub Pages) is
// used because it can both proxy to this function AND serve the
// .well-known verification files from the same origin, which Universal
// Links / App Links require.
//
// ─────────────────────────────────────────────────────────────────────
// FOUR REAL BUGS FIXED HERE — every one of them individually prevented
// this feature from working at all:
//
// 1. verify_jwt was TRUE. This function's entire job is to be fetched by
//    anonymous visitors and by WhatsApp's scraper, neither of which has
//    a Supabase JWT. It returned 401 to literally every caller. Now
//    deployed with verify_jwt false. (This is safe: it reads only the
//    public profile fields already shown on the in-app public profile
//    screen, and takes no input beyond an id.)
//
// 2. The id was read as the LAST PATH SEGMENT. With no id supplied that
//    silently picked up the string "seller-preview" (the function's own
//    name in its URL) and looked THAT up as a seller id. Now reads the
//    ?id= query param first, tolerates a path segment for older links,
//    and explicitly refuses to treat its own slug as an id.
//
// 3. The in-app deep link was built as `imbizohub://seller/<id>` — path
//    form. seller.tsx reads `id` as a QUERY param and there is no
//    app/seller/[id].tsx route, so that link opened the app to an empty
//    seller screen showing "not found". This is the exact bug already
//    fixed once in seller.tsx; it was never fixed here. Now query form.
//
// 4. The redirect fired on every device including desktop, where a
//    custom-scheme navigation does nothing useful and can surface a
//    browser error. Now only attempted on mobile, and the page always
//    renders a usable fallback.
//
// Remaining TODO, unavoidable until the app is actually published:
// APP_STORE_URL still contains a placeholder id. The Play Store URL is
// already correct because it is derived from the package name, which is
// known. Search for REPLACE_ below.
// ─────────────────────────────────────────────────────────────────────

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const SITE = 'https://imbizohub.com';
// Query form, matching what seller.tsx actually reads. See bug 3 above.
const appDeepLink = (id: string) => `imbizohub://seller?id=${encodeURIComponent(id)}`;
// Where someone without the app can still see the profile: the web build.
const webProfileUrl = (id: string) => `${SITE}/app/seller?id=${encodeURIComponent(id)}`;

// There is no Apple Developer account yet, so there is no iOS build and
// no App Store listing. While that is true the "Download for iPhone"
// button is hidden entirely — showing it would send iPhone users to a
// 404 on Apple's site, which reads as a broken product rather than an
// unreleased one. iPhone users still get the "view on the web" link,
// which works fine.
//
// TO ENABLE iOS LATER: set IOS_APP_LIVE to true and replace the
// placeholder id below with the real numeric App Store id.
const IOS_APP_LIVE = false;
const APP_STORE_URL = 'https://apps.apple.com/app/imbizohub/idREPLACE_APP_STORE_ID';
const PLAY_STORE_URL = 'https://play.google.com/store/apps/details?id=com.imbizohub.app';

// Falls back to the site-wide OG image, which genuinely exists at
// web/og-image.png — the previous default-avatar.png never did, so
// avatar-less sellers produced a broken image in the preview card.
const DEFAULT_OG_IMAGE = `${SITE}/og-image.png`;

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Only accept something that actually looks like a profile id. Without
// this, any junk path segment became a database lookup.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function extractId(url: URL): string | null {
  const q = url.searchParams.get('id');
  if (q && UUID_RE.test(q)) return q;

  // Backwards compatibility with /seller/<id> style links.
  const last = url.pathname.split('/').filter(Boolean).pop() ?? '';
  if (last && last !== 'seller-preview' && last !== 'seller' && UUID_RE.test(last)) {
    return last;
  }
  return null;
}

function page(body: string, status = 200): Response {
  return new Response(body, {
    status,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      // Let the scraper and the CDN cache briefly; profile data changes
      // rarely and this endpoint can be hit repeatedly by one share.
      'Cache-Control': 'public, max-age=300, s-maxage=300',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

function shell(title: string, headExtra: string, bodyInner: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<meta name="theme-color" content="#111111">
${headExtra}
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif;
         background:#111; color:#fff; margin:0; padding:48px 20px; text-align:center; line-height:1.6; }
  .card { max-width:420px; margin:0 auto; }
  img.avatar { width:104px; height:104px; border-radius:52px; object-fit:cover; margin-bottom:18px;
               background:#2a2a2a; }
  h1 { font-size:22px; margin:0 0 6px; font-weight:800; }
  .rating { color:#E8B44A; font-size:15px; margin-bottom:8px; }
  .badges { color:#E8B44A; font-size:13px; margin-bottom:26px; }
  .btn { display:block; background:#B8860B; color:#1A1A18; font-weight:800;
         padding:15px 28px; border-radius:12px; text-decoration:none; margin:10px 0; }
  .btn-outline { display:block; border:1.5px solid #2E2E2A; color:#fff; font-weight:700;
                 padding:14px 28px; border-radius:12px; text-decoration:none; margin:10px 0; }
  .muted { color:#A9A9A4; font-size:14px; }
  .brand { color:#A9A9A4; font-size:13px; margin-top:34px; }
  .brand a { color:#E8B44A; text-decoration:none; }
  #fallback { display:none; }
</style>
</head>
<body><div class="card">${bodyInner}</div></body>
</html>`;
}

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const id = extractId(url);

  if (!id) {
    return page(
      shell(
        'Seller not found — ImbizoHub',
        '<meta name="robots" content="noindex">',
        `<h1>Seller not found</h1>
         <p class="muted">This link is missing a valid seller reference.</p>
         <a class="btn" href="${SITE}">Go to ImbizoHub</a>`
      ),
      404
    );
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('full_name, avatar_url, rating, rating_count, dealer_pro_active, dealer_pro_expires_at, is_verified, verified_expires_at')
    .eq('id', id)
    .maybeSingle();

  if (!profile) {
    return page(
      shell(
        'Seller not found — ImbizoHub',
        '<meta name="robots" content="noindex">',
        `<h1>Seller not found</h1>
         <p class="muted">This profile may have been removed.</p>
         <a class="btn" href="${SITE}">Go to ImbizoHub</a>`
      ),
      404
    );
  }

  const name = escapeHtml(profile.full_name || 'ImbizoHub Seller');
  const ratingText =
    profile.rating_count > 0
      ? `${Number(profile.rating).toFixed(1)}★ (${profile.rating_count} review${profile.rating_count === 1 ? '' : 's'}) on ImbizoHub`
      : 'A seller on ImbizoHub';

  const ogImage = escapeHtml(profile.avatar_url || DEFAULT_OG_IMAGE);
  const canonical = `${SITE}/seller?id=${encodeURIComponent(id)}`;
  const deepLink = appDeepLink(id);
  const webUrl = webProfileUrl(id);

  const isDealerPro = !!(
    profile.dealer_pro_active &&
    profile.dealer_pro_expires_at &&
    new Date(profile.dealer_pro_expires_at).getTime() > Date.now()
  );
  const isVerified = !!(
    profile.is_verified &&
    profile.verified_expires_at &&
    new Date(profile.verified_expires_at).getTime() > Date.now()
  );
  const badges = [isDealerPro ? '⭐ Dealer' : null, isVerified ? '✅ Verified' : null]
    .filter(Boolean)
    .join(' · ');

  const head = `
<link rel="canonical" href="${canonical}">
<meta name="description" content="${escapeHtml(ratingText)}">

<meta property="og:type" content="profile">
<meta property="og:site_name" content="ImbizoHub">
<meta property="og:title" content="${name} on ImbizoHub">
<meta property="og:description" content="${escapeHtml(ratingText)}">
<meta property="og:image" content="${ogImage}">
<meta property="og:url" content="${canonical}">

<meta name="twitter:card" content="summary">
<meta name="twitter:title" content="${name} on ImbizoHub">
<meta name="twitter:description" content="${escapeHtml(ratingText)}">
<meta name="twitter:image" content="${ogImage}">`;

  const body = `
  <img class="avatar" src="${ogImage}" alt="${name}">
  <h1>${name}</h1>
  <div class="rating">${escapeHtml(ratingText)}</div>
  ${badges ? `<div class="badges">${badges}</div>` : ''}

  <div id="opening" class="muted"><p>Opening in the ImbizoHub app…</p></div>

  <div id="fallback">
    <a class="btn" href="${webUrl}">View this profile on the web</a>
    <p class="muted">Or get the app:</p>
    <a class="btn-outline" href="${PLAY_STORE_URL}">Download for Android</a>
    ${IOS_APP_LIVE ? `<a class="btn-outline" href="${APP_STORE_URL}">Download for iPhone</a>` : ''}
  </div>

  <div class="brand">Powered by <a href="${SITE}">ImbizoHub</a> · Zimbabwe</div>

  <script>
  (function () {
    var opening = document.getElementById('opening');
    var fallback = document.getElementById('fallback');
    var isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);

    // On desktop a custom-scheme navigation does nothing useful and can
    // raise a browser error dialog, so skip straight to the options.
    if (!isMobile) {
      opening.style.display = 'none';
      fallback.style.display = 'block';
      return;
    }

    // Once Universal Links / App Links are verified, users WITH the app
    // never reach this page at all — the OS intercepts the https link
    // first. This attempt therefore only matters for the window before
    // verification propagates, and as a belt-and-braces fallback.
    var t = setTimeout(function () {
      opening.style.display = 'none';
      fallback.style.display = 'block';
    }, 1500);

    // If the app does open, the page is backgrounded — cancel the
    // fallback so returning to the browser does not show it needlessly.
    document.addEventListener('visibilitychange', function () {
      if (document.hidden) clearTimeout(t);
    });

    window.location.href = ${JSON.stringify(deepLink)};
  })();
  </script>`;

  return page(shell(`${name} — ImbizoHub`, head, body));
});
