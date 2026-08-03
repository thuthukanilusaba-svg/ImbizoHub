// supabase/functions/notify-meetpay-event/index.ts
//
// Sends the cross-device push notification the two LOCAL notification
// calls in chat.tsx (notifyMeetPayPinGenerated / notifyTransactionConfirmed,
// in lib/notifications.ts) were never actually able to deliver: both are
// showLocalNotification() calls, which only ever display on the device
// that calls them. Since they fire on the ACTING party's own client
// (the buyer's device when a PIN is generated, the confirmer's device
// when a PIN is confirmed) — and chat.tsx has no realtime subscription
// on meetpay_sessions the way it does on messages — the party who is
// actually meant to see each notification (the seller for "PIN ready",
// the buyer for "confirmed") never got it. This function fills that gap
// the same way paynow-webhook already does for payment events: a real
// server-side Expo push, sent to the OTHER party, triggered by a DB
// trigger rather than the acting client.
//
// Called only by DB triggers on meetpay_sessions (see
// notify-meetpay-event-trigger.sql) — never by the client directly.
// Authenticated via a shared secret (X-Notify-Secret header), same
// pattern as notify-admin-verification, since these calls originate from
// Postgres itself, not a logged-in session.
//
// Expected trigger payload:
// {
//   event: 'pin_generated' | 'confirmed',
//   session_id: string,       // meetpay_sessions.id
// }
//
// The row itself (type, reference_id, buyer_id, seller_id, ...) is
// re-fetched here rather than trusted from the trigger payload, so a
// stale/replayed call can't misattribute a notification — same
// reasoning notify-admin-verification uses for re-fetching the
// applicant's name instead of trusting it inline.

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

// Resolves a human-readable label for the item this session is about —
// same "listing vs item_request" branch chat.tsx itself already uses
// (see the meetpay_sessions insert in openMeetPay()), so the title
// shown here always matches what the two parties are actually chatting
// about, not just a generic "your listing" for wanted-tab matches.
async function itemLabelFor(type: string, referenceId: string): Promise<string> {
  if (type === 'item_request') {
    const { data } = await supabase
      .from('item_requests')
      .select('title')
      .eq('id', referenceId)
      .maybeSingle();
    return data?.title || 'this item';
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
    const { event, session_id } = await req.json();

    if (event !== 'pin_generated' && event !== 'confirmed') {
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
      // 200, not 500/404 — same reasoning as paynow-webhook's "no
      // matching intent" case: the trigger fired correctly, there's just
      // nothing more for this function to do, so don't make Postgres
      // treat the trigger call itself as failed.
      return new Response('No matching session', { status: 200 });
    }

    const itemLabel = await itemLabelFor(session.type, session.reference_id);

    if (event === 'pin_generated') {
      // The buyer generated the PIN — the seller (confirm-PIN role) is
      // the one who needs to know it's ready.
      const sellerToken = await pushTokenFor(session.seller_id);
      await sendExpoPushNotification(
        sellerToken,
        'Meet & Pay PIN ready',
        `The buyer has generated a PIN for "${itemLabel}". Tap to confirm the transaction.`,
        { type: 'meetpay', session_id: session.id }
      );
    } else {
      // event === 'confirmed' — the seller/responder confirmed the PIN;
      // the buyer is the one waiting to hear the deal is done.
      const buyerToken = await pushTokenFor(session.buyer_id);
      await sendExpoPushNotification(
        buyerToken,
        'Transaction confirmed! ✅',
        `The deal for "${itemLabel}" has been confirmed. Please leave a rating.`,
        { type: 'confirmed', session_id: session.id }
      );
    }

    return new Response('OK', { status: 200 });
  } catch (err) {
    console.error('notify-meetpay-event error:', err);
    return new Response('Server error', { status: 500 });
  }
});