// supabase/functions/feature-listing-free-promo/index.ts
//
// Launch promotion: featuring a listing is free until January 31,
// 2027, same window as the other four promo flows. Mirrors
// confirm-payment.ts's featured_listing branch exactly — sets
// listings.featured_until 7 days out, records a $0 transaction. This
// is the simplest of the five promo functions built today — no
// sibling cascade to manage (unlike quotes/wanted responses), no push
// notification in the real branch either, just one update and one
// insert.
//
// Called directly by feature-listing-pay.tsx during the promo window,
// replacing the normal create-payment + Paynow checkout entirely.
//
// ⚠️ FIX (real bug, found during a full-codebase sweep): this checked
// an `X-Notify-Secret` header against NOTIFY_SHARED_SECRET — a
// server-to-server auth mechanism — but is "called directly by
// feature-listing-pay.tsx", a CLIENT screen, via the standard
// supabase.functions.invoke(), which never sets that header. Every real
// call from the app was therefore rejected with 401 — the "feature a
// listing free" launch-promo path was non-functional. Same wrong
// pattern copy-pasted into unlock-free-promo, accept-quote-free-promo,
// and accept-response-free-promo — all four fixed the same way in this
// pass. This function's existing listing.user_id === buyer_id check was
// good, but buyer_id itself was still just a self-reported body field
// with nothing tying it to a real caller — now cross-checked against a
// verified JWT too, closing that gap completely.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const PROMO_END = new Date('2027-01-31T23:59:59Z');

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

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
    const { listing_id, buyer_id } = await req.json();
    if (!listing_id || !buyer_id) {
      return new Response(JSON.stringify({ error: 'Missing required fields' }), { status: 400 });
    }
    // FIX: buyer_id must be the authenticated caller — see top-of-file
    // comment.
    if (buyer_id !== callerId) {
      return new Response(JSON.stringify({ error: 'buyer_id must match the authenticated user' }), { status: 403 });
    }

    // Ownership check — same guard feature-listing-pay.tsx itself
    // already does client-side, repeated here server-side since this
    // function can be called directly.
    const { data: listing, error: listingError } = await supabase
      .from('listings')
      .select('id, user_id')
      .eq('id', listing_id)
      .maybeSingle();

    if (listingError || !listing) {
      return new Response(JSON.stringify({ error: 'Listing not found' }), { status: 404 });
    }
    if (listing.user_id !== buyer_id) {
      return new Response(JSON.stringify({ error: 'You can only feature your own listings' }), { status: 403 });
    }

    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7);

    const { error: featuredError } = await supabase
      .from('listings')
      .update({ featured_until: expiresAt.toISOString() })
      .eq('id', listing_id);

    if (featuredError) {
      console.error('feature-listing-free-promo: listings update failed', featuredError.message);
      return new Response(JSON.stringify({ error: 'DB error' }), { status: 500 });
    }

    await supabase.from('transactions').insert({
      user_id: buyer_id,
      type: 'featured_listing',
      amount: 0,
      reference_id: listing_id,
      status: 'completed',
      notes: `Featured listing waived — free launch promotion (through Jan 31, 2027), live until ${expiresAt.toLocaleDateString()}`,
    });

    return new Response(JSON.stringify({ ok: true, featured_until: expiresAt.toISOString() }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('feature-listing-free-promo error:', err);
    return new Response(JSON.stringify({ error: 'Server error' }), { status: 500 });
  }
});