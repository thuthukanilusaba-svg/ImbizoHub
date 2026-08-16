// supabase/functions/notify-delivery-status/index.ts
//
// Closes a real gap, confirmed directly: delivery_bookings has NO
// notification coverage anywhere in the app — a buyer waiting for
// their item, or a seller waiting to hear their sale completed, only
// ever finds out by manually opening dealer.tsx / delivery-track.tsx /
// buyer-deliveries.tsx / seller-deliveries.tsx and checking. Every
// other real event in the app (new message, quote accepted/declined,
// PIN generated, etc.) already has a push notification; this is the
// one meaningful gap left in the delivery flow specifically.
//
// UPDATED: bookings are no longer auto-accepted at payment time — they
// start as 'requested' with a pre-chosen driver, who must explicitly
// accept or decline (see accept_delivery_job / decline_delivery_job).
// This function now also covers:
//   new_request (INSERT, or reassignment back to 'requested') :
//     the assigned/newly-assigned DRIVER is told they have a job
//   declined  (status -> 'declined')                          :
//     the BUYER is told their driver couldn't take it, and can pick
//     another one
// ...on top of the original status-change coverage:
//   requested -> accepted   : buyer told a driver picked up their job
//   accepted  -> dispatched : buyer told their item is now in transit
//   dispatched -> delivered : buyer told to go confirm with their PIN
//   delivered -> confirmed  : buyer AND seller both told it's complete
//     (the OPERATOR is the one who enters the PIN and triggers this
//     transition — on their own device — so the buyer doesn't
//     automatically know it happened just because they read the PIN
//     out loud in person; a real push closes that gap for both sides)
//
// Called only by DB triggers on delivery_bookings (AFTER INSERT and
// AFTER UPDATE, both wired to notify_delivery_status_change()) — never
// by the client directly.
//
// Expected trigger payload: { booking_id: uuid, event: text, new_status: text }
// 'event' is one of: 'new_request' | 'declined' | 'status_change'

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
  if (!pushToken || !pushToken.startsWith('ExponentPushToken')) return;
  try {
    const resp = await fetch(EXPO_PUSH_URL, {
      method: 'POST',
      headers: { Accept: 'application/json', 'Accept-Encoding': 'gzip, deflate', 'Content-Type': 'application/json' },
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

// Same "pick whichever origin is populated" pattern used throughout
// the delivery screens (dealer.tsx, seller-deliveries.tsx, etc.) — a
// booking's item title comes from either a listing or a matched
// Wanted-tab request, never both.
async function itemTitleFor(booking: any): Promise<string> {
  if (booking.listing_id) {
    const { data } = await supabase.from('listings').select('title').eq('id', booking.listing_id).maybeSingle();
    if (data?.title) return data.title;
  } else if (booking.item_request_id) {
    const { data } = await supabase.from('item_requests').select('title').eq('id', booking.item_request_id).maybeSingle();
    if (data?.title) return data.title;
  }
  return 'your item';
}

async function pushTokenForUser(userId: string | null | undefined): Promise<string | null> {
  if (!userId) return null;
  const { data } = await supabase.from('profiles').select('push_token').eq('id', userId).maybeSingle();
  return data?.push_token ?? null;
}

async function pushTokenForOperator(operatorId: string | null | undefined): Promise<string | null> {
  if (!operatorId) return null;
  const { data: operator } = await supabase
    .from('delivery_operators')
    .select('user_id')
    .eq('id', operatorId)
    .maybeSingle();
  if (!operator?.user_id) return null;
  return pushTokenForUser(operator.user_id);
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  const providedSecret = req.headers.get('X-Notify-Secret');
  if (!NOTIFY_SHARED_SECRET || providedSecret !== NOTIFY_SHARED_SECRET) {
    console.error('notify-delivery-status: invalid or missing shared secret');
    return new Response('Unauthorized', { status: 401 });
  }

  try {
    const { booking_id, event, new_status } = await req.json();
    if (!booking_id || (!event && !new_status)) {
      return new Response('Missing booking_id/event', { status: 400 });
    }
    // Backward-compatible: older trigger payloads only ever sent
    // new_status, which always meant a plain status-change notification.
    const effectiveEvent = event ?? 'status_change';

    const { data: booking, error: bookingError } = await supabase
      .from('delivery_bookings')
      .select('id, buyer_id, seller_id, operator_id, listing_id, item_request_id, pickup_city, dropoff_city')
      .eq('id', booking_id)
      .maybeSingle();

    if (bookingError || !booking) {
      console.error('notify-delivery-status: no matching booking', booking_id);
      return new Response('No matching booking', { status: 200 });
    }

    const title = await itemTitleFor(booking);

    if (effectiveEvent === 'new_request') {
      // The driver assigned to this booking (fresh request, or
      // reassigned after a previous driver declined) needs to know a
      // job is waiting for them to accept/decline.
      const operatorPushToken = await pushTokenForOperator(booking.operator_id);
      await sendExpoPushNotification(
        operatorPushToken,
        'New delivery job 📦',
        `You have a new delivery request for "${title}" (${booking.pickup_city} → ${booking.dropoff_city}). Open the app to accept or decline.`,
        { type: 'delivery_request', booking_id }
      );
      return new Response('OK', { status: 200 });
    }

    if (effectiveEvent === 'declined') {
      // The buyer needs to know their assigned driver turned the job
      // down, so they can pick another one.
      const buyerPushToken = await pushTokenForUser(booking.buyer_id);
      await sendExpoPushNotification(
        buyerPushToken,
        'Driver unavailable',
        `Your driver couldn't take the delivery for "${title}". Choose another driver to keep it moving.`,
        { type: 'delivery_declined', booking_id }
      );
      return new Response('OK', { status: 200 });
    }

    // effectiveEvent === 'status_change' — original coverage, unchanged.
    const buyerPushToken = await pushTokenForUser(booking.buyer_id);

    if (new_status === 'accepted') {
      await sendExpoPushNotification(
        buyerPushToken,
        'Driver assigned 🚗',
        `A driver has accepted your delivery for "${title}" and is on the way to collect it.`,
        { type: 'delivery_status', status: 'accepted', booking_id }
      );
    } else if (new_status === 'dispatched') {
      await sendExpoPushNotification(
        buyerPushToken,
        'Your delivery is on the way 🛵',
        `"${title}" has been collected and is in transit to you.`,
        { type: 'delivery_status', status: 'dispatched', booking_id }
      );
    } else if (new_status === 'delivered') {
      await sendExpoPushNotification(
        buyerPushToken,
        'Delivered — confirm receipt ✅',
        `"${title}" has arrived. Give the driver your PIN to confirm you received it.`,
        { type: 'delivery_status', status: 'delivered', booking_id }
      );
    } else if (new_status === 'confirmed') {
      // NEW: both sides notified here specifically, since the
      // OPERATOR is the one who enters the PIN and triggers this
      // transition on their own device — the buyer doesn't
      // automatically know it registered just because they read the
      // PIN out loud in person, and the seller has no visibility into
      // this moment at all otherwise.
      await sendExpoPushNotification(
        buyerPushToken,
        'Delivery confirmed ✅',
        `Your delivery of "${title}" is complete. Thanks for using ImbizoHub safely.`,
        { type: 'delivery_status', status: 'confirmed', booking_id }
      );

      const sellerPushToken = await pushTokenForUser(booking.seller_id);
      await sendExpoPushNotification(
        sellerPushToken,
        'Delivery confirmed ✅',
        `The buyer confirmed receipt of "${title}". This delivery is complete.`,
        { type: 'delivery_status', status: 'confirmed', booking_id }
      );
    }

    return new Response('OK', { status: 200 });
  } catch (err) {
    console.error('notify-delivery-status error:', err);
    return new Response('Server error', { status: 500 });
  }
});
