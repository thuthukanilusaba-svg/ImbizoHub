// supabase/functions/notify-listing-sold/index.ts
//
// Closes a real gap: when a seller taps "Mark as sold" on listing.tsx,
// nothing previously told any OTHER buyer who'd unlocked chat on that
// same listing that it was gone — their conversation just sat there,
// no explanation, even after they'd already paid an unlock fee to
// start it. This finds every buyer who unlocked this listing
// (listing_deposits, status='paid') and inserts an automatic message
// into each of their threads with the seller.
//
// Deliberately does NOT send its own push notification — inserting
// into `messages` is a completely normal insert, so the existing
// on_new_message trigger (notify-new-message) fires on it naturally,
// same as any other message. No need to duplicate that logic here.
//
// Same shared-secret auth pattern as every other notify-* function —
// only ever called by the DB trigger (notify-listing-sold-trigger.sql),
// never by the client directly.
//
// Expected trigger payload: { listing_id: number }

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const NOTIFY_SHARED_SECRET = Deno.env.get('NOTIFY_SHARED_SECRET')!;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

Deno.serve(async (req) => {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  const providedSecret = req.headers.get('X-Notify-Secret');
  if (!NOTIFY_SHARED_SECRET || providedSecret !== NOTIFY_SHARED_SECRET) {
    console.error('notify-listing-sold: invalid or missing shared secret');
    return new Response('Unauthorized', { status: 401 });
  }

  try {
    const { listing_id } = await req.json();
    if (!listing_id) {
      return new Response('Missing listing_id', { status: 400 });
    }

    const { data: listing, error: listingError } = await supabase
      .from('listings')
      .select('id, title, user_id')
      .eq('id', listing_id)
      .maybeSingle();

    if (listingError || !listing) {
      console.error('notify-listing-sold: no matching listing', listing_id);
      return new Response('No matching listing', { status: 200 });
    }

    // Every buyer who ever unlocked chat on this listing — deliberately
    // NOT trying to guess which one was the actual buyer (nothing ties
    // "Mark as sold" to a specific completed meetpay_sessions row, it's
    // an independent manual toggle), so everyone who unlocked gets the
    // same message. Slightly redundant for whoever actually bought it,
    // completely harmless.
    const { data: deposits } = await supabase
      .from('listing_deposits')
      .select('buyer_id')
      .eq('listing_id', listing_id)
      .eq('status', 'paid');

    if (!deposits || deposits.length === 0) {
      return new Response('No unlocked buyers to notify', { status: 200 });
    }

    const uniqueBuyerIds = [...new Set(deposits.map((d) => d.buyer_id))];
    const messageText = `This item ("${listing.title}") has been marked as sold. Thanks for your interest!`;

    const rows = uniqueBuyerIds.map((buyerId) => ({
      text: messageText,
      sender_id: listing.user_id,
      receiver_id: buyerId,
      listing_id: listing.id,
    }));

    const { error: insertError } = await supabase.from('messages').insert(rows);

    if (insertError) {
      console.error('notify-listing-sold: failed to insert messages', insertError.message);
      return new Response('Failed to insert notice messages', { status: 500 });
    }

    return new Response(`OK — notified ${uniqueBuyerIds.length} buyer(s)`, { status: 200 });
  } catch (err) {
    console.error('notify-listing-sold error:', err);
    return new Response('Server error', { status: 500 });
  }
});