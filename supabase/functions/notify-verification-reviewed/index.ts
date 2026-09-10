// supabase/functions/notify-verification-reviewed/index.ts
//
// Closes a real gap: an applicant currently has no way to know their
// Verified Seller / Delivery Operator / Transport Operator verification
// was reviewed except manually re-checking their own status. Built
// against the CONFIRMED real schema (verification_requests.user_id,
// verification_type, status, rejection_reason — checked directly
// before writing this).
//
// ALSO DELETES THE DOCUMENT ON APPROVAL (10 Sep 2026) — see the block
// at the end of the handler.
//
// Expected trigger payload: { request_id: uuid }

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const NOTIFY_SHARED_SECRET = Deno.env.get('NOTIFY_SHARED_SECRET')!;

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const TYPE_LABEL: Record<string, string> = {
  seller: 'Verified Seller',
  delivery_operator: 'Delivery Operator',
  transport_operator: 'Transport Operator',
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
    console.error('notify-verification-reviewed: invalid or missing shared secret');
    return new Response('Unauthorized', { status: 401 });
  }

  try {
    const { request_id } = await req.json();
    if (!request_id) return new Response('Missing request_id', { status: 400 });

    const { data: request, error: requestError } = await supabase
      .from('verification_requests')
      .select('id, user_id, verification_type, status, rejection_reason, document_url')
      .eq('id', request_id)
      .maybeSingle();

    if (requestError || !request) {
      console.error('notify-verification-reviewed: no matching request', request_id);
      return new Response('No matching request', { status: 200 });
    }

    const { data: profile } = await supabase
      .from('profiles')
      .select('push_token')
      .eq('id', request.user_id)
      .maybeSingle();

    const typeLabel = TYPE_LABEL[request.verification_type] || 'verification';
    const isApproved = request.status === 'approved';
    // 'expired' means nobody reviewed it inside the retention window and
    // cleanup-expired-data deleted the document. Worded apart from
    // 'rejected' deliberately: "wasn't approved" would send someone off
    // to re-photograph an ID that was never the problem, and would
    // blame them for our own unworked queue.
    const isExpired = request.status === 'expired';

    const title = isApproved
      ? 'Verification approved ✅'
      : isExpired
        ? 'Please submit your ID again'
        : 'Verification update';

    const body = isApproved
      ? `Your ${typeLabel} application was approved!`
      : isExpired
        ? `We didn't get to your ${typeLabel} application in time, and the document was deleted under our retention policy. Nothing was wrong with it — please submit again and we'll review it.`
        : `Your ${typeLabel} application wasn't approved.${request.rejection_reason ? ' Reason: ' + request.rejection_reason : ''}`;

    await sendExpoPushNotification(
      profile?.push_token,
      title,
      body,
      { type: 'verification_reviewed', request_id: request.id, status: request.status }
    );

    // DELETE ON APPROVAL (10 Sep 2026). Was: kept a year, then deleted by
    // cleanup-expired-data overnight.
    //
    // The document exists to answer one question — is this person who
    // they say they are — and an admin has just answered it. From this
    // moment the photograph is pure liability: it can be breached, it
    // must be disclosed, and it protects nobody. The verification RESULT
    // (profiles.is_verified, verification_tier, operator_id_verified) is
    // untouched and permanent, so nothing about the person's standing
    // depends on the file surviving.
    //
    // Here rather than in the nightly cleanup because "on approval"
    // should mean seconds, not up to 24 hours. This function is already
    // the on-approval hook — it runs with the service role and fires
    // from the same status transition — so putting it here adds no new
    // trigger and no second thing that can silently stop running.
    //
    // REJECTED documents are deliberately NOT deleted here: they keep
    // their 90-day appeal window, because that is the case where the
    // person may well contest the decision and the image is the thing
    // in dispute.
    //
    // Fail-soft, and after the push: a storage hiccup must not cost the
    // person their notification. cleanup-expired-data still sweeps
    // approved documents as a safety net, so anything missed here is
    // caught within a day rather than lingering.
    if (isApproved && request.document_url) {
      const { error: removeError } = await supabase.storage
        .from('verification-documents')
        .remove([request.document_url]);

      if (removeError) {
        console.error('notify-verification-reviewed: document remove failed', request.id, removeError.message);
      } else {
        const { error: nullError } = await supabase
          .from('verification_requests')
          .update({ document_url: null })
          .eq('id', request.id);
        if (nullError) {
          console.error('notify-verification-reviewed: document_url null failed', request.id, nullError.message);
        }
      }
    }

    return new Response('OK', { status: 200 });
  } catch (err) {
    console.error('notify-verification-reviewed error:', err);
    return new Response('Server error', { status: 500 });
  }
});