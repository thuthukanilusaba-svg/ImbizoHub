// supabase/functions/notify-new-wanted-response/index.ts
//
// Closes a real gap: a buyer who posts a Wanted item currently has no
// way to know a seller responded except manually reopening
// wanted-responses.tsx and checking. Same shared-secret trigger
// pattern as every other notify-* function in this project.
//
// Expected trigger payload: { response_id: uuid }

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
    console.error('notify-new-wanted-response: invalid or missing shared secret');
    return new Response('Unauthorized', { status: 401 });
  }

  try {
    const { response_id } = await req.json();
    if (!response_id) return new Response('Missing response_id', { status: 400 });

    const { data: response, error: responseError } = await supabase
      .from('item_responses')
      .select('id, item_request_id, responder_id, price')
      .eq('id', response_id)
      .maybeSingle();

    if (responseError || !response) {
      console.error('notify-new-wanted-response: no matching response', response_id);
      return new Response('No matching response', { status: 200 });
    }

    const { data: itemRequest } = await supabase
      .from('item_requests')
      .select('user_id, title')
      .eq('id', response.item_request_id)
      .maybeSingle();

    if (!itemRequest) return new Response('No matching item_request', { status: 200 });

    const [responderProfile, buyerProfile] = await Promise.all([
      supabase.from('profiles').select('full_name').eq('id', response.responder_id).maybeSingle(),
      supabase.from('profiles').select('push_token').eq('id', itemRequest.user_id).maybeSingle(),
    ]);

    const responderName = responderProfile.data?.full_name || 'Someone';

    await sendExpoPushNotification(
      buyerProfile.data?.push_token,
      'New response to your want 🔍',
      `${responderName} responded to "${itemRequest.title}" with $${response.price}`,
      { type: 'new_wanted_response', response_id: response.id, item_request_id: response.item_request_id }
    );

    return new Response('OK', { status: 200 });
  } catch (err) {
    console.error('notify-new-wanted-response error:', err);
    return new Response('Server error', { status: 500 });
  }
});