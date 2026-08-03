// supabase/functions/notify-admin-verification/index.ts
//
// Called only by the on_verification_request_created database trigger
// (see notify-admin-verification-trigger.sql) — never by the client
// directly. Authenticated via a shared secret (X-Notify-Secret header),
// not a user JWT, since this call originates from Postgres itself, not
// a logged-in session.
//
// Sends a real push notification to every admin (profiles.is_admin =
// true) with a push_token on file — same sendExpoPushNotification
// pattern already used throughout paynow-webhook for buyer/seller
// notifications, so this doesn't invent a new notification mechanism,
// just reuses the proven one.

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

Deno.serve(async (req) => {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  // Shared-secret check — this endpoint is only ever meant to be called
  // by the database trigger, never by a user's session. A mismatched or
  // missing secret means either misconfiguration or an unauthorized
  // caller; either way, reject rather than send notifications on trust.
  const providedSecret = req.headers.get('X-Notify-Secret');
  if (!NOTIFY_SHARED_SECRET || providedSecret !== NOTIFY_SHARED_SECRET) {
    console.error('notify-admin-verification: invalid or missing shared secret');
    return new Response('Unauthorized', { status: 401 });
  }

  try {
    const { request_id, verification_type, user_id } = await req.json();

    // Who actually submitted this, for a readable notification —
    // separate query rather than an embedded select, same fix applied
    // to quotes.tsx and wanted-responses.tsx earlier this project for
    // the identical class of bug (no real FK to embed through).
    const { data: applicant } = await supabase
      .from('profiles')
      .select('full_name')
      .eq('id', user_id)
      .maybeSingle();

    const { data: admins, error: adminsError } = await supabase
      .from('profiles')
      .select('push_token')
      .eq('is_admin', true)
      .not('push_token', 'is', null);

    if (adminsError) {
      console.error('notify-admin-verification: failed to fetch admins', adminsError.message);
      return new Response('DB error', { status: 500 });
    }

    const typeLabel = TYPE_LABEL[verification_type] ?? verification_type;
    const applicantName = applicant?.full_name || 'Someone';

    await Promise.all(
      (admins ?? []).map((admin) =>
        sendExpoPushNotification(
          admin.push_token,
          'New verification to review 🪪',
          `${applicantName} submitted a ${typeLabel} ID for review.`,
          { type: 'admin_verification_pending', request_id }
        )
      )
    );

    return new Response('OK', { status: 200 });
  } catch (err) {
    console.error('notify-admin-verification error:', err);
    return new Response('Server error', { status: 500 });
  }
});