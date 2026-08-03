// supabase/functions/notify-new-message/index.ts
//
// Closes the other half of the buyer->seller messaging bug: chat.tsx's
// notifyNewMessage() is a LOCAL notification that only fires while the
// recipient's chat screen is actively mounted with a live realtime
// channel — if they're not currently looking at this exact
// conversation, they never hear about a new message at all, regardless
// of which side sent it. This function sends a real Expo push instead,
// triggered by a DB trigger on every messages insert (see
// notify-new-message-trigger.sql), so the recipient is notified
// whether or not the app is even open.
//
// Same shared-secret auth pattern as notify-admin-verification and
// notify-meetpay-event — this is only ever called by the DB trigger,
// never by the client directly.
//
// Expected trigger payload: { message_id: string }
//
// The message row is re-fetched here rather than trusted from the
// trigger payload, same reasoning as the other notify-* functions.

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

// Same three-way branch chat.tsx itself uses to label a conversation —
// listing, van-hire request, or item-request (Wanted) — so the push
// title matches what the recipient actually sees once they open it.
async function conversationLabel(
  listingId: number | null,
  requestId: string | null,
  itemRequestId: string | null
): Promise<string> {
  if (itemRequestId) {
    const { data } = await supabase
      .from('item_requests')
      .select('title')
      .eq('id', itemRequestId)
      .maybeSingle();
    return data?.title || 'your want';
  }
  if (requestId) {
    // requests (van-hire) has no single "title" column — pickup/destination
    // is the closest human-readable identifier.
    const { data } = await supabase
      .from('requests')
      .select('pickup, destination')
      .eq('id', requestId)
      .maybeSingle();
    return data ? `your trip (${data.pickup} → ${data.destination})` : 'your trip request';
  }
  if (listingId) {
    const { data } = await supabase
      .from('listings')
      .select('title')
      .eq('id', listingId)
      .maybeSingle();
    return data?.title || 'your listing';
  }
  return 'ImbizoHub';
}

async function senderName(senderId: string): Promise<string> {
  const { data } = await supabase
    .from('profiles')
    .select('full_name')
    .eq('id', senderId)
    .maybeSingle();
  return data?.full_name || 'Someone';
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
    console.error('notify-new-message: invalid or missing shared secret');
    return new Response('Unauthorized', { status: 401 });
  }

  try {
    const { message_id } = await req.json();
    if (!message_id) {
      return new Response('Missing message_id', { status: 400 });
    }

    const { data: message, error: messageError } = await supabase
      .from('messages')
      .select('id, text, sender_id, receiver_id, listing_id, request_id, item_request_id')
      .eq('id', message_id)
      .maybeSingle();

    if (messageError || !message) {
      console.error('notify-new-message: no matching message row', message_id);
      // Same reasoning as the other notify-* functions: 200, not an
      // error status, since the trigger itself fired correctly.
      return new Response('No matching message', { status: 200 });
    }

    if (!message.receiver_id) {
      // Nothing to notify — some rows may have a null receiver_id
      // depending on how the conversation was reached.
      return new Response('No receiver on this message', { status: 200 });
    }

    const [label, sender, pushToken] = await Promise.all([
      conversationLabel(message.listing_id, message.request_id, message.item_request_id),
      senderName(message.sender_id),
      pushTokenFor(message.receiver_id),
    ]);

    const preview = message.text.length > 80 ? message.text.slice(0, 80) + '...' : message.text;

    await sendExpoPushNotification(
      pushToken,
      `New message from ${sender}`,
      preview,
      {
        type: 'message',
        message_id: message.id,
        listing_id: message.listing_id,
        request_id: message.request_id,
        item_request_id: message.item_request_id,
      }
    );

    return new Response('OK', { status: 200 });
  } catch (err) {
    console.error('notify-new-message error:', err);
    return new Response('Server error', { status: 500 });
  }
});