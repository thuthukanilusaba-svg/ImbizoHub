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
// Google's official badge, served from the marketing site. The web badge
// carries a white outline inside the artwork, which is why it still reads
// on this page's near-black background. Never restyle it — Google's brand
// guidelines forbid recolouring, cropping or rebuilding it, and the
// trademark line below is required wherever it appears.
const PLAY_BADGE_URL = `${SITE}/GetItOnGooglePlay_Badge_Web_color_English.svg`;

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

// Initials shown in place of a photo for sellers who have not set an
// avatar. Previously these sellers fell back to the site-wide OG banner
// (1200x630) rendered into a 104px circle, which came out as a squashed
// strip of the landing-page artwork.
//
// NOTE: the app contains two different initials implementations —
// seller.tsx's initials() renders a one-word name as a single letter
// ("Masha" -> "M"), while chat.tsx's getInitials() takes two ("MA").
// This follows chat.tsx's version, which reads better in a large
// circle. Worth unifying them in the app at some point; they should not
// disagree.
function initialsFor(fullName: string): string {
  const name = (fullName || '').trim();
  if (!name) return '?';
  const parts = name.split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return parts
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
}

// Only accept something that actually looks like a profile id. Without
// this, any junk path segment became a database lookup.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Mirrors the CHECK constraint on profiles.slug exactly (migration
// add_profile_slug_for_shop_links): lowercase letters, digits and
// hyphens, 3-30 characters, never starting or ending with a hyphen.
// Kept in sync BY HAND. If the constraint is ever relaxed and this is
// not, the newly-valid slugs save fine and 404 here — the failure shows
// up only on the shared link, which is the one place nobody tests.
const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,28}[a-z0-9]$/;

type Lookup = { by: 'id' | 'slug'; value: string };

