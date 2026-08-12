// supabase/functions/accept-quote-free-promo/index.ts
//
// Launch promotion: accepting a van-hire quote is free until January
// 31, 2027 — no commitment fee, no Paynow checkout. This deliberately
// mirrors confirm-payment.ts's trip_deposit branch AS CLOSELY AS
// POSSIBLE rather than approximating it, since accepting a quote isn't
// just "mark one row paid" — it also declines every other quote on the
// same trip request and marks the request filled. Missing either of
// those would leave the request in a broken state (e.g. still showing
// as open to other operators after someone's already won it).
//
// Built as its own Edge Function rather than a plain Postgres RPC
// because the real trip_deposit branch sends real push notifications
// (to the winning operator, and to every operator who lost this trip)
// via Expo's push API — an outbound HTTP call a plain SQL function
// can't make directly. This function makes the exact same two
// notification calls, just with its own small inline copies of the
// helpers rather than modifying confirm-payment.ts's shared file,
// which stays completely untouched by this promo.
//
// Called directly by quotes.tsx during the promo window, replacing
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

// Same two notification helpers as confirm-payment.ts's trip_deposit
// branch, inlined here rather than imported — keeps this promo-only
// function fully self-contained and means the shared payment file
// stays completely untouched.
async function notifyTripDepositPaid(operatorId: string, requestId: string) {
  try {
    const { data: operatorProfile } = await supabase
      .from('profiles').select('push_token').eq('id', operatorId).maybeSingle();
    if (!operatorProfile?.push_token) return;

    let routeLabel = 'a trip';
    const { data: request } = await supabase
      .from('requests').select('pickup, destination').eq('id', requestId).maybeSingle();
    if (request?.pickup && request?.destination) routeLabel = `${request.pickup} → ${request.destination}`;

    await sendExpoPushNotification(
      operatorProfile.push_token,
      'Your quote was accepted! 🚐',
      `The customer accepted your quote for "${routeLabel}" (free launch promo — no fee). Contact details are now visible in your dashboard.`,
      { type: 'trip_deposit', request_id: requestId }
    );
  } catch (err) {
    console.error('accept-quote-free-promo: notifyTripDepositPaid failed', err);
  }
}

async function notifyQuotesDeclined(operatorIds: string[], requestId: string) {
  if (operatorIds.length === 0) return;
  try {
    let routeLabel = 'a trip';
    const { data: request } = await supabase
      .from('requests').select('pickup, destination').eq('id', requestId).maybeSingle();
    if (request?.pickup && request?.destination) routeLabel = `${request.pickup} → ${request.destination}`;

    const { data: profiles } = await supabase
      .from('profiles').select('id, push_token').in('id', operatorIds);

    await Promise.all(
      (profiles ?? []).map((p) =>
        sendExpoPushNotification(
          p.push_token,
          'Quote not selected',
          `The customer chose a different operator for "${routeLabel}". Keep an eye out for new trip requests.`,
          { type: 'quote_declined', request_id: requestId }
        )
      )
    );
  } catch (err) {
    console.error('accept-quote-free-promo: notifyQuotesDeclined failed', err);
  }
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  const providedSecret = req.headers.get('X-Notify-Secret');
  if (!NOTIFY_SHARED_SECRET || providedSecret !== NOTIFY_SHARED_SECRET) {
    console.error('accept-quote-free-promo: invalid or missing shared secret');
    return new Response('Unauthorized', { status: 401 });
  }

  // Server-side date check — never trust the client's own clock.
  if (new Date() > PROMO_END) {
    return new Response(JSON.stringify({ error: 'The free launch promotion has ended. Please use the normal payment flow.' }), { status: 400 });
  }

  try {
    const { trip_quote_id, buyer_id, seller_id } = await req.json();
    if (!trip_quote_id || !buyer_id || !seller_id) {
      return new Response(JSON.stringify({ error: 'Missing required fields' }), { status: 400 });
    }

    const { data: quote, error: quoteFetchError } = await supabase
      .from('quotes')
      .select('id, request_id, price')
      .eq('id', trip_quote_id)
      .maybeSingle();

    if (quoteFetchError || !quote) {
      console.error('accept-quote-free-promo: quote not found', trip_quote_id);
      return new Response(JSON.stringify({ error: 'Quote not found' }), { status: 404 });
    }

    // Mirrors trip_deposit exactly, with depositAmount forced to 0 —
    // balance is the full quoted price, since nothing was collected
    // upfront during the promo.
    const depositAmount = 0;
    const balanceAmount = quote.price;

    const { error: quoteUpdateError } = await supabase
      .from('quotes')
      .update({
        status: 'accepted',
        deposit_paid: true,
        deposit_paid_at: new Date().toISOString(),
        deposit_amount: depositAmount,
        balance_amount: balanceAmount,
      })
      .eq('id', quote.id);

    if (quoteUpdateError) {
      console.error('accept-quote-free-promo: quotes update failed', quoteUpdateError.message);
      return new Response(JSON.stringify({ error: 'DB error' }), { status: 500 });
    }

    const { data: declinedQuotes } = await supabase
      .from('quotes')
      .update({ status: 'declined' })
      .eq('request_id', quote.request_id)
      .neq('id', quote.id)
      .select('operator_id');

    const { error: requestUpdateError } = await supabase
      .from('requests')
      .update({ status: 'filled' })
      .eq('id', quote.request_id);

    if (requestUpdateError) {
      console.error('accept-quote-free-promo: requests update failed', requestUpdateError.message);
      return new Response(JSON.stringify({ error: 'DB error' }), { status: 500 });
    }

    await supabase.from('transactions').insert({
      user_id: buyer_id,
      type: 'deposit',
      amount: 0,
      reference_id: quote.id,
      status: 'completed',
      notes: `Commitment fee waived — free launch promotion (through Jan 31, 2027)`,
    });

    await notifyTripDepositPaid(seller_id, quote.request_id);

    const declinedOperatorIds = (declinedQuotes ?? []).map((q) => q.operator_id);
    await notifyQuotesDeclined(declinedOperatorIds, quote.request_id);

    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('accept-quote-free-promo error:', err);
    return new Response(JSON.stringify({ error: 'Server error' }), { status: 500 });
  }
});