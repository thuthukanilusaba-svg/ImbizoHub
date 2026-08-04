// supabase/functions/notify-delivery-status/index.ts
//
// Closes a real gap: a buyer waiting on a delivery currently has no
// way to know it's progressing except manually reopening the tracking
// screen. Built against the CONFIRMED real schema
// (delivery_bookings.buyer_id, accepted_at, dispatched_at,
// delivered_at, confirmed_at — checked directly before writing this).
//
// Expected trigger payload: { booking_id: uuid, event_type: string }
// event_type is one of 'accepted' | 'dispatched' | 'delivered' | 'confirmed'
// — determined by the trigger, not guessed here, since the trigger has
// access to compare old vs new row values directly.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const NOTIFY_SHARED_SECRET = Deno.env.get('NOTIFY_SHARED_SECRET')!;

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const MESSAGES: Record<string, { title: string; body: string }> = {
  accepted: { title: 'Delivery accepted 📦', body: 'A driver has accepted your delivery.' },
  dispatched: { title: 'On the way 🚚', body: 'Your delivery has been picked up and is on the way.' },
  delivered: { title: 'Delivered ✅', body: 'Your delivery has arrived.' },
  confirmed: { title: 'Delivery confirmed', body: 'Your delivery has been confirmed complete.' },
};

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

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  const providedSecret = req.headers.get('X-Notify-Secret');
  if (!NOTIFY_SHARED_SECRET || providedSecret !== NOTIFY_SHARED_SECRET) {
    console.error('notify-delivery-status: invalid or missing shared secret');
    return new Response('Unauthorized', { status: 401 });
  }

  try {
    const { booking_id, event_type } = await req.json();
    if (!booking_id || !event_type || !MESSAGES[event_type]) {
      return new Response('Missing or invalid booking_id/event_type', { status: 400 });
    }

    const { data: booking, error: bookingError } = await supabase
      .from('delivery_bookings')
      .select('id, buyer_id')
      .eq('id', booking_id)
      .maybeSingle();

    if (bookingError || !booking) {
      console.error('notify-delivery-status: no matching booking', booking_id);
      return new Response('No matching booking', { status: 200 });
    }

    const { data: buyerProfile } = await supabase
      .from('profiles')
      .select('push_token')
      .eq('id', booking.buyer_id)
      .maybeSingle();

    const message = MESSAGES[event_type];

    await sendExpoPushNotification(
      buyerProfile?.push_token,
      message.title,
      message.body,
      { type: 'delivery_status', booking_id: booking.id, event_type }
    );

    return new Response('OK', { status: 200 });
  } catch (err) {
    console.error('notify-delivery-status error:', err);
    return new Response('Server error', { status: 500 });
  }
});