// A profile can be addressed two ways and they are NOT interchangeable
// to the caller: the uuid form is what the app shares, the slug form is
// what a Dealer Pro hands out on a flyer. Both resolve to one page.
//
// Slug wins when both are present. A link carrying both is a link that
// was built wrong, and silently preferring the uuid would make the
// dealer's own short link render somebody else's shop.
function extractLookup(url: URL): Lookup | null {
  const slugParam = (url.searchParams.get('slug') ?? '').trim().toLowerCase();
  if (slugParam && SLUG_RE.test(slugParam)) return { by: 'slug', value: slugParam };

  const q = url.searchParams.get('id');
  if (q && UUID_RE.test(q)) return { by: 'id', value: q };

  // Path forms: /s/<slug> for short links, /seller/<id> for older ones.
  const parts = url.pathname.split('/').filter(Boolean);
  const last = parts[parts.length - 1] ?? '';
  const prev = parts[parts.length - 2] ?? '';
  if (prev === 's' && SLUG_RE.test(last.toLowerCase())) {
    return { by: 'slug', value: last.toLowerCase() };
  }
  if (last && last !== 'seller-preview' && last !== 'seller' && UUID_RE.test(last)) {
    return { by: 'id', value: last };
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
  .avatar-initials { width:104px; height:104px; border-radius:52px; background:#B8860B;
                     color:#1A1A18; font-size:38px; font-weight:800; line-height:104px;
                     margin:0 auto 18px; }
  h1 { font-size:22px; margin:0 0 6px; font-weight:800; }
  .rating { color:#E8B44A; font-size:15px; margin-bottom:8px; }
  .badges { color:#E8B44A; font-size:13px; margin-bottom:26px; }
  .btn { display:block; background:#B8860B; color:#1A1A18; font-weight:800;
         padding:15px 28px; border-radius:12px; text-decoration:none; margin:10px 0; }
  .badge-link { display:block; line-height:0; margin:10px 0; }
  .badge-img { height:52px; width:auto; display:inline-block; }
  .trademark { color:#6F6F6A; font-size:11.5px; margin-top:18px; line-height:1.5; }
  .btn-outline { display:block; border:1.5px solid #2E2E2A; color:#fff; font-weight:700;
                 padding:14px 28px; border-radius:12px; text-decoration:none; margin:10px 0; }
  .muted { color:#A9A9A4; font-size:14px; }
  .brand { color:#A9A9A4; font-size:13px; margin-top:34px; }
  .brand a { color:#E8B44A; text-decoration:none; }
  #fallback { display:none; }

  /* ---- Storefront catalogue ----
     Left-aligned inside a centred card: prices and titles in a grid read
     as a shop when they line up and as a poster when they do not. */
  .cat-head { display:flex; align-items:baseline; justify-content:space-between;
              text-align:left; margin:30px 0 12px; padding-top:22px;
              border-top:1px solid #2E2E2A; }
  .cat-title { font-size:13px; font-weight:800; letter-spacing:.06em;
               text-transform:uppercase; color:#A9A9A4; }
  .cat-count { font-size:12px; color:#A9A9A4; }
  .grid { display:grid; grid-template-columns:1fr 1fr; gap:10px; text-align:left; }
  .item { background:#1A1A18; border:1px solid #2a2a2a; border-radius:12px;
          overflow:hidden; text-decoration:none; color:inherit; display:block; }
  .thumb { aspect-ratio:1/1; background:#232320; display:block;
           width:100%; object-fit:cover; }
  .thumb-empty { aspect-ratio:1/1; background:linear-gradient(140deg,#2a2a28,#1f1f1d);
                 display:grid; place-items:center; color:#5d5d57; font-size:26px; }
  .item-body { padding:9px 10px 11px; }
  .item-title { font-size:12.5px; font-weight:700; margin:0 0 3px;
                white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
  .item-price { font-size:13px; font-weight:800; color:#E8B44A; margin:0; }
  .more { display:block; margin-top:12px; text-align:center; color:#A9A9A4;
          font-size:12.5px; text-decoration:none; padding:11px;
          border:1px solid #2E2E2A; border-radius:10px; }
</style>
</head>
<body><div class="card">${bodyInner}</div></body>
</html>`;
}

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const lookup = extractLookup(url);

  if (!lookup) {
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
    .select('id, slug, full_name, avatar_url, rating, rating_count, dealer_pro_active, dealer_pro_expires_at, is_verified, verified_expires_at, operator_status, vehicle_type, carries, registration_expires_at')
    .eq(lookup.by, lookup.value)
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

  // From here down everything keys off the REAL id — the listings query,
  // the deep link, the web fallback. On a slug lookup the value we were
  // given is not an id, and using it anywhere below returns an empty
  // shop for a profile that plainly exists. Resolve it once, here.
  const id: string = profile.id as string;
  const slug: string | null = (profile.slug as string | null) ?? null;

  // The catalogue. THIS is what makes the page worth sharing — without
  // it the link is a business card, and nobody forwards a business card.
  //
  // Only 'active' rows: a shopfront showing sold and removed stock
  // advertises things the visitor cannot buy.
  //
  // count:'exact' with a small limit so the header can say "24 items"
  // while the grid renders 6. Fetching all 24 to count them would make a
  // dealer with 300 listings pay for a 300-row query on every share.
  const CATALOGUE_PREVIEW = 6;
  const { data: listings, count: listingCount } = await supabase
    .from('listings')
    .select('id, title, price, image_url', { count: 'exact' })
    .eq('user_id', id)
    .eq('status', 'active')
    .order('created_at', { ascending: false })
    .limit(CATALOGUE_PREVIEW);

  const items = listings ?? [];
  const totalItems = listingCount ?? items.length;

  const name = escapeHtml(profile.full_name || 'ImbizoHub Seller');
  const ratingText =
    profile.rating_count > 0
      ? `${Number(profile.rating).toFixed(1)}★ (${profile.rating_count} review${profile.rating_count === 1 ? '' : 's'}) on ImbizoHub`
      : 'A seller on ImbizoHub';

  // What WhatsApp and Facebook show under the link. The item count goes
  // FIRST because it is the only part that says there is something to
  // look at — "4.8★ (23 reviews)" describes a person, "24 items for
  // sale" describes a shop.
  const shareText = totalItems > 0
    ? `${totalItems} item${totalItems === 1 ? '' : 's'} for sale · ${ratingText}`
    : ratingText;

  // og:image still falls back to the site banner — that IS the right
  // image for a WhatsApp card. Only the on-page avatar differs, because
  // a 1200x630 banner in a 104px circle looks broken.
  const hasAvatar = !!profile.avatar_url;
  const ogImage = escapeHtml(profile.avatar_url || DEFAULT_OG_IMAGE);
  const avatarBlock = hasAvatar
    ? `<img class="avatar" src="${ogImage}" alt="${name}">`
    : `<div class="avatar-initials">${escapeHtml(initialsFor(profile.full_name))}</div>`;
  // Prefer the short link when the seller has claimed one. It is the URL
  // they actually hand out, and a canonical that disagrees with the
  // shared address splits the preview card's cache across two URLs —
  // WhatsApp then shows a stale card for one of them.
  const canonical = slug
    ? `${SITE}/s/${slug}`
    : `${SITE}/seller?id=${encodeURIComponent(id)}`;
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
  // TRANSPORT operator, not delivery operator — two different things, and
  // only one of them is open. Book & Deliver is paused
  // (DELIVERY_BOOKING_ENABLED is false and delivery_operators holds zero
  // rows), so a "delivery" badge would advertise a closed feature. The
  // hirevan flow — requests and quotes — is live, and these six profiles
  // are the people bidding on it.
  //
  // Registration is checked the same way the app checks it: status alone
  // is not enough, the registration must not have expired. Everyone is
  // currently on a free registration running to 31 Jan 2027 under the
  // launch promotion, so registration_paid is deliberately NOT part of
  // the test — it is false for every real operator.
  const isOperator = !!(
    profile.operator_status === 'active' &&
    profile.registration_expires_at &&
    new Date(profile.registration_expires_at).getTime() > Date.now()
  );
  // The vehicle says more than the label does: "Van" or "3-tonne truck"
  // tells someone whether this operator can move what they need moving.
  const operatorBadge = isOperator
    ? `🚐 ${escapeHtml(profile.vehicle_type || 'Transport operator')}`
    : null;

  const badges = [operatorBadge, isDealerPro ? '⭐ Dealer' : null, isVerified ? '✅ Verified' : null]
    .filter(Boolean)
    .join(' · ');

  // Whole dollars when whole, two places otherwise — matching
  // lib/money.ts so the same item does not read $85 here and $85.00 in
  // the app.
  const priceText = (v: unknown) => {
    const n = Number(v);
    if (!isFinite(n)) return '';
    return '$' + (Number.isInteger(n) ? String(n) : n.toFixed(2));
  };

  const catalogue = items.length === 0 ? '' : `
  <div class="cat-head">
    <span class="cat-title">Catalogue</span>
    <span class="cat-count">${totalItems} item${totalItems === 1 ? '' : 's'}</span>
  </div>
  <div class="grid">
    ${items.map((it: any) => `
    <a class="item" href="${webUrl}">
      ${it.image_url
        ? `<img class="thumb" src="${escapeHtml(it.image_url)}" alt="${escapeHtml(it.title || '')}" loading="lazy">`
        : `<div class="thumb-empty">\u{1F4E6}</div>`}
      <div class="item-body">
        <p class="item-title">${escapeHtml(it.title || 'Item')}</p>
        <p class="item-price">${priceText(it.price)}</p>
      </div>
    </a>`).join('')}
  </div>
  ${totalItems > items.length
    ? `<a class="more" href="${webUrl}">See all ${totalItems} items \u2192</a>`
    : ''}`;

  const head = `
<link rel="canonical" href="${canonical}">
<meta name="description" content="${escapeHtml(shareText)}">

<meta property="og:type" content="profile">
<meta property="og:site_name" content="ImbizoHub">
<meta property="og:title" content="${name} on ImbizoHub">
<meta property="og:description" content="${escapeHtml(shareText)}">
<meta property="og:image" content="${ogImage}">
<meta property="og:url" content="${canonical}">

<meta name="twitter:card" content="summary">
<meta name="twitter:title" content="${name} on ImbizoHub">
<meta name="twitter:description" content="${escapeHtml(shareText)}">
<meta name="twitter:image" content="${ogImage}">`;

  const body = `
  ${avatarBlock}
  <h1>${name}</h1>
  <div class="rating">${escapeHtml(ratingText)}</div>
  ${badges ? `<div class="badges">${badges}</div>` : ''}

  ${catalogue}

  <!-- ABOVE the app prompt deliberately. That prompt hides itself for
       1.5s while it tries to deep-link, and someone arriving from a
       dealer's WhatsApp status should be looking at stock in that time,
       not a spinner. -->
  <div id="opening" class="muted"><p>Opening in the ImbizoHub app…</p></div>

  <div id="fallback">
    <a class="btn" href="${webUrl}">View this profile on the web</a>
    <p class="muted">Or get the app:</p>
    <a class="badge-link" href="${PLAY_STORE_URL}" aria-label="Get ImbizoHub on Google Play">
      <img class="badge-img" src="${PLAY_BADGE_URL}" alt="Get it on Google Play">
    </a>
    ${IOS_APP_LIVE ? `<a class="btn-outline" href="${APP_STORE_URL}">Download for iPhone</a>` : ''}
  </div>

  <div class="brand">Powered by <a href="${SITE}">ImbizoHub</a></div>
  <div class="trademark">Google Play and the Google Play logo are trademarks of Google LLC.</div>

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
