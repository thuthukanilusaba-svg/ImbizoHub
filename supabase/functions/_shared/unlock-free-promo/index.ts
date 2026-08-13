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

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';
const PROMO_END = new Date('2027-01-31T23:59:59Z');

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

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

Deno.serve(async (req) => {
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

  if (new Date() > PROMO_END) {
    return new Response(JSON.stringify({ error: 'The free launch promotion has ended. Please use the normal payment flow.' }), { status: 400 });
  }

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
});