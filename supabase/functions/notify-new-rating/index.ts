// supabase/functions/notify-new-rating/index.ts
//
// AUTH: verify_jwt is false. The caller is a database trigger, which
// has no user session to attach an Authorization header with; the
// shared secret below is the auth.
//
// WHAT CHANGED (10 Sep). This used to fire only on INSERT and always
// said "<name> rated you ⭐⭐". Once sealed ratings landed that was a
// hole straight through them: the app hid the other side's stars
// behind RLS and this push read them out on the lock screen. Whoever
// rated first handed their score to the person who had not rated yet
// — the exact retaliation loop blinding exists to close.
//
// The stars now only ever appear for a rating that is already
// published. Until then the reviewee is told there is something
// waiting and nothing else — no number, no adjective, nothing that
// hints at the score.
//
// The sealed nudge earns its place rather than merely being harmless:
// the only thing that unseals a rating before the 14-day timer is the
// other side rating back, so a push saying "rate them back to see it"
// is the one most likely to complete the pair.
//
// THE EVENT COMES FROM SQL, IN THE PAYLOAD. It is NOT re-derived from
// published_at here, and must not be: pg_net delivers after commit, so
// a rating that was sealed when the trigger fired and published later
// in the same transaction already reads as published by the time this
// runs. Trusting the column here produced a duplicate push to the same
// person, which is how this was caught.
//
// Payload: { rating_id: uuid, event: 'sealed' | 'published' }

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
    console.error('notify-new-rating: invalid or missing shared secret');
    return new Response('Unauthorized', { status: 401 });
  }

  try {
    const { rating_id, event } = await req.json();
    if (!rating_id) return new Response('Missing rating_id', { status: 400 });

    const { data: rating, error: ratingError } = await supabase
      .from('ratings')
      .select('id, reviewer_id, reviewee_id, stars, role, listing_id, published_at, meetpay_session_id')
      .eq('id', rating_id)
      .maybeSingle();

    if (ratingError || !rating) {
      console.error('notify-new-rating: no matching rating', rating_id);
      return new Response('No matching rating', { status: 200 });
    }

    // Falling back to the column is only safe for a caller that sent no
    // event at all, which by definition predates the publish transition.
    const isPublished = event ? event === 'published' : rating.published_at !== null;

    const [reviewerProfile, revieweeProfile] = await Promise.all([
      supabase.from('profiles').select('full_name').eq('id', rating.reviewer_id).maybeSingle(),
      supabase.from('profiles').select('push_token').eq('id', rating.reviewee_id).maybeSingle(),
    ]);

    const reviewerName = reviewerProfile.data?.full_name || 'Someone';

    if (isPublished) {
      const stars = '⭐'.repeat(Math.max(1, Math.min(5, rating.stars || 0)));
      await sendExpoPushNotification(
        revieweeProfile.data?.push_token,
        'New rating received',
        `${reviewerName} rated you ${stars}`,
        { type: 'new_rating', rating_id: rating.id }
      );
      return new Response('OK published', { status: 200 });
    }

    await sendExpoPushNotification(
      revieweeProfile.data?.push_token,
      'You have a sealed rating',
      `${reviewerName} has rated you. Rate them back to unseal both.`,
      {
        type: 'rating_sealed',
        rating_id: rating.id,
        session_id: rating.meetpay_session_id,
        // The reviewee's role when they rate back is the opposite of
        // the incoming rating's. Labelling only — the rating screen and
        // submit_rating() both re-derive it from the session itself.
        role: rating.role === 'buyer' ? 'seller' : 'buyer',
      }
    );
    return new Response('OK sealed', { status: 200 });
  } catch (err) {
    console.error('notify-new-rating error:', err);
    return new Response('Server error', { status: 500 });
  }
});
