// supabase/functions/notify-new-rating/index.ts
//
// Closes a real gap: no notification currently fires when someone
// receives a rating — they'd only find out by checking their own
// profile. Built against the CONFIRMED real schema (ratings.reviewee_id,
// reviewer_id, stars, review, listing_id — checked directly via
// information_schema before writing this, not guessed).
//
// Expected trigger payload: { rating_id: uuid }

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
    console.error('notify-new-rating: invalid or missing shared secret');
    return new Response('Unauthorized', { status: 401 });
  }

  try {
    const { rating_id } = await req.json();
    if (!rating_id) return new Response('Missing rating_id', { status: 400 });

    const { data: rating, error: ratingError } = await supabase
      .from('ratings')
      .select('id, reviewer_id, reviewee_id, stars, listing_id')
      .eq('id', rating_id)
      .maybeSingle();

    if (ratingError || !rating) {
      console.error('notify-new-rating: no matching rating', rating_id);
      return new Response('No matching rating', { status: 200 });
    }

    const [reviewerProfile, revieweeProfile] = await Promise.all([
      supabase.from('profiles').select('full_name').eq('id', rating.reviewer_id).maybeSingle(),
      supabase.from('profiles').select('push_token').eq('id', rating.reviewee_id).maybeSingle(),
    ]);

    const reviewerName = reviewerProfile.data?.full_name || 'Someone';
    const stars = '⭐'.repeat(Math.max(1, Math.min(5, rating.stars || 0)));

    await sendExpoPushNotification(
      revieweeProfile.data?.push_token,
      'New rating received',
      `${reviewerName} rated you ${stars}`,
      { type: 'new_rating', rating_id: rating.id }
    );

    return new Response('OK', { status: 200 });
  } catch (err) {
    console.error('notify-new-rating error:', err);
    return new Response('Server error', { status: 500 });
  }
});