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
// TEST MODE: when PAYMENT_TEST_MODE=true, step 2/3 above are skipped
// entirely. Instead, this function calls the exact same
// confirmPaymentIntent() that paynow-webhook uses — synchronously,
// right here — so a "test payment" produces byte-for-byte the same DB
// writes and push notifications a real Paynow payment would.
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
// ⚠️ SECURITY FIX (found during a full-codebase sweep, most critical
// finding of the sweep): this function had NO authentication check at
// all (config.toml has verify_jwt = false, and the code never called
// supabase.auth.getUser() or looked at the Authorization header), and
// NO server-side validation that `amount` actually matched the correct
// price for the claimed `kind` — confirmPaymentIntent() trusts
// intent.amount completely, for every single payment kind. Together
// this meant literally anyone with the project's public API URL (no
// login required) could POST directly to this function with an
// arbitrary low `amount` and a `buyer_id`/`operator_user_id` of their
// choosing, and receive back a genuinely valid Paynow checkout link —
// e.g. requesting kind: 'verified_seller' with amount: 0.01 instead of
// the real $15 would, once actually paid via that link, grant full
// Verified Seller status for a cent once the webhook confirms it,
// since nothing anywhere re-derives or re-checks the correct price.
// The same gap let a caller attribute a payment to ANY buyer_id/
// operator_user_id, not just their own account.
//
// Now: requires a real (non-anonymous) authenticated user via the
// Authorization header, requires the identity-bound field in the body
// (buyer_id / operator_user_id, whichever applies for that kind) to
// match the authenticated caller, and re-derives/validates the correct
// price server-side for every kind before ever generating a Paynow
// checkout — flat fees are compared directly; percentage/capped fees
// (unlock_fee, wanted_request_match, trip_deposit) are recomputed here
// from the real listing/response/quote row, not trusted from the
// client. config.toml's verify_jwt for this function should also be
// flipped to true — kept as `false` there only because this in-function
// check is a stricter superset (it also validates identity match, which
// platform-level JWT verification alone would not), so redeploying with
// this file change alone already closes the hole even before that
// config change ships.
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
//   delivery_fee: number,         // cash-on-collection — informational only, not charged here
//   parcel_size: 'small' | 'large',  // NEW — drives the $8/$12/$15 rate delivery-booking.tsx computed
//   parcel_description?: string,
//   scheduled_date?: string,
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
      return 'ImbizoHub trip deposit';
    case 'dealer_pro_subscription':
      return 'ImbizoHub Dealer Pro subscription';
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
    // FIX: see top-of-file comment — verify the caller is a real,
    // non-anonymous, logged-in user before doing anything else. Passing
    // the token explicitly to getUser() validates THIS specific bearer
    // token against GoTrue regardless of the client's own configured
    // key, the standard pattern for edge functions that need to
    // identify their caller.
    const authHeader = req.headers.get('Authorization') ?? '';
    const callerToken = authHeader.replace(/^Bearer\s+/i, '');
    if (!callerToken) {
      return new Response(JSON.stringify({ error: 'Not authenticated' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    const { data: callerData, error: callerError } = await supabase.auth.getUser(callerToken);
    if (callerError || !callerData?.user || callerData.user.is_anonymous) {
      return new Response(JSON.stringify({ error: 'Not authenticated' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    const callerId = callerData.user.id;

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

    // FIX: identity-bound fields must match the authenticated caller —
    // otherwise anyone could attribute a payment's benefit to someone
    // else's account (or pay for a registration under a different
    // operator's identity). Checked per-kind below once each field is
    // destructured; this covers buyer_id (all kinds that have one) and
    // operator_user_id (registration kinds).
    function requireOwn(id: unknown, label: string): Response | null {
      if (id !== callerId) {
        return new Response(JSON.stringify({ error: `${label} must match the authenticated user` }), {
          status: 403,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      return null;
    }

    // FIX: server-side price validation — see top-of-file comment.
    // Recomputes or looks up the correct price for the claimed kind and
    // rejects if the client-supplied `amount` doesn't match, instead of
    // trusting it outright. A small epsilon absorbs floating-point
    // rounding, not meaningful under/over-payment.
    async function validateAmount(expected: number, label: string): Promise<Response | null> {
      if (Math.abs(Number(amount) - expected) > 0.01) {
        return new Response(JSON.stringify({ error: `Incorrect amount for ${label}` }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      return null;
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
      const ownErr = requireOwn(buyer_id, 'buyer_id');
      if (ownErr) return ownErr;

      // FIX: recomputes the real fee from the listing's actual price —
      // 5%, min $1.50, max $15, same formula as unlock.tsx — instead of
      // trusting the client's `amount`. See top-of-file comment.
      const { data: listingRow } = await supabase.from('listings').select('price').eq('id', listing_id).maybeSingle();
      if (!listingRow) {
        return new Response(JSON.stringify({ error: 'Listing not found' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      const expectedUnlockFee = Math.max(Math.min(listingRow.price * 0.05, 15), 1.5);
      const amountErr = await validateAmount(parseFloat(expectedUnlockFee.toFixed(2)), 'unlock fee');
      if (amountErr) return amountErr;

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
      const ownErr = requireOwn(operator_user_id, 'operator_user_id');
      if (ownErr) return ownErr;

      // FIX: flat $10 registration fee, same constant (REG_FEE) both
      // registration screens use client-side.
      const amountErr = await validateAmount(10, 'operator registration fee');
      if (amountErr) return amountErr;

      intentRow.operator_user_id = operator_user_id;
    } else if (kind === 'wanted_request_match') {
      const { item_request_id, item_response_id, buyer_id, seller_id } = body;
      if (!item_request_id || !item_response_id || !buyer_id || !seller_id) {
        return new Response(JSON.stringify({ error: 'Missing item_request_id/item_response_id/buyer_id/seller_id' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      const ownErr = requireOwn(buyer_id, 'buyer_id');
      if (ownErr) return ownErr;

      // FIX: recomputes the real 5% commission from the response's
      // actual negotiated price, same formula as wanted-responses.tsx
      // (response.price * 0.05), instead of trusting the client.
      const { data: responseRow } = await supabase.from('item_responses').select('price').eq('id', item_response_id).maybeSingle();
      if (!responseRow) {
        return new Response(JSON.stringify({ error: 'Response not found' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      const expectedCommission = parseFloat((responseRow.price * 0.05).toFixed(2));
      const amountErr = await validateAmount(expectedCommission, 'commission');
      if (amountErr) return amountErr;

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
      const ownErr = requireOwn(buyer_id, 'buyer_id');
      if (ownErr) return ownErr;

      // FIX: recomputes the real 7%-capped-at-$15 commitment fee from
      // the quote's actual price, same formula quotes.tsx uses
      // (calculateDeposit), instead of trusting the client.
      const { data: quoteRow } = await supabase.from('quotes').select('price').eq('id', trip_quote_id).maybeSingle();
      if (!quoteRow) {
        return new Response(JSON.stringify({ error: 'Quote not found' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      const expectedDeposit = Math.min(parseFloat((quoteRow.price * 0.07).toFixed(2)), 15);
      const amountErr = await validateAmount(expectedDeposit, 'commitment fee');
      if (amountErr) return amountErr;

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
      const ownErr = requireOwn(buyer_id, 'buyer_id');
      if (ownErr) return ownErr;
      // FIX: flat $30 fee, same PRICE constant dealer-pro-pay.tsx uses.
      const amountErr = await validateAmount(30, 'Dealer Pro subscription fee');
      if (amountErr) return amountErr;

      intentRow.buyer_id = buyer_id;
    } else if (kind === 'featured_listing') {
      const { listing_id, buyer_id } = body;
      if (!listing_id || !buyer_id) {
        return new Response(JSON.stringify({ error: 'Missing listing_id/buyer_id' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      const ownErr = requireOwn(buyer_id, 'buyer_id');
      if (ownErr) return ownErr;
      // FIX: flat $5 fee, same PRICE constant feature-listing-pay.tsx uses.
      const amountErr = await validateAmount(5, 'featured listing fee');
      if (amountErr) return amountErr;

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
      const ownErr = requireOwn(buyer_id, 'buyer_id');
      if (ownErr) return ownErr;
      // FIX: flat $15 fee, same PRICE constant verified-seller-pay.tsx uses.
      const amountErr = await validateAmount(15, 'Verified Seller fee');
      if (amountErr) return amountErr;

      intentRow.buyer_id = buyer_id;
    } else if (kind === 'delivery_booking_fee') {
      const {
        listing_id, item_request_id, buyer_id, seller_id,
        operator_user_id, pickup_city, dropoff_city, delivery_type,
        delivery_fee, parcel_size, parcel_description, scheduled_date,
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
      const ownErr = requireOwn(buyer_id, 'buyer_id');
      if (ownErr) return ownErr;
      // FIX: flat $2 platform booking fee (BOOKING_FEE in
      // delivery-booking.tsx) — separate from delivery_fee, which is
      // cash-on-collection paid to the driver directly and never
      // charged through Paynow, so it's intentionally NOT validated
      // here beyond the presence check above.
      const amountErr = await validateAmount(2, 'delivery booking fee');
      if (amountErr) return amountErr;

      intentRow.listing_id = hasListing ? listing_id : null;
      intentRow.item_request_id = hasWantedMatch ? item_request_id : null;
      intentRow.buyer_id = buyer_id;
      intentRow.seller_id = seller_id;
      intentRow.operator_user_id = operator_user_id;
      intentRow.pickup_city = pickup_city;
      intentRow.dropoff_city = dropoff_city;
      intentRow.delivery_type = delivery_type;
      intentRow.delivery_fee = delivery_fee;
      // NEW: item size tier ('small' | 'large') — drives the
      // $8/$12/$15 rate delivery-booking.tsx already computed
      // client-side; stored here purely so confirm-payment.ts can
      // carry it through to the real delivery_bookings row once
      // payment confirms, same pattern as scheduled_date below.
      intentRow.parcel_size = parcel_size ?? null;
      intentRow.parcel_description = parcel_description ?? null;
      intentRow.scheduled_date = scheduled_date ?? null;
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