// supabase/functions/notify-new-wanted-post/index.ts
//
// Closes a real gap: posting a want (post-wanted.tsx) never notified
// anyone at all — a want just sat there, only discoverable by whoever
// happened to open browse-wanted.tsx and look. Unlike every other
// notify-* trigger today (always one specific recipient — the other
// party in a chat, the operator being quoted, etc.), this is
// deliberately a SCOPED broadcast: sellers who already have an active
// listing in the SAME category as the new want, since they're the
// people most likely to actually have what's being asked for. Not a
// true mass-broadcast to every user — capped and category-scoped.
//
// Called only by a DB trigger on item_requests (see
// notify-new-wanted-post-trigger.sql) — never by the client directly.
//
// Expected trigger payload: { item_request_id: uuid }

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const NOTIFY_SHARED_SECRET = Deno.env.get('NOTIFY_SHARED_SECRET')!;

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

// Safety cap — even scoped to one category, a very active category
// could still have a large number of sellers. Notifying the 50 most
// recently active ones (rather than literally everyone who's ever
// listed in that category) keeps this genuinely useful rather than
// spammy, and keeps a single want post from firing hundreds of pushes
// at once.
const MAX_RECIPIENTS = 50;

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
    console.error('notify-new-wanted-post: invalid or missing shared secret');
    return new Response('Unauthorized', { status: 401 });
  }

  try {
    const { item_request_id } = await req.json();
    if (!item_request_id) return new Response('Missing item_request_id', { status: 400 });

    const { data: want, error: wantError } = await supabase
      .from('item_requests')
      .select('id, title, category, location, user_id')
      .eq('id', item_request_id)
      .maybeSingle();

    if (wantError || !want) {
      console.error('notify-new-wanted-post: no matching item_request', item_request_id);
      return new Response('No matching item_request', { status: 200 });
    }

    // Sellers with an active listing in the same category — the ones
    // genuinely likely to have what's being asked for. Excludes the
    // person who posted the want (in case they've also listed in this
    // category themselves — no point notifying yourself about your own
    // post). distinct user_ids, most recently active first.
    const { data: sellers, error: sellersError } = await supabase
      .from('listings')
      .select('user_id')
      .eq('category', want.category)
      .eq('status', 'active')
      .neq('user_id', want.user_id)
      .order('created_at', { ascending: false })
      .limit(MAX_RECIPIENTS * 3); // over-fetch before de-duping, since
      // multiple listings can share the same seller — de-duped below.

    if (sellersError || !sellers || sellers.length === 0) {
      return new Response('No matching sellers', { status: 200 });
    }

    const uniqueSellerIds = [...new Set(sellers.map((s) => s.user_id))].slice(0, MAX_RECIPIENTS);

    const { data: profiles } = await supabase
      .from('profiles')
      .select('id, push_token')
      .in('id', uniqueSellerIds);

    const locationSuffix = want.location ? ` in ${want.location}` : '';

    await Promise.all(
      (profiles ?? []).map((p) =>
        sendExpoPushNotification(
          p.push_token,
          'New want posted 🔍',
          `Someone's looking for "${want.title}"${locationSuffix} — got one?`,
          { type: 'new_wanted_post', item_request_id: want.id }
        )
      )
    );

    return new Response('OK', { status: 200 });
  } catch (err) {
    console.error('notify-new-wanted-post error:', err);
    return new Response('Server error', { status: 500 });
  }
});