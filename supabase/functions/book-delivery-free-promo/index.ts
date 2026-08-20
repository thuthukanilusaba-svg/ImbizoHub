// supabase/functions/book-delivery-free-promo/index.ts
//
// Launch promotion: the $2 ImbizoHub delivery booking fee is free until
// January 31, 2027 — we don't have a payment method wired up as a
// business yet, so charging this fee isn't the point right now. Mirrors
// confirm-payment.ts's delivery_booking_fee branch exactly (same
// delivery_bookings insert, same columns), just with booking_fee: 0 and
// no Paynow checkout in front of it. The driver's own fee is unaffected
// either way — it's cash-on-collection, never charged through Paynow to
// begin with.
//
// No explicit "new job" notification here on purpose: that's handled
// entirely server-side by the on_delivery_booking_inserted DB trigger,
// which fires on ANY insert into delivery_bookings regardless of how
// the row got there (the real paynow-webhook path or this one) — see
// confirm-payment.ts's matching comment on its own delivery_booking_fee
// branch.
//
// Called directly by delivery-booking.tsx's confirmBooking() during the
// promo window, replacing the normal create-payment + Paynow checkout +
// poll entirely. Same auth pattern as every other *-free-promo function
// built today (accept-quote-free-promo, accept-response-free-promo,
// unlock-free-promo, feature-listing-free-promo): a real JWT is
// required, and buyer_id must match the authenticated caller — never a
// server-to-server shared-secret header, which a client screen calling
// supabase.functions.invoke() can't set anyway.
//
// NEW (lightweight payment-visibility step, built with a future real
// escrow flow in mind — see delivery_item_price_and_payment_status
// migration): now also stores item_price so it's actually visible to
// both parties on delivery-track.tsx/seller-deliveries.tsx, instead of
// being silently dropped the way delivery-booking.tsx used to. This is
// NOT escrow — no money for the item moves through the app here, it's
// purely a visibility/paper-trail improvement. optional: item_request
// wants have no fixed listing price, so this is null for that origin.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const PROMO_END = new Date('2027-01-31T23:59:59Z');

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

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
    const {
      listing_id, item_request_id, buyer_id, seller_id,
      operator_user_id, pickup_city, dropoff_city, delivery_type,
      delivery_fee, parcel_size, parcel_description, scheduled_date,
      item_price,
    } = await req.json();

    // Same "exactly one of listing_id / item_request_id" shape
    // create-payment.ts's delivery_booking_fee branch enforces.
    const hasListing = !!listing_id;
    const hasWantedMatch = !!item_request_id;
    if (hasListing === hasWantedMatch) {
      return new Response(JSON.stringify({ error: 'Exactly one of listing_id or item_request_id is required' }), { status: 400 });
    }
    if (!buyer_id || !seller_id || !operator_user_id || !pickup_city || !dropoff_city || !delivery_type || !delivery_fee) {
      return new Response(JSON.stringify({ error: 'Missing required delivery booking fields' }), { status: 400 });
    }
    // buyer_id must be the authenticated caller — same ownership check
    // every other free-promo function makes.
    if (buyer_id !== callerId) {
      return new Response(JSON.stringify({ error: 'buyer_id must match the authenticated user' }), { status: 403 });
    }

    const { error: bookingError } = await supabase
      .from('delivery_bookings')
      .insert({
        listing_id: hasListing ? listing_id : null,
        item_request_id: hasWantedMatch ? item_request_id : null,
        buyer_id,
        seller_id,
        operator_id: operator_user_id,
        pickup_city,
        dropoff_city,
        delivery_type,
        delivery_fee,
        booking_fee: 0,
        parcel_description: parcel_description ?? null,
        parcel_size: parcel_size ?? null,
        scheduled_date: scheduled_date ?? null,
        status: 'requested',
        // NEW: see top-of-file comment — lightweight visibility only,
        // not escrow. typeof-checked rather than a plain ?? null so a
        // caller-supplied 0 (theoretically a free item) isn't dropped.
        item_price: typeof item_price === 'number' ? item_price : null,
      });

    if (bookingError) {
      console.error('book-delivery-free-promo: delivery_bookings insert failed', bookingError.message);
      return new Response(JSON.stringify({ error: 'DB error' }), { status: 500 });
    }

    // No transactions row here — confirm-payment.ts's own
    // delivery_booking_fee branch doesn't insert one either (unlike its
    // verified_seller/wanted_request_match branches), so this stays a
    // faithful mirror rather than introducing a write the real paid
    // path never makes for this kind.

    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('book-delivery-free-promo error:', err);
    return new Response(JSON.stringify({ error: 'Server error' }), { status: 500 });
  }
}));
