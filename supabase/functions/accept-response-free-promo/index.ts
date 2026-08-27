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
//
// ⚠️ FIX (real bug, found during a full-codebase sweep): this checked
// an `X-Notify-Secret` header against NOTIFY_SHARED_SECRET — a
// server-to-server auth mechanism — but is "called directly by
// wanted-responses.tsx", a CLIENT screen, via the standard
// supabase.functions.invoke(), which never sets that header. Every real
// call from the app was therefore rejected with 401 — the "accept a
// Wanted response free" launch-promo path was non-functional. Same
// wrong pattern copy-pasted into unlock-free-promo,
// accept-quote-free-promo, and feature-listing-free-promo — all four
// fixed the same way in this pass. Also added: this never verified the
// caller's identity against `buyer_id` — anyone who got past the
// (broken) secret check could have accepted ANY response for free under
// ANY buyer_id. Now verifies a real JWT and requires buyer_id to match
// the authenticated caller.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

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

// NEW: same helper as confirm-payment.ts's notifyResponsesDeclined,
// inlined here rather than imported (same pattern as
// notifyWantedMatchAccepted above) — notifies every responder whose
// offer was declined when the buyer accepted a DIFFERENT response on
// the same wanted post. Mirrors accept-quote-free-promo's
// notifyQuotesDeclined for the exact same reason: previously the only
// signal a losing responder got was their offer quietly disappearing,
// with no explicit "you weren't picked" moment.
async function notifyResponsesDeclined(responderIds: string[], itemRequestId: string) {
  if (responderIds.length === 0) return;
  try {
    let requestTitle = 'a wanted post';
    const { data: request } = await supabase
      .from('item_requests').select('title').eq('id', itemRequestId).maybeSingle();
    if (request?.title) requestTitle = request.title;

    const { data: profiles } = await supabase
      .from('profiles').select('id, push_token').in('id', responderIds);

    await Promise.all(
      (profiles ?? []).map((p) =>
        sendExpoPushNotification(
          p.push_token,
          'Offer not selected',
          `The buyer chose a different offer for "${requestTitle}". Keep an eye out for new wanted posts.`,
          { type: 'response_declined', item_request_id: itemRequestId }
        )
      )
    );
  } catch (err) {
    console.error('accept-response-free-promo: notifyResponsesDeclined failed', err);
  }
}

// CORS. Without this the browser's preflight OPTIONS request is
// answered 405 and the real POST is never sent — surfacing in the app
// as "Failed to send a request to the Edge Function", which reads like
// a network fault rather than a permissions handshake. Native apps do
// not preflight, so this only ever broke the web build.
//
// Wrapping the handler rather than editing each new Response(...) call:
// missing one would fail identically and be just as hard to find.
// '*' is safe here — authorisation is on the caller's JWT, never on the
// requesting origin, so allowing any origin to ASK grants nothing.
const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function withCors(handler: (req: Request) => Promise<Response>) {
  return async (req: Request): Promise<Response> => {
    if (req.method === 'OPTIONS') {
      return new Response('ok', { headers: CORS_HEADERS });
    }
    const res = await handler(req);
    // Re-wrap rather than mutate: a Response's headers are immutable
    // once constructed, and this preserves status, statusText and body.
    const out = new Response(res.body, res);
    for (const [key, value] of Object.entries(CORS_HEADERS)) out.headers.set(key, value);
    return out;
  };
}

Deno.serve(withCors(async (req) => {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  // FIX: real caller identity check — see top-of-file comment.
  const authHeader = req.headers.get('Authorization') ?? '';
  const callerToken = authHeader.replace(/^Bearer\s+/i, '');
  if (!callerToken) return new Response('Unauthorized', { status: 401 });
  const { data: callerData, error: callerError } = await supabase.auth.getUser(callerToken);
  if (callerError || !callerData?.user || callerData.user.is_anonymous) {
    return new Response('Unauthorized', { status: 401 });
  }
  const callerId = callerData.user.id;

  if (new Date() > PROMO_END) {
    return new Response(JSON.stringify({ error: 'The free launch promotion has ended. Please use the normal payment flow.' }), { status: 400 });
  }

  try {
    const { item_request_id, item_response_id, buyer_id, seller_id } = await req.json();
    if (!item_request_id || !item_response_id || !buyer_id || !seller_id) {
      return new Response(JSON.stringify({ error: 'Missing required fields' }), { status: 400 });
    }
    // FIX: buyer_id must be the authenticated caller — see top-of-file
    // comment.
    if (buyer_id !== callerId) {
      return new Response(JSON.stringify({ error: 'buyer_id must match the authenticated user' }), { status: 403 });
    }

    // SECURITY: the caller must own the WANTED POST being matched.
    //
    // buyer_id === callerId proves only that the caller is who they claim
    // to be — it says nothing about whose wanted post this is. This
    // function runs on the service-role key, so row-level security does
    // not apply and nothing else stood between an authenticated user and
    // any item_request_id. Posting someone else's ids would accept a
    // response on their behalf, decline every other responder and mark
    // their post matched. Same hole, same fix, as
    // accept-quote-free-promo.
    const { data: ownedRequest, error: requestFetchError } = await supabase
      .from('item_requests')
      .select('id, user_id, status')
      .eq('id', item_request_id)
      .maybeSingle();

    if (requestFetchError || !ownedRequest) {
      console.error('accept-response-free-promo: item_request not found', item_request_id);
      return new Response(JSON.stringify({ error: 'Wanted post not found' }), { status: 404 });
    }
    if (ownedRequest.user_id !== callerId) {
      console.error('accept-response-free-promo: caller does not own item_request', { callerId, request: ownedRequest.id });
      return new Response(JSON.stringify({ error: 'This is not your wanted post' }), { status: 403 });
    }

    // The response must actually belong to this post, and must still be
    // open. Without the first check a caller could match their own post
    // against a response posted on someone else's.
    const { data: theResponse, error: responseFetchError } = await supabase
      .from('item_responses')
      .select('id, item_request_id, responder_id, status')
      .eq('id', item_response_id)
      .maybeSingle();

    if (responseFetchError || !theResponse) {
      return new Response(JSON.stringify({ error: 'Response not found' }), { status: 404 });
    }
    if (String(theResponse.item_request_id) !== String(item_request_id)) {
      return new Response(JSON.stringify({ error: 'That response is not on this wanted post' }), { status: 400 });
    }
    if (theResponse.status !== 'pending' || ownedRequest.status === 'matched') {
      return new Response(JSON.stringify({ error: 'This wanted post has already been matched' }), { status: 409 });
    }

    const { error: responseError } = await supabase
      .from('item_responses')
      .update({
        status: 'accepted',
        commission_paid: true,
        commission_amount: 0,
      })
      .eq('id', item_response_id)
      .eq('status', 'pending');

    if (responseError) {
      console.error('accept-response-free-promo: item_responses update failed', responseError.message);
      return new Response(JSON.stringify({ error: 'DB error' }), { status: 500 });
    }

    // FIX: was a bare update with no .select() — see confirm-payment.ts's
    // matching FIX comment. Selecting the declined rows back is what
    // makes notifyResponsesDeclined below possible.
    const { data: declinedResponses } = await supabase
      .from('item_responses')
      .update({ status: 'declined' })
      .eq('item_request_id', item_request_id)
      .neq('id', item_response_id)
      .eq('status', 'pending')
      .select('responder_id');

    const { error: requestError } = await supabase
      .from('item_requests')
      .update({ status: 'matched' })
      .eq('id', item_request_id)
      .neq('status', 'matched');

    if (requestError) {
      console.error('accept-response-free-promo: item_requests update failed', requestError.message);
      return new Response(JSON.stringify({ error: 'DB error' }), { status: 500 });
    }

    // reference_id was omitted entirely, so the first real Wanted-post
    // transaction (27 Aug) landed with a null reference and no way to trace
    // it back to the post it came from. The quote and listing paths both
    // record theirs. String() because item_requests.id is a uuid while
    // quotes.id and listings.id are bigint — transactions.reference_id is
    // text precisely so it can hold either.
    //
    // The error is checked now too: this was a bare insert, the same shape
    // that silently swallowed every rejected ledger write until the column
    // type was fixed. Non-fatal — the match is already made by this point —
    // but never silent again.
    const { error: txError } = await supabase.from('transactions').insert({
      user_id: buyer_id,
      type: 'wanted_request_match',
      amount: 0,
      reference_id: String(item_request_id),
      status: 'completed',
      notes: `Wanted-post match fee waived — free launch promotion (through Jan 31, 2027)`,
    });
    if (txError) {
      console.error('accept-response-free-promo: transactions insert failed', txError.message, txError.code);
    }

    // theResponse.responder_id, NOT the body's seller_id — the body is
    // caller-supplied and could previously direct this notification at any
    // account at all.
    await notifyWantedMatchAccepted(theResponse.responder_id, item_request_id);
    await notifyResponsesDeclined(
      (declinedResponses ?? []).map((r: any) => r.responder_id),
      item_request_id
    );

    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('accept-response-free-promo error:', err);
    return new Response(JSON.stringify({ error: 'Server error' }), { status: 500 });
  }
}));