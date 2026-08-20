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
//
// ⚠️ FIX (real bug, found during a full-codebase sweep): this checked
// an `X-Notify-Secret` header against NOTIFY_SHARED_SECRET — a
// server-to-server auth mechanism — but is "called directly by
// quotes.tsx", a CLIENT screen, via the standard
// supabase.functions.invoke(), which never sets that header. Every real
// call from the app was therefore rejected with 401 before reaching the
// promo logic below — the "accept a quote free" launch-promo path was
// non-functional. Same wrong pattern copy-pasted into
// unlock-free-promo, accept-response-free-promo, and
// feature-listing-free-promo — all four fixed the same way in this
// pass. Also added: this never verified the caller's identity against
// `buyer_id` — anyone who got past the (broken) secret check could have
// accepted ANY quote for free under ANY buyer_id. Now verifies a real
// JWT and requires buyer_id to match the authenticated caller.

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

// CORS. Without this the browser's preflight OPTIONS request is
// answered 405 and the real POST is never sent — surfacing in the app
// as "Failed to send a request to the Edge Function", which reads like
// a network fault rather than a permissions handshake. Native apps do
// not preflight, so this only ever broke the web build.
//
// Wrapping the handler rather than editing each new Response(...) call:
// missing one would fail identically and be just as hard to find.
// '*' is safe here — authorisation is on the caller's JWT, never on the
// requesting origin, so allowing any origin to ASK grants nothing.
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
    // once constructed, and this preserves status, statusText and body.
    const out = new Response(res.body, res);
    for (const [key, value] of Object.entries(CORS_HEADERS)) out.headers.set(key, value);
    return out;
  };
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

  // Server-side date check — never trust the client's own clock.
  if (new Date() > PROMO_END) {
    return new Response(JSON.stringify({ error: 'The free launch promotion has ended. Please use the normal payment flow.' }), { status: 400 });
  }

  try {
    const { trip_quote_id, buyer_id, seller_id } = await req.json();
    if (!trip_quote_id || !buyer_id || !seller_id) {
      return new Response(JSON.stringify({ error: 'Missing required fields' }), { status: 400 });
    }
    // FIX: buyer_id must be the authenticated caller — see top-of-file
    // comment.
    if (buyer_id !== callerId) {
      return new Response(JSON.stringify({ error: 'buyer_id must match the authenticated user' }), { status: 403 });
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
}));
