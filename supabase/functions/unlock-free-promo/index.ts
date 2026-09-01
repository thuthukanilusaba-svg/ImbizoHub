// supabase/functions/unlock-free-promo/index.ts
//
// Launch promotion: the listing unlock fee is free until January 31,
// 2027. Mirrors confirm-payment.ts's unlock_fee branch exactly — a
// listing_deposits row with status='paid', amount=0, plus the same
// seller notification a real payment would trigger. Deliberately kept
// completely separate from the existing claim_free_unlock RPC, which
// is a different rule entirely (a fixed allowance of free unlocks per
// buyer, not a date-bound promotion) — conflating the two would risk
// this promo silently eating into that unrelated allowance, or vice
// versa.
//
// Built as an Edge Function rather than a plain RPC for the same
// reason as accept-quote-free-promo: the real branch sends a push
// notification via Expo's API, which a plain SQL function can't do
// directly.
//
// Called directly by unlock.tsx during the promo window, replacing
// the normal create-payment + Paynow checkout entirely.
//
// ⚠️ FIX (real bug, found during a full-codebase sweep): this checked
// an `X-Notify-Secret` header against NOTIFY_SHARED_SECRET — a
// server-to-server auth mechanism — but is "called directly by
// unlock.tsx", a CLIENT screen, via the standard
// supabase.functions.invoke(), which never sets that header (it sends
// the user's own session JWT automatically instead). Every real call
// from the app was therefore rejected with 401 before ever reaching the
// promo logic below — the entire "free unlock during launch promo"
// feature was non-functional. The same wrong pattern was copy-pasted
// into accept-quote-free-promo, accept-response-free-promo, and
// feature-listing-free-promo — all four are fixed the same way in this
// pass. Also added: none of these functions previously verified the
// caller's identity against the `buyer_id` they claimed to be — anyone
// who got past the (broken) secret check could have unlocked ANY
// listing for free under ANY buyer_id. Now verifies a real JWT and
// requires buyer_id to match the authenticated caller.
//
// ⚠️ FIX (CORS — real bug, reproduced from the edge logs):
//   OPTIONS | 405 | .../functions/v1/unlock-free-promo
// A browser will not send a cross-origin POST carrying an
// Authorization header until a preflight OPTIONS request succeeds.
// This function answered that preflight with 405, so the browser never
// sent the POST at all and supabase-js reported "Failed to send a
// request to the Edge Function" — an error that sounds like a network
// outage but is actually the browser refusing to proceed.
//
// This was invisible on Android because native apps do not perform
// CORS preflights; it only ever affected the web build.
//
// Fixed with withCors() below rather than by editing each of the ten
// `new Response(...)` calls: a missed one would fail exactly the same
// way and be just as hard to spot. create-payment already carried the
// equivalent header block, which is why payments worked on web while
// every free-promo path did not.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';
// PERMANENT (product decision, 1 Sep 2026): buying on a LISTING is free
// for good — chatting and arranging a deal cost the buyer nothing, and
// that does not expire. The date guard below is therefore gone.
//
// This function keeps its name so no deploy, config.toml entry or client
// call site has to change; only its meaning has. It is no longer a
// promotion, it is the only unlock path there is.
//
// NOTE this is LISTINGS ONLY. The Wanted-post match commission
// (accept-response-free-promo) is unchanged and still ends on
// 2027-01-31 — that one is the business's main revenue line. Do not
// "tidy" the two into one rule; they are deliberately different now.

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// Matches create-payment's existing header block exactly, so every
// client-callable function in this project answers preflights the same
// way. '*' is safe here: the function authorises on the caller's JWT,
// never on the requesting origin, so allowing any origin to ASK grants
// nothing — an unauthenticated caller still gets 401.
const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function withCors(handler: (req: Request) => Promise<Response>) {
  return async (req: Request): Promise<Response> => {
    if (req.method === 'OPTIONS') {
      return new Response('ok', { headers: CORS_HEADERS });
    }
    const res = await handler(req);
    // Re-wrap rather than mutate: a Response's headers are immutable
    // once constructed, and this preserves status, statusText and body
    // exactly as the handler produced them.
    const out = new Response(res.body, res);
    for (const [key, value] of Object.entries(CORS_HEADERS)) out.headers.set(key, value);
    return out;
  };
}

async function sendExpoPushNotification(
  pushToken: string | null | undefined,
  title: string,
  body: string,
  data?: Record<string, unknown>
) {
  if (!pushToken || !pushToken.startsWith('ExponentPushToken')) return;
  try {
    const resp = await fetch(EXPO_PUSH_URL, {
      method: 'POST',
      headers: { Accept: 'application/json', 'Accept-Encoding': 'gzip, deflate', 'Content-Type': 'application/json' },
      body: JSON.stringify({ to: pushToken, sound: 'default', title, body, data: data ?? {} }),
    });
    const result = await resp.json().catch(() => null);
    if (result?.data?.status === 'error') {
      console.error('Expo push send error:', result.data.message, result.data.details);
    }
  } catch (err) {
    console.error('sendExpoPushNotification failed:', err);
  }
}

// Same helper as confirm-payment.ts's notifyUnlockFeeReceived,
// inlined here rather than imported — keeps this promo-only function
// fully self-contained, shared payment file stays untouched.
async function notifyUnlockFeeReceived(sellerId: string, listingId: number) {
  try {
    const { data: sellerProfile } = await supabase
      .from('profiles').select('push_token').eq('id', sellerId).maybeSingle();
    if (!sellerProfile?.push_token) return;

    let listingTitle = 'your listing';
    const { data: listing } = await supabase
      .from('listings').select('title').eq('id', listingId).maybeSingle();
    if (listing?.title) listingTitle = listing.title;

    await sendExpoPushNotification(
      sellerProfile.push_token,
      'New buyer unlocked your chat 🔓',
      `Someone unlocked your listing "${listingTitle}" (free launch promo). Reply now.`,
      { type: 'unlock', listing_id: String(listingId) }
    );
  } catch (err) {
    console.error('unlock-free-promo: notifyUnlockFeeReceived failed', err);
  }
}

Deno.serve(withCors(async (req) => {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  // FIX: real caller identity check — see top-of-file comment.
  const authHeader = req.headers.get('Authorization') ?? '';
  const callerToken = authHeader.replace(/^Bearer\s+/i, '');
  if (!callerToken) return new Response('Unauthorized', { status: 401 });
  const { data: callerData, error: callerError } = await supabase.auth.getUser(callerToken);
  if (callerError || !callerData?.user || callerData.user.is_anonymous) {
    return new Response('Unauthorized', { status: 401 });
  }
  const callerId = callerData.user.id;

  try {
    const { listing_id, buyer_id, seller_id } = await req.json();
    if (!listing_id || !buyer_id || !seller_id) {
      return new Response(JSON.stringify({ error: 'Missing required fields' }), { status: 400 });
    }
    // FIX: buyer_id must be the authenticated caller — see top-of-file
    // comment.
    if (buyer_id !== callerId) {
      return new Response(JSON.stringify({ error: 'buyer_id must match the authenticated user' }), { status: 403 });
    }

    // Same duplicate-guard the real flow already relies on elsewhere —
    // don't insert a second paid deposit row if one already exists for
    // this buyer/listing pair.
    const { data: existing } = await supabase
      .from('listing_deposits')
      .select('id')
      .eq('listing_id', listing_id)
      .eq('buyer_id', buyer_id)
      .eq('status', 'paid')
      .maybeSingle();

    if (existing) {
      return new Response(JSON.stringify({ ok: true, already_unlocked: true }), { status: 200 });
    }

    const { error: depositError } = await supabase.from('listing_deposits').insert({
      listing_id,
      buyer_id,
      seller_id,
      amount: 0,
      status: 'paid',
    });

    if (depositError) {
      console.error('unlock-free-promo: listing_deposits insert failed', depositError.message);
      return new Response(JSON.stringify({ error: 'DB error' }), { status: 500 });
    }

    await notifyUnlockFeeReceived(seller_id, listing_id);

    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('unlock-free-promo error:', err);
    return new Response(JSON.stringify({ error: 'Server error' }), { status: 500 });
  }
}));
