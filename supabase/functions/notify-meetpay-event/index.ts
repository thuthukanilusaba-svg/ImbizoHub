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
//     (unlike listings, where only the buyer needs telling — for a
//     mutual flow, whoever completes the final confirmation could be
//     either side, so both get the "trip confirmed" push).
//
// Everything below for 'pin_generated' and 'confirmed' on
// listing/item_request sessions is UNCHANGED — those still use PINs,
// still notify exactly the same party as before. Only van_hire's
// behavior is new.
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
      // UNCHANGED — listing/item_request only, never fires for
      // van_hire anymore (that flow has no PIN to generate).
      const sellerToken = await pushTokenFor(session.seller_id);
      await sendExpoPushNotification(
        sellerToken,
        'Meet & Pay PIN ready',
        `The buyer has generated a PIN for "${itemLabel}". Tap to confirm the transaction.`,
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
            { type: 'confirmed', session_id: session.id }
          ),
          sendExpoPushNotification(
            sellerToken,
            'Trip confirmed! ✅',
            `${itemLabel} has been confirmed complete by both sides. Please leave a rating.`,
            { type: 'confirmed', session_id: session.id }
          ),
        ]);
      } else {
        // UNCHANGED — listing/item_request: seller/responder confirmed
        // the PIN, buyer is the one waiting to hear it's done.
        const buyerToken = await pushTokenFor(session.buyer_id);
        await sendExpoPushNotification(
          buyerToken,
          'Transaction confirmed! ✅',
          `The deal for "${itemLabel}" has been confirmed. Please leave a rating.`,
          { type: 'confirmed', session_id: session.id }
        );
      }
    }

    return new Response('OK', { status: 200 });
  } catch (err) {
    console.error('notify-meetpay-event error:', err);
    return new Response('Server error', { status: 500 });
  }
});