// supabase/functions/notify-meetpay-event/index.ts
//
// UPDATED: van-hire trips no longer use a PIN (see meetpay.tsx's
// rewrite) — replaced with mutual confirmation, both parties tap
// "Confirm Trip Complete" independently. This adds the two new events
// that flow needs:
//   - 'trip_half_confirmed': one side confirmed, notify the OTHER side
//     they're now the one being waited on. Closes a real gap — without
//     it, nobody's told when they've become the last step.
//   - 'confirmed' for van_hire specifically now notifies BOTH parties
//     (unlike listings, where only one side needs telling — for a
//     mutual flow, whoever completes the final confirmation could be
//     either side, so both get the "trip confirmed" push).
//
// CHANGED (PIN-role reversal, reverse_meetpay_pin_roles migration): for
// listing/item_request sessions, the SELLER now generates the PIN (in
// person, once both parties are happy) and the BUYER now enters it to
// confirm — previously it was the other way around. This flips which
// party each of the two events below notifies:
//   - 'pin_generated' now tells the BUYER (they're the one waiting to
//     enter it), not the seller.
//   - 'confirmed' (non-van_hire branch) now tells the SELLER (they're
//     the one waiting to hear the buyer confirmed), not the buyer.
// This function was also out of date with the DB trigger before this
// deploy — the live version didn't handle 'trip_half_confirmed' at all
// (the trigger sent it, this function 400'd on it as unrecognized) —
// this deploy brings it back in sync with notify_meetpay_session_change().
//
// NOTE: a "seller agrees to meet" step also exists now (see
// meetpay_sessions.seller_agreed_at / agree_to_meetpay() /
// meetpay_seller_agreed_step migration) but deliberately does NOT push
// a notification through this function — trimmed as a simplification
// (meetpay_seller_agreed_trim_push migration): chat.tsx already has a
// realtime subscription on the session row, so a buyer with the chat
// open sees the change live with no push needed. Only PIN generation
// and final confirmation are important enough to also reach a
// closed/backgrounded app.
//
// Called only by DB triggers on meetpay_sessions (see
// notify-meetpay-event-trigger.sql) — never by the client directly.
// Authenticated via a shared secret (X-Notify-Secret header).
//
// Expected trigger payload:
// {
//   event: 'pin_generated' | 'confirmed' | 'trip_half_confirmed',
//   session_id: string,
//   confirmed_by_role?: 'buyer' | 'seller',  // only for trip_half_confirmed
// }

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const NOTIFY_SHARED_SECRET = Deno.env.get('NOTIFY_SHARED_SECRET')!;

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

