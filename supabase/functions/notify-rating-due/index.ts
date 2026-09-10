// supabase/functions/notify-rating-due/index.ts
//
// Asks both sides to rate a Meet & Pay deal, ONE HOUR after it was
// confirmed — not at the moment of confirmation.
//
// WHY THE DELAY. Sealed ratings (10 Sep) stop you seeing the other
// person's rating before writing yours. That is worthless at the exact
// point the app used to ask: meetpay.tsx pushed straight to /rating the
// instant the handover PIN confirmed, when buyer and seller are
// standing next to each other. Blinding does nothing about reading the
// other person's screen, or about "give me five and I'll give you
// five" said out loud. The mechanism was weakest precisely where it was
// used most.
//
// An hour is enough for them to have walked away from each other, and
// it also fixes something blinding never could: the old flow asked for
// a verdict before the buyer had used the thing they just bought.
//
// CIVIL HOURS, ENFORCED BY THE SCHEDULE, NOT BY CODE. The cron runs
// hourly from 05:00 to 18:00 UTC only — 07:00 to 20:00 in Harare. A
// deal confirmed at 21:00 local is therefore prompted at 07:00 the next
// morning rather than at 22:00 that night. Putting the quiet hours in
// the schedule rather than in an if-statement means there is no clock
// arithmetic here to get wrong, and the rule is visible in cron.job.
//
// Send-once via meetpay_sessions.rating_prompt_sent_at, the same
// pattern as notify-stale-wants and notify-registration-expiring: an
// hourly job with no marker re-notifies the same pair every hour for
// ever.
//
// WHAT THIS DOES NOT DO: it does not chase. One prompt per deal, to
// each side that has not already rated. Somebody who ignores it is
// telling you something, and a second push would not change it.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const NOTIFY_SHARED_SECRET = Deno.env.get('NOTIFY_SHARED_SECRET')!;

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

const DELAY_HOURS = 1;

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
    console.error('notify-rating-due: invalid or missing shared secret');
    return new Response('Unauthorized', { status: 401 });
  }

  const dryRun = new URL(req.url).searchParams.get('dry') === '1';

  const results = {
    dry_run: dryRun,
    sessions_due: 0,
    prompts_sent: 0,
    already_rated_skipped: 0,
    plan: [] as string[],
    errors: [] as string[],
  };

  try {
    const cutoff = new Date(Date.now() - DELAY_HOURS * 60 * 60 * 1000).toISOString();

    // confirmed_at rather than created_at: the clock starts when the
    // deal actually completed, not when the session was opened, and a
    // Meet & Pay session can sit open for days before the handover.
    const { data: sessions, error: sessionsError } = await supabase
      .from('meetpay_sessions')
      .select('id, buyer_id, seller_id, type, confirmed_at')
      .eq('status', 'confirmed')
      .is('rating_prompt_sent_at', null)
      .not('confirmed_at', 'is', null)
      .lt('confirmed_at', cutoff);

    if (sessionsError) {
      results.errors.push(`sessions fetch: ${sessionsError.message}`);
      return new Response(JSON.stringify(results), { status: 500, headers: { 'Content-Type': 'application/json' } });
    }
    if (!sessions || sessions.length === 0) {
      return new Response(JSON.stringify(results), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }

    results.sessions_due = sessions.length;

    // Who has already rated, across every due session, in one query.
    const sessionIds = sessions.map((s: any) => s.id);
    const { data: existing } = await supabase
      .from('ratings')
      .select('meetpay_session_id, reviewer_id')
      .in('meetpay_session_id', sessionIds);

    const rated = new Set<string>();
    for (const r of existing ?? []) rated.add(`${r.meetpay_session_id}:${r.reviewer_id}`);

    // Every push token needed, in one query rather than one per person.
    const userIds = new Set<string>();
    for (const s of sessions as any[]) {
      if (s.buyer_id) userIds.add(s.buyer_id);
      if (s.seller_id) userIds.add(s.seller_id);
    }

    const { data: profiles } = await supabase
      .from('profiles')
      .select('id, push_token')
      .in('id', Array.from(userIds));

    const tokenFor = new Map<string, string | null>();
    for (const p of profiles ?? []) tokenFor.set(p.id, p.push_token);

    for (const s of sessions as any[]) {
      const isTrip = s.type === 'van_hire';

      for (const side of ['buyer', 'seller'] as const) {
        const uid = side === 'buyer' ? s.buyer_id : s.seller_id;
        if (!uid) continue;

        // Somebody who already rated from the receipt screen does not
        // need reminding, and pushing them would read as the app not
        // noticing what they did.
        if (rated.has(`${s.id}:${uid}`)) {
          results.already_rated_skipped++;
          continue;
        }

        results.plan.push(`${side} on ${s.id}`);
        if (dryRun) continue;

        const sent = await sendExpoPushNotification(
          tokenFor.get(uid),
          isTrip ? 'How was the trip?' : 'How did the deal go?',
          isTrip
            ? 'Rate the other side — they cannot see what you said until they have rated too.'
            : 'Rate the other side — they cannot see what you said until they have rated too.',
          // role is carried so _layout.tsx can label the rating screen
          // correctly on tap — the screen re-derives who is being rated
          // from the session itself and does not trust this.
          { type: 'rating_due', session_id: s.id, role: side }
        );
        if (sent) results.prompts_sent++;
      }

      if (dryRun) continue;

      // Marked whether or not a push actually left — best effort, not a
      // retry queue, and the same call notify-registration-expiring
      // makes. Marked per SESSION, so one prompt covers both sides and
      // neither gets chased twice.
      const { error: markError } = await supabase
        .from('meetpay_sessions')
        .update({ rating_prompt_sent_at: new Date().toISOString() })
        .eq('id', s.id);
      if (markError) results.errors.push(`mark ${s.id}: ${markError.message}`);
    }

    return new Response(JSON.stringify(results), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('notify-rating-due error:', err);
    return new Response(JSON.stringify({ ...results, fatal: String(err) }), { status: 500 });
  }
});
