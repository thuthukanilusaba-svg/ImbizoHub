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

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const NOTIFY_SHARED_SECRET = Deno.env.get('NOTIFY_SHARED_SECRET')!;

const PROMO_END = new Date('2027-01-31T23:59:59Z');

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  const providedSecret = req.headers.get('X-Notify-Secret');
  if (!NOTIFY_SHARED_SECRET || providedSecret !== NOTIFY_SHARED_SECRET) {
    console.error('feature-listing-free-promo: invalid or missing shared secret');
    return new Response('Unauthorized', { status: 401 });
  }

  if (new Date() > PROMO_END) {
    return new Response(JSON.stringify({ error: 'The free launch promotion has ended. Please use the normal payment flow.' }), { status: 400 });
  }

  try {
    const { listing_id, buyer_id } = await req.json();
    if (!listing_id || !buyer_id) {
      return new Response(JSON.stringify({ error: 'Missing required fields' }), { status: 400 });
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