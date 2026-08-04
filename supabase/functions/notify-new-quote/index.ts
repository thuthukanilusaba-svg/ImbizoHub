// supabase/functions/notify-new-quote/index.ts
//
// Closes a real gap: a customer who posts a trip request currently has
// no way to know a quote came in except manually reopening quotes.tsx
// and checking — no push, no local notification, nothing. Same shared-
// secret trigger pattern as every other notify-* function in this
// project.
//
// Expected trigger payload: { quote_id: bigint }

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

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  const providedSecret = req.headers.get('X-Notify-Secret');
  if (!NOTIFY_SHARED_SECRET || providedSecret !== NOTIFY_SHARED_SECRET) {
    console.error('notify-new-quote: invalid or missing shared secret');
    return new Response('Unauthorized', { status: 401 });
  }

  try {
    const { quote_id } = await req.json();
    if (!quote_id) return new Response('Missing quote_id', { status: 400 });

    const { data: quote, error: quoteError } = await supabase
      .from('quotes')
      .select('id, request_id, operator_id, price')
      .eq('id', quote_id)
      .maybeSingle();

    if (quoteError || !quote) {
      console.error('notify-new-quote: no matching quote', quote_id);
      return new Response('No matching quote', { status: 200 });
    }

    const { data: request } = await supabase
      .from('requests')
      .select('user_id, pickup, destination')
      .eq('id', quote.request_id)
      .maybeSingle();

    if (!request) return new Response('No matching request', { status: 200 });

    const [operatorProfile, customerProfile] = await Promise.all([
      supabase.from('profiles').select('full_name').eq('id', quote.operator_id).maybeSingle(),
      supabase.from('profiles').select('push_token').eq('id', request.user_id).maybeSingle(),
    ]);

    const operatorName = operatorProfile.data?.full_name || 'An operator';
    const label = request.pickup && request.destination
      ? `${request.pickup} → ${request.destination}`
      : 'your trip';

    await sendExpoPushNotification(
      customerProfile.data?.push_token,
      'New quote received 🚐',
      `${operatorName} quoted $${quote.price} for ${label}`,
      { type: 'new_quote', quote_id: quote.id, request_id: quote.request_id }
    );

    return new Response('OK', { status: 200 });
  } catch (err) {
    console.error('notify-new-quote error:', err);
    return new Response('Server error', { status: 500 });
  }
});