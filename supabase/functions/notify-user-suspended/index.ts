// supabase/functions/notify-user-suspended/index.ts
//
// admin_suspend_user() has always ended by posting to
// /functions/v1/notify-user-suspended — but that function was never
// written. Its folder in this repo was empty and nothing was deployed,
// so every suspension since the feature shipped has posted to a 404.
//
// The suspension itself still took effect: admin_suspend_user does the
// UPDATE first and the notification is fail-soft. What never happened is
// the person being told. They found out by being blocked mid-action with
// no explanation and no idea how long it lasts.
//
// Nothing surfaced this because a trigger's net.http_post() is
// fire-and-forget: it returns as soon as the request is queued, so a 404
// arriving later is discarded unseen. Same blind spot that hid three dead
// cron jobs.
//
// Expected payload from admin_suspend_user():
//   { user_id: uuid, days: number, reason: text | null }
//
// Modelled on notify-verification-reviewed, which is the closest existing
// shape: same shared-secret check, same Expo push helper, same fail-soft
// 200 when there is nobody to notify.

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
    console.error('notify-user-suspended: invalid or missing shared secret');
    return new Response('Unauthorized', { status: 401 });
  }

  try {
    const { user_id, days, reason } = await req.json();
    if (!user_id) return new Response('Missing user_id', { status: 400 });

    // suspended_until is read from the row rather than recomputed from
    // `days`, so the date the person is told matches the date actually
    // enforced even if the two ever drift.
    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('push_token, suspended_until, suspension_reason')
      .eq('id', user_id)
      .maybeSingle();

    if (profileError || !profile) {
      console.error('notify-user-suspended: no matching profile', user_id);
      // 200, not 404: the suspension is already applied and this call is
      // only the courtesy notice. A non-2xx here would show up as a
      // scheduled-job failure without anything actionable behind it.
      return new Response('No matching profile', { status: 200 });
    }

    let untilLabel = '';
    if (profile.suspended_until) {
      untilLabel = new Date(profile.suspended_until).toLocaleDateString('en-GB', {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
      });
    } else if (typeof days === 'number' && days > 0) {
      untilLabel = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toLocaleDateString('en-GB', {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
      });
    }

    const statedReason = profile.suspension_reason ?? reason ?? null;

    const body =
      `Your account is suspended${untilLabel ? ` until ${untilLabel}` : ''}.` +
      (statedReason ? ` Reason: ${statedReason}.` : '') +
      ' Contact support if you believe this is a mistake.';

    await sendExpoPushNotification(
      profile.push_token,
      'Your account has been suspended',
      body,
      { type: 'account_suspended', suspended_until: profile.suspended_until ?? null }
    );

    return new Response('OK', { status: 200 });
  } catch (err) {
    console.error('notify-user-suspended error:', err);
    return new Response('Server error', { status: 500 });
  }
});
