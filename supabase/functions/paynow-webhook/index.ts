// supabase/functions/paynow-webhook/index.ts
//
// This is the `resulturl` Paynow POSTs to whenever a transaction's status
// changes. This is the ONLY place a REAL payment gets confirmed — never
// do this from the app side on the return redirect alone, since a
// returnurl visit just means the user came back to the app, not that
// Paynow actually confirmed payment. The hash on this message must be
// verified, since anyone could otherwise POST a fake "Paid" status to
// this URL and get free access.
//
// REFACTORED: the actual per-kind DB writes + notifications (insert
// listing_deposits, set dealer_pro_expires_at, insert delivery_bookings,
// etc.) now live in ../_shared/confirm-payment.ts as confirmPaymentIntent().
// This file's job is narrowed to: verify the hash, fetch the intent,
// check idempotency, then delegate. create-payment/index.ts calls the
// same confirmPaymentIntent() in test mode, so a test-mode "payment"
// produces byte-for-byte the same DB writes and pushes a real one would
// — there's only one place this logic is written, so the two paths
// can't drift apart.
//
// Field order for the hash matches Paynow's actual status-update
// message order: reference, paynowreference, amount, status, pollurl.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { confirmPaymentIntent } from '../_shared/confirm-payment.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const PAYNOW_INTEGRATION_KEY = Deno.env.get('PAYNOW_INTEGRATION_KEY')!;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

async function paynowHash(orderedValues: string[], integrationKey: string): Promise<string> {
  const raw = orderedValues.join('') + integrationKey;
  const data = new TextEncoder().encode(raw);
  const digest = await crypto.subtle.digest('SHA-512', data);
  const hex = Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  return hex.toUpperCase();
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  try {
    const bodyText = await req.text();
    const params = new URLSearchParams(bodyText);

    const reference = params.get('reference') ?? '';
    const amount = params.get('amount') ?? '';
    const paynowreference = params.get('paynowreference') ?? '';
    const pollurl = params.get('pollurl') ?? '';
    const status = params.get('status') ?? '';
    const receivedHash = params.get('hash') ?? '';

    const expectedHash = await paynowHash(
      [reference, paynowreference, amount, status, pollurl],
      PAYNOW_INTEGRATION_KEY
    );

    if (expectedHash !== receivedHash.toUpperCase()) {
      console.error('Paynow webhook hash mismatch', { reference });
      return new Response('Invalid hash', { status: 400 });
    }

    const isPaid = status === 'Paid' || status === 'Awaiting Delivery';

    const { data: intent, error: fetchError } = await supabase
      .from('payment_intents')
      .select('*')
      .eq('our_reference', reference)
      .maybeSingle();

    if (fetchError || !intent) {
      console.error('paynow-webhook: no matching payment_intents row', reference);
      return new Response('No matching intent', { status: 200 });
    }

    if (intent.status === 'paid') {
      return new Response('Already processed', { status: 200 });
    }

    if (!isPaid) {
      await supabase
        .from('payment_intents')
        .update({ paynow_reference: paynowreference, poll_url: pollurl })
        .eq('our_reference', reference);
      return new Response('Recorded, not yet paid', { status: 200 });
    }

    const result = await confirmPaymentIntent(supabase, intent, {
      paynowReference: paynowreference,
      pollUrl: pollurl,
    });

    if (!result.ok) {
      return new Response(result.error, { status: 500 });
    }

    return new Response('OK', { status: 200 });
  } catch (err) {
    console.error('paynow-webhook error', err);
    return new Response('Server error', { status: 500 });
  }
});