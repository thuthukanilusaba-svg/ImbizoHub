// supabase/functions/accept-response-free-promo/index.ts
//
// Launch promotion: accepting a Wanted-tab response is free until
// January 31, 2027. Mirrors confirm-payment.ts's wanted_request_match
// branch exactly — accept this response, decline every other pending
// response on the same item_request, mark the request 'matched', and
// notify the winning responder. Same reasoning as
// accept-quote-free-promo: this cascade has to match precisely, since
// missing the decline step would leave sibling responses stuck in
// 'pending' forever even though the request is already spoken for.
//
// Built as an Edge Function rather than a plain RPC for the real
// branch's push notification to the winning responder.
//
// Called directly by wanted-responses.tsx during the promo window,
// replacing the normal create-payment + Paynow checkout entirely.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const NOTIFY_SHARED_SECRET = Deno.env.get('NOTIFY_SHARED_SECRET')!;

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';
const PROMO_END = new Date('2027-01-31T23:59:59Z');

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

// Same helper as confirm-payment.ts's notifyWantedMatchAccepted,
// inlined here rather than imported.
async function notifyWantedMatchAccepted(sellerId: string, itemRequestId: string) {
  try {
    const { data: sellerProfile } = await supabase
      .from('profiles').select('push_token').eq('id', sellerId).maybeSingle();
    if (!sellerProfile?.push_token) return;

    let requestTitle = 'a wanted post';
    const { data: request } = await supabase
      .from('item_requests').select('title').eq('id', itemRequestId).maybeSingle();
    if (request?.title) requestTitle = request.title;

    await sendExpoPushNotification(
      sellerProfile.push_token,
      'Your offer was accepted! 🎉',
      `The buyer chose your offer for "${requestTitle}" (free launch promo). Chat is now open.`,
      { type: 'wanted_match', item_request_id: itemRequestId }
    );
  } catch (err) {
    console.error('accept-response-free-promo: notifyWantedMatchAccepted failed', err);
  }
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  const providedSecret = req.headers.get('X-Notify-Secret');
  if (!NOTIFY_SHARED_SECRET || providedSecret !== NOTIFY_SHARED_SECRET) {
    console.error('accept-response-free-promo: invalid or missing shared secret');
    return new Response('Unauthorized', { status: 401 });
  }

  if (new Date() > PROMO_END) {
    return new Response(JSON.stringify({ error: 'The free launch promotion has ended. Please use the normal payment flow.' }), { status: 400 });
  }

  try {
    const { item_request_id, item_response_id, buyer_id, seller_id } = await req.json();
    if (!item_request_id || !item_response_id || !buyer_id || !seller_id) {
      return new Response(JSON.stringify({ error: 'Missing required fields' }), { status: 400 });
    }

    const { error: responseError } = await supabase
      .from('item_responses')
      .update({
        status: 'accepted',
        commission_paid: true,
        commission_amount: 0,
      })
      .eq('id', item_response_id);

    if (responseError) {
      console.error('accept-response-free-promo: item_responses update failed', responseError.message);
      return new Response(JSON.stringify({ error: 'DB error' }), { status: 500 });
    }

    await supabase
      .from('item_responses')
      .update({ status: 'declined' })
      .eq('item_request_id', item_request_id)
      .neq('id', item_response_id)
      .eq('status', 'pending');

    const { error: requestError } = await supabase
      .from('item_requests')
      .update({ status: 'matched' })
      .eq('id', item_request_id);

    if (requestError) {
      console.error('accept-response-free-promo: item_requests update failed', requestError.message);
      return new Response(JSON.stringify({ error: 'DB error' }), { status: 500 });
    }

    await supabase.from('transactions').insert({
      user_id: buyer_id,
      type: 'wanted_request_match',
      amount: 0,
      status: 'completed',
      notes: `Wanted-post match fee waived — free launch promotion (through Jan 31, 2027)`,
    });

    await notifyWantedMatchAccepted(seller_id, item_request_id);

    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('accept-response-free-promo error:', err);
    return new Response(JSON.stringify({ error: 'Server error' }), { status: 500 });
  }
});