async function sendExpoPushNotification(
  pushToken: string | null | undefined,
  title: string,
  body: string,
  data?: Record<string, unknown>
) {
  if (!pushToken || !pushToken.startsWith('ExponentPushToken')) {
    return;
  }
  try {
    const resp = await fetch(EXPO_PUSH_URL, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Accept-Encoding': 'gzip, deflate',
        'Content-Type': 'application/json',
      },
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

// Resolves a human-readable label for the item/trip this session is
// about. UPDATED: added a van_hire branch — pickup/destination is the
// closest equivalent to a "title" for a trip request, same fallback
// pattern already used for listing/item_request.
async function itemLabelFor(type: string, referenceId: string): Promise<string> {
  if (type === 'item_request') {
    const { data } = await supabase
      .from('item_requests')
      .select('title')
      .eq('id', referenceId)
      .maybeSingle();
    return data?.title || 'this item';
  }
  if (type === 'van_hire') {
    // reference_id for van_hire is the quote id, not the request id
    // directly — resolve through quotes -> requests, same relationship
    // quotes.tsx itself uses.
    const { data: quote } = await supabase
      .from('quotes')
      .select('request_id')
      .eq('id', referenceId)
      .maybeSingle();
    if (quote?.request_id) {
      const { data: request } = await supabase
        .from('requests')
        .select('pickup, destination')
        .eq('id', quote.request_id)
        .maybeSingle();
      if (request?.pickup && request?.destination) {
        return `your trip (${request.pickup} → ${request.destination})`;
      }
    }
    return 'your trip';
  }
  const { data } = await supabase
    .from('listings')
    .select('title')
    .eq('id', referenceId)
    .maybeSingle();
  return data?.title || 'this listing';
}

async function pushTokenFor(userId: string): Promise<string | null> {
  const { data } = await supabase
    .from('profiles')
    .select('push_token')
    .eq('id', userId)
    .maybeSingle();
  return data?.push_token ?? null;
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  const providedSecret = req.headers.get('X-Notify-Secret');
  if (!NOTIFY_SHARED_SECRET || providedSecret !== NOTIFY_SHARED_SECRET) {
    console.error('notify-meetpay-event: invalid or missing shared secret');
    return new Response('Unauthorized', { status: 401 });
  }

  try {
    const { event, session_id, confirmed_by_role } = await req.json();

    if (event !== 'pin_generated' && event !== 'confirmed' && event !== 'trip_half_confirmed') {
      return new Response('Unrecognized event', { status: 400 });
    }
    if (!session_id) {
      return new Response('Missing session_id', { status: 400 });
    }

    const { data: session, error: sessionError } = await supabase
      .from('meetpay_sessions')
      .select('id, type, reference_id, buyer_id, seller_id, status')
      .eq('id', session_id)
      .maybeSingle();

    if (sessionError || !session) {
      console.error('notify-meetpay-event: no matching meetpay_sessions row', session_id);
      return new Response('No matching session', { status: 200 });
    }

    const itemLabel = await itemLabelFor(session.type, session.reference_id);

    if (event === 'pin_generated') {
      // listing/item_request only, never fires for van_hire (that flow
      // has no PIN to generate). CHANGED (PIN-role reversal): the
      // SELLER generates the PIN now — the BUYER is the one waiting to
      // enter it, so they're the one who needs telling it's ready.
      const buyerToken = await pushTokenFor(session.buyer_id);
      await sendExpoPushNotification(
        buyerToken,
        'Meet & Pay PIN ready',
        `The seller has generated a PIN for "${itemLabel}". Tap to enter it and confirm you received it.`,
        { type: 'meetpay', session_id: session.id }
      );
    } else if (event === 'trip_half_confirmed') {
      // NEW — van_hire only. One side confirmed; tell the OTHER side
      // they're now the one being waited on.
      const notifyBuyer = confirmed_by_role === 'seller';
      const recipientId = notifyBuyer ? session.buyer_id : session.seller_id;
      const recipientToken = recipientId ? await pushTokenFor(recipientId) : null;
      const confirmerLabel = notifyBuyer ? 'Your driver' : 'Your customer';

      await sendExpoPushNotification(
        recipientToken,
        'Waiting on your confirmation',
        `${confirmerLabel} confirmed ${itemLabel} is complete — please confirm on your side too.`,
        { type: 'trip_half_confirmed', session_id: session.id }
      );
    } else {
      // event === 'confirmed'
      // FIX (real bug, found while answering "what message does the
      // seller get after PIN exchange"): _layout.tsx's tap handler for
      // a 'confirmed' notification requires BOTH data.reviewee_id and
      // data.role to navigate to /rating — and deliberately does
      // nothing if either is missing (see its own comment). Every push
      // sent below used to omit both, so tapping any of these
      // notifications silently did nothing instead of opening the
      // rating screen. reviewee_id/role/listing_id are purely cosmetic
      // display params for rating.tsx — submit_rating() re-derives the
      // real reviewee and role server-side from session_id regardless
      // of what's passed here (see rating.tsx's own header comment), so
      // this is a safe, non-security-relevant fix.
      if (session.type === 'van_hire') {
        // NEW behavior for van_hire: whoever completes the final
        // confirmation could be either side (mutual flow, unlike a
        // PIN's fixed buyer-generates/seller-confirms order), so both
        // parties get the "trip confirmed" push rather than assuming
        // it's always the buyer waiting.
        const [buyerToken, sellerToken] = await Promise.all([
          session.buyer_id ? pushTokenFor(session.buyer_id) : null,
          session.seller_id ? pushTokenFor(session.seller_id) : null,
        ]);
        await Promise.all([
          sendExpoPushNotification(
            buyerToken,
            'Trip confirmed! ✅',
            `${itemLabel} has been confirmed complete by both sides. Please leave a rating.`,
            {
              type: 'confirmed',
              session_id: session.id,
              reviewee_id: session.seller_id,
              role: 'buyer',
            }
          ),
          sendExpoPushNotification(
            sellerToken,
            'Trip confirmed! ✅',
            `${itemLabel} has been confirmed complete by both sides. Please leave a rating.`,
            {
              type: 'confirmed',
              session_id: session.id,
              reviewee_id: session.buyer_id,
              role: 'seller',
            }
          ),
        ]);
      } else {
        // listing/item_request. CHANGED (PIN-role reversal): the BUYER
        // confirms now (entering the seller's PIN) — the SELLER is the
        // one waiting to hear it's done.
        const sellerToken = await pushTokenFor(session.seller_id);
        await sendExpoPushNotification(
          sellerToken,
          'Transaction confirmed! ✅',
          `The buyer confirmed the deal for "${itemLabel}". Please leave a rating.`,
          {
            type: 'confirmed',
            session_id: session.id,
            reviewee_id: session.buyer_id,
            role: 'seller',
            // Only a real listing has a listing_id to pass — an
            // item_request deal has none, same distinction chat.tsx's
            // own in-app "Rate this transaction" button already makes.
            ...(session.type === 'listing' ? { listing_id: session.reference_id } : {}),
          }
        );
      }
    }

    return new Response('OK', { status: 200 });
  } catch (err) {
    console.error('notify-meetpay-event error:', err);
    return new Response('Server error', { status: 500 });
  }
});