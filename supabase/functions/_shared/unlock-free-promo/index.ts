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

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const NOTIFY_SHARED_SECRET = Deno.env.get('NOTIFY_SHARED_SECRET')!;

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

  const providedSecret = req.headers.get('X-Notify-Secret');
  if (!NOTIFY_SHARED_SECRET || providedSecret !== NOTIFY_SHARED_SECRET) {
    console.error('unlock-free-promo: invalid or missing shared secret');
    return new Response('Unauthorized', { status: 401 });
  }

  if (new Date() > PROMO_END) {
    return new Response(JSON.stringify({ error: 'The free launch promotion has ended. Please use the normal payment flow.' }), { status: 400 });
  }

  try {
    const { listing_id, buyer_id, seller_id } = await req.json();
    if (!listing_id || !buyer_id || !seller_id) {
      return new Response(JSON.stringify({ error: 'Missing required fields' }), { status: 400 });
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