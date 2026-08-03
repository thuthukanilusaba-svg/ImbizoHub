// supabase/functions/create-payment/index.ts
//
// Called by the app (unlock.tsx, delivery-operator-register-pay.tsx,
// operator-register-pay.tsx, wanted-responses.tsx, delivery-booking.tsx,
// quotes.tsx, dealer-pro-pay.tsx, feature-listing-pay.tsx,
// verified-seller-pay.tsx) instead of directly inserting "paid" rows.
//
// Normal (live) flow:
//   1. Creates a 'pending' payment_intents row with our own reference
//   2. Signs and sends the Initiate Transaction request to Paynow via
//      our own VPS proxy (see PAYNOW_PROXY_URL below), NOT directly —
//      Paynow's servers reset the connection when called from
//      Supabase's cloud/datacenter IP ranges, confirmed by live
//      testing and Paynow's own support team.
//   3. Returns Paynow's checkout URL (browserurl) to the app. The real
//      payment_intents 'paid' write + DB side effects only ever happen
//      later, when Paynow calls paynow-webhook.
//
// TEST MODE (new): when PAYMENT_TEST_MODE=true, step 2/3 above are
// skipped entirely. Instead, this function calls the exact same
// confirmPaymentIntent() that paynow-webhook uses — synchronously, right
// here — so a "test payment" produces byte-for-byte the same DB writes
// and push notifications a real Paynow payment would (booking rows
// inserted, subscriptions activated, etc.), not just a flipped status
// column. The app is never touched: unlock.tsx and friends still call
// WebBrowser.openBrowserAsync(checkoutUrl) and poll payment_intents
// exactly as before — by the time they do, the payment_intents row is
// already 'paid', so the very first poll succeeds. checkoutUrl in test
// mode points at TEST_CHECKOUT_PAGE_URL, a static "test payment
// complete, you can close this" page — nothing on that page needs to
// call back into Supabase, since confirmation already happened before
// the URL was even returned.
//
// To flip modes:
//   supabase secrets set PAYMENT_TEST_MODE=true
//   supabase secrets set PAYMENT_TEST_MODE=false   (or unset it)
// Also required once, for the fake checkout screen shown in test mode:
//   supabase secrets set TEST_CHECKOUT_PAGE_URL=https://thuthukanilusaba-svg.github.io/imbizohub-legal/test-payment.html
//
// The Integration ID and Key are read from Supabase secrets — NEVER
// hardcode them here or send them to the client. Set them once with:
//   supabase secrets set PAYNOW_INTEGRATION_ID=xxxx
//   supabase secrets set PAYNOW_INTEGRATION_KEY=xxxx
//
// The proxy URL and its shared secret are also read from Supabase
// secrets — set once with:
//   supabase secrets set PAYNOW_PROXY_URL=http://<droplet-ip>:3939/relay
//   supabase secrets set PAYNOW_PROXY_SECRET=xxxx
//
// Request body expected from the app:
// {
//   kind: 'unlock_fee' | 'delivery_operator_registration' | 'transport_operator_registration' | 'wanted_request_match' | 'trip_deposit' | 'dealer_pro_subscription' | 'featured_listing' | 'verified_seller' | 'delivery_booking_fee',
//   amount: number,
//   email: string,               // payer's email, for Paynow's authemail
//   // for kind = 'unlock_fee':
//   listing_id: number,
//   buyer_id: string,
//   seller_id: string,
//   // for kind = 'delivery_operator_registration' OR 'transport_operator_registration':
//   operator_user_id: string,
//   // for kind = 'wanted_request_match':
//   item_request_id: string,
//   item_response_id: string,
//   buyer_id: string,
//   seller_id: string,
//   // for kind = 'delivery_booking_fee':
//   listing_id?: number,          // exactly one of listing_id / item_request_id
//   item_request_id?: string,
//   buyer_id: string,
//   seller_id: string,
//   operator_user_id: string,
//   pickup_city: string,
//   dropoff_city: string,
//   delivery_type: 'local' | 'intercity',
//   delivery_fee: number,         // $5 or $8, cash-on-collection — informational only, not charged here
//   parcel_description?: string,
// }

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { confirmPaymentIntent } from '../_shared/confirm-payment.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const PAYNOW_INTEGRATION_ID = Deno.env.get('PAYNOW_INTEGRATION_ID')!;
const PAYNOW_INTEGRATION_KEY = Deno.env.get('PAYNOW_INTEGRATION_KEY')!;
const FUNCTIONS_BASE_URL = Deno.env.get('FUNCTIONS_BASE_URL')!;

const PAYNOW_PROXY_URL = Deno.env.get('PAYNOW_PROXY_URL')!;
const PAYNOW_PROXY_SECRET = Deno.env.get('PAYNOW_PROXY_SECRET')!;

// Test mode toggle — see comment block above. Only 'true' (lowercase,
// exact) turns it on, so an unset/misspelled secret always fails safe
// into the real Paynow path rather than silently faking payments.
const PAYMENT_TEST_MODE = Deno.env.get('PAYMENT_TEST_MODE') === 'true';
const TEST_CHECKOUT_PAGE_URL = Deno.env.get('TEST_CHECKOUT_PAGE_URL') ?? '';

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const VALID_KINDS = [
  'unlock_fee',
  'delivery_operator_registration',
  'transport_operator_registration',
  'wanted_request_match',
  'trip_deposit',
  'dealer_pro_subscription',
  'featured_listing',
  'verified_seller',
  'delivery_booking_fee',
] as const;
type PaymentKind = typeof VALID_KINDS[number];

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

async function paynowHash(orderedValues: string[], integrationKey: string): Promise<string> {
  const raw = orderedValues.join('') + integrationKey;
  const data = new TextEncoder().encode(raw);
  const digest = await crypto.subtle.digest('SHA-512', data);
  const hex = Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  return hex.toUpperCase();
}

function additionalInfoFor(kind: PaymentKind): string {
  switch (kind) {
    case 'unlock_fee':
      return 'ImbizoHub arrange-deal fee';
    case 'delivery_operator_registration':
      return 'ImbizoHub delivery operator registration';
    case 'transport_operator_registration':
      return 'ImbizoHub transport operator registration';
    case 'wanted_request_match':
      return 'ImbizoHub wanted-post match fee';
    case 'trip_deposit':
      return 'ImbizoHub trip deposit (10%)';
    case 'dealer_pro_subscription':
      return 'ImbizoHub Dealer Pro subscription (30 days)';
    case 'featured_listing':
      return 'ImbizoHub Featured listing (7 days)';
    case 'verified_seller':
      return 'ImbizoHub Verified Seller status (1 year)';
    case 'delivery_booking_fee':
      return 'ImbizoHub delivery booking fee';
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  try {
    const body = await req.json();
    const { kind, amount, email } = body;

    if (!kind || !amount || amount <= 0) {
      return new Response(JSON.stringify({ error: 'Missing or invalid kind/amount' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    if (!VALID_KINDS.includes(kind)) {
      return new Response(JSON.stringify({ error: 'Invalid kind' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const intentRow: Record<string, unknown> = {
      kind,
      amount,
      status: 'pending',
    };

    if (kind === 'unlock_fee') {
      const { listing_id, buyer_id, seller_id } = body;
      if (!listing_id || !buyer_id || !seller_id) {
        return new Response(JSON.stringify({ error: 'Missing listing_id/buyer_id/seller_id' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      intentRow.listing_id = listing_id;
      intentRow.buyer_id = buyer_id;
      intentRow.seller_id = seller_id;
    } else if (kind === 'delivery_operator_registration' || kind === 'transport_operator_registration') {
      const { operator_user_id } = body;
      if (!operator_user_id) {
        return new Response(JSON.stringify({ error: 'Missing operator_user_id' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      intentRow.operator_user_id = operator_user_id;
    } else if (kind === 'wanted_request_match') {
      const { item_request_id, item_response_id, buyer_id, seller_id } = body;
      if (!item_request_id || !item_response_id || !buyer_id || !seller_id) {
        return new Response(JSON.stringify({ error: 'Missing item_request_id/item_response_id/buyer_id/seller_id' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      intentRow.item_request_id = item_request_id;
      intentRow.item_response_id = item_response_id;
      intentRow.buyer_id = buyer_id;
      intentRow.seller_id = seller_id;
    } else if (kind === 'trip_deposit') {
      const { trip_request_id, trip_quote_id, buyer_id, seller_id } = body;
      if (!trip_request_id || !trip_quote_id || !buyer_id || !seller_id) {
        return new Response(JSON.stringify({ error: 'Missing trip_request_id/trip_quote_id/buyer_id/seller_id' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      intentRow.trip_request_id = trip_request_id;
      intentRow.trip_quote_id = trip_quote_id;
      intentRow.buyer_id = buyer_id;
      intentRow.seller_id = seller_id;
    } else if (kind === 'dealer_pro_subscription') {
      const { buyer_id } = body;
      if (!buyer_id) {
        return new Response(JSON.stringify({ error: 'Missing buyer_id' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      intentRow.buyer_id = buyer_id;
    } else if (kind === 'featured_listing') {
      const { listing_id, buyer_id } = body;
      if (!listing_id || !buyer_id) {
        return new Response(JSON.stringify({ error: 'Missing listing_id/buyer_id' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      intentRow.listing_id = listing_id;
      intentRow.buyer_id = buyer_id;
    } else if (kind === 'verified_seller') {
      const { buyer_id } = body;
      if (!buyer_id) {
        return new Response(JSON.stringify({ error: 'Missing buyer_id' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      intentRow.buyer_id = buyer_id;
    } else if (kind === 'delivery_booking_fee') {
      const {
        listing_id, item_request_id, buyer_id, seller_id,
        operator_user_id, pickup_city, dropoff_city, delivery_type,
        delivery_fee, parcel_description,
      } = body;

      const hasListing = !!listing_id;
      const hasWantedMatch = !!item_request_id;
      if (hasListing === hasWantedMatch) {
        return new Response(JSON.stringify({ error: 'Exactly one of listing_id or item_request_id is required' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      if (!buyer_id || !seller_id || !operator_user_id || !pickup_city || !dropoff_city || !delivery_type || !delivery_fee) {
        return new Response(JSON.stringify({ error: 'Missing required delivery booking fields' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      intentRow.listing_id = hasListing ? listing_id : null;
      intentRow.item_request_id = hasWantedMatch ? item_request_id : null;
      intentRow.buyer_id = buyer_id;
      intentRow.seller_id = seller_id;
      intentRow.operator_user_id = operator_user_id;
      intentRow.pickup_city = pickup_city;
      intentRow.dropoff_city = dropoff_city;
      intentRow.delivery_type = delivery_type;
      intentRow.delivery_fee = delivery_fee;
      intentRow.parcel_description = parcel_description ?? null;
    }

    const ourReference = `${kind}-${crypto.randomUUID()}`;
    intentRow.our_reference = ourReference;

    const { error: insertError } = await supabase.from('payment_intents').insert(intentRow);
    if (insertError) {
      console.error('payment_intents insert error:', insertError.message);
      return new Response(JSON.stringify({ error: insertError.message }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // ── TEST MODE: skip Paynow entirely, confirm right here ──
    if (PAYMENT_TEST_MODE) {
      if (!TEST_CHECKOUT_PAGE_URL) {
        console.error('create-payment: PAYMENT_TEST_MODE is on but TEST_CHECKOUT_PAGE_URL is not set');
        await supabase.from('payment_intents').update({ status: 'error' }).eq('our_reference', ourReference);
        return new Response(JSON.stringify({ error: 'Test mode misconfigured — TEST_CHECKOUT_PAGE_URL missing' }), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      const result = await confirmPaymentIntent(supabase, intentRow, {
        // Clearly marked as synthetic so real vs. test payments stay
        // easy to tell apart later in payment_intents / transactions.
        paynowReference: `TEST-${ourReference}`,
        pollUrl: null,
      });

      if (!result.ok) {
        console.error('create-payment (test mode): confirmPaymentIntent failed', result.error);
        return new Response(JSON.stringify({ error: result.error }), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      // payment_intents is already 'paid' by the time this returns, so
      // the app's very first poll succeeds. The URL below just needs to
      // be something WebBrowser.openBrowserAsync can open — no callback
      // to Supabase needed since confirmation already happened above.
      return new Response(
        JSON.stringify({ checkoutUrl: `${TEST_CHECKOUT_PAGE_URL}?ref=${ourReference}`, reference: ourReference }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // ── Live mode: real Paynow flow, unchanged ──
    const returnUrl = `${FUNCTIONS_BASE_URL}/payment-return?ref=${ourReference}`;
    const resultUrl = `${FUNCTIONS_BASE_URL}/paynow-webhook`;

    const amountStr = Number(amount).toFixed(2);
    const additionalInfo = additionalInfoFor(kind as PaymentKind);

    const fields: [string, string][] = [
      ['id', PAYNOW_INTEGRATION_ID],
      ['reference', ourReference],
      ['amount', amountStr],
      ['additionalinfo', additionalInfo],
      ['returnurl', returnUrl],
      ['resulturl', resultUrl],
      ...(email ? [['authemail', email] as [string, string]] : []),
      ['status', 'Message'],
    ];

    const hash = await paynowHash(fields.map(([, v]) => v), PAYNOW_INTEGRATION_KEY);

    const form = new URLSearchParams();
    for (const [k, v] of fields) form.append(k, v);
    form.append('hash', hash);

    const paynowResp = await fetch(PAYNOW_PROXY_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'X-Proxy-Secret': PAYNOW_PROXY_SECRET,
      },
      body: form.toString(),
    });

    const respText = await paynowResp.text();
    const respParams = new URLSearchParams(respText);
    const status = respParams.get('status') || respParams.get('Status');

    if (status?.toLowerCase() !== 'ok') {
      const errorMsg = respParams.get('error') || respParams.get('Error') || 'Unknown Paynow error';
      console.error('Paynow initiate error:', errorMsg, '| full response:', respText);
      await supabase.from('payment_intents').update({ status: 'error' }).eq('our_reference', ourReference);
      return new Response(JSON.stringify({ error: errorMsg }), {
        status: 502,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const browserUrl = respParams.get('browserurl') || respParams.get('BrowserUrl');
    const pollUrl = respParams.get('pollurl') || respParams.get('PollUrl');

    await supabase
      .from('payment_intents')
      .update({ poll_url: pollUrl })
      .eq('our_reference', ourReference);

    return new Response(JSON.stringify({ checkoutUrl: browserUrl, reference: ourReference }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('create-payment error:', err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});