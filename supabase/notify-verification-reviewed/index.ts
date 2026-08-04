// supabase/functions/notify-verification-reviewed/index.ts
//
// Closes a real gap: an applicant currently has no way to know their
// Verified Seller / Delivery Operator / Transport Operator verification
// was reviewed except manually re-checking their own status. Built
// against the CONFIRMED real schema (verification_requests.user_id,
// verification_type, status, rejection_reason — checked directly
// before writing this).
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
      .select('id, user_id, verification_type, status, rejection_reason')
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

    const title = isApproved ? 'Verification approved ✅' : 'Verification update';
    const body = isApproved
      ? `Your ${typeLabel} application was approved!`
      : `Your ${typeLabel} application wasn't approved.${request.rejection_reason ? ' Reason: ' + request.rejection_reason : ''}`;

    await sendExpoPushNotification(
      profile?.push_token,
      title,
      body,
      { type: 'verification_reviewed', request_id: request.id, status: request.status }
    );

    return new Response('OK', { status: 200 });
  } catch (err) {
    console.error('notify-verification-reviewed error:', err);
    return new Response('Server error', { status: 500 });
  }
});