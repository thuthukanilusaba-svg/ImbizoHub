// supabase/functions/notify-registration-expiring/index.ts
//
// Sends a real push warning to delivery/transport operators whose
// registration expires within 7 days — built specifically for the
// launch promo (free registration until Jan 31, 2027), so operators
// who signed up free don't have their access lapse silently mid-shift.
// Also works identically for normal paid annual renewals going
// forward, since it just checks registration_expires_at regardless of
// how that date was originally set.
//
// Sends each reminder exactly once (see expiry_reminder_sent_at /
// operator_expiry_reminder_sent_at, set immediately after a
// successful send) — a daily cron run would otherwise re-notify the
// same person every day for the full 7-day window.
//
// Meant to run daily via cron (see notify-registration-expiring-cron.sql).

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const NOTIFY_SHARED_SECRET = Deno.env.get('NOTIFY_SHARED_SECRET')!;

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';
const REMINDER_WINDOW_DAYS = 7;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

async function sendExpoPushNotification(
  pushToken: string | null | undefined,
  title: string,
  body: string,
  data?: Record<string, unknown>
) {
  if (!pushToken || !pushToken.startsWith('ExponentPushToken')) return false;
  try {
    const resp = await fetch(EXPO_PUSH_URL, {
      method: 'POST',
      headers: { Accept: 'application/json', 'Accept-Encoding': 'gzip, deflate', 'Content-Type': 'application/json' },
      body: JSON.stringify({ to: pushToken, sound: 'default', title, body, data: data ?? {} }),
    });
    const result = await resp.json().catch(() => null);
    if (result?.data?.status === 'error') {
      console.error('Expo push send error:', result.data.message, result.data.details);
      return false;
    }
    return true;
  } catch (err) {
    console.error('sendExpoPushNotification failed:', err);
    return false;
  }
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  const providedSecret = req.headers.get('X-Notify-Secret');
  if (!NOTIFY_SHARED_SECRET || providedSecret !== NOTIFY_SHARED_SECRET) {
    console.error('notify-registration-expiring: invalid or missing shared secret');
    return new Response('Unauthorized', { status: 401 });
  }

  const results = { delivery_reminded: 0, transport_reminded: 0, errors: [] as string[] };
  const windowEnd = new Date(Date.now() + REMINDER_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString();

  try {
    // Delivery operators
    const { data: deliveryDue, error: deliveryError } = await supabase
      .from('delivery_operators')
      .select('user_id, registration_expires_at')
      .eq('registration_paid', true)
      .is('expiry_reminder_sent_at', null)
      .not('registration_expires_at', 'is', null)
      .lt('registration_expires_at', windowEnd)
      .gt('registration_expires_at', new Date().toISOString());

    if (deliveryError) {
      results.errors.push(`delivery fetch: ${deliveryError.message}`);
    } else {
      for (const op of deliveryDue ?? []) {
        const { data: profile } = await supabase
          .from('profiles')
          .select('push_token')
          .eq('id', op.user_id)
          .maybeSingle();

        const expiryDate = new Date(op.registration_expires_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'long' });
        const sent = await sendExpoPushNotification(
          profile?.push_token,
          'Registration expiring soon ⏰',
          `Your delivery operator registration ends ${expiryDate}. Renew to keep accepting delivery jobs.`,
          { type: 'registration_expiring', operator_type: 'delivery' }
        );

        // Marked as reminded regardless of whether the push actually
        // sent (e.g. no push token on file) — this is a best-effort
        // reminder, not something to retry indefinitely once the
        // window has been checked once.
        await supabase.from('delivery_operators').update({ expiry_reminder_sent_at: new Date().toISOString() }).eq('user_id', op.user_id);
        if (sent) results.delivery_reminded++;
      }
    }

    // Transport operators
    const { data: transportDue, error: transportError } = await supabase
      .from('profiles')
      .select('id, registration_expires_at, push_token')
      .eq('account_type', 'transport_operator')
      .eq('operator_status', 'active')
      .is('operator_expiry_reminder_sent_at', null)
      .not('registration_expires_at', 'is', null)
      .lt('registration_expires_at', windowEnd)
      .gt('registration_expires_at', new Date().toISOString());

    if (transportError) {
      results.errors.push(`transport fetch: ${transportError.message}`);
    } else {
      for (const profile of transportDue ?? []) {
        const expiryDate = new Date(profile.registration_expires_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'long' });
        const sent = await sendExpoPushNotification(
          profile.push_token,
          'Registration expiring soon ⏰',
          `Your transport operator registration ends ${expiryDate}. Renew to keep bidding on trip requests.`,
          { type: 'registration_expiring', operator_type: 'transport_operator' }
        );

        await supabase.from('profiles').update({ operator_expiry_reminder_sent_at: new Date().toISOString() }).eq('id', profile.id);
        if (sent) results.transport_reminded++;
      }
    }

    return new Response(JSON.stringify(results), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('notify-registration-expiring error:', err);
    return new Response(JSON.stringify({ ...results, fatal: String(err) }), { status: 500 });
  }
});