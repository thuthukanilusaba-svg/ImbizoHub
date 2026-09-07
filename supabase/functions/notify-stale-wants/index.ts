// supabase/functions/notify-stale-wants/index.ts
//
// Bounds how long a seller can be left on "Waiting".
//
// WHY: a tester with four offers out asked how he'd know whether a buyer
// was still interested, and whether a lost offer ever leaves his list.
// Underneath the question was a state with no exit: his oldest offer had
// sat unanswered since 1 Sep, and nothing in the system would ever have
// resolved it. Read receipts were the obvious-looking fix and are the
// wrong one - "buyer viewed your offer, 4 days ago" followed by silence
// is worse than silence. The seller's real problem is buyer inaction, so
// this acts on the buyer.
//
//   48 hours  -> nudge the buyer: N sellers are waiting on you
//   12 days   -> warn the buyer: this post expires in 2 days
//   14 days   -> expire it, and tell every seller still waiting
//
// THE CLOCK RUNS FROM THE OLDEST PENDING RESPONSE, not the want's
// created_at. A want posted three weeks ago that gets its first offer
// today would otherwise expire the same day, punishing the seller for
// the buyer's stale post.
//
// Wants with no pending responses are left alone entirely. Nobody is
// waiting on them, so there is nothing to rescue and no reason to
// close a buyer's post out from under him.
//
// Send-once via offers_nudge_sent_at / expiry_warned_at, the same
// pattern (and for the same reason) as notify-registration-expiring's
// expiry_reminder_sent_at: without it a scheduled run re-notifies the
// same buyer on every pass for the whole window.
//
// Runs twice daily via cron - see notify-stale-wants-cron.sql.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const NOTIFY_SHARED_SECRET = Deno.env.get('NOTIFY_SHARED_SECRET')!;

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

const NUDGE_AFTER_HOURS = 48;
const WARN_AFTER_DAYS = 12;
const EXPIRE_AFTER_DAYS = 14;

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

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
    console.error('notify-stale-wants: invalid or missing shared secret');
    return new Response('Unauthorized', { status: 401 });
  }

  // Dry run: ?dry=1 decides everything and sends and writes nothing.
  // Lets the very first run be inspected before real people are pushed.
  const dryRun = new URL(req.url).searchParams.get('dry') === '1';

  const results = {
    dry_run: dryRun,
    scanned: 0,
    nudged: 0,
    warned: 0,
    expired: 0,
    sellers_told: 0,
    plan: [] as string[],
    errors: [] as string[],
  };

  try {
    const { data: wants, error: wantsError } = await supabase
      .from('item_requests')
      .select('id, user_id, title, offers_nudge_sent_at, expiry_warned_at')
      .eq('status', 'open');

    if (wantsError) {
      results.errors.push(`wants fetch: ${wantsError.message}`);
      return new Response(JSON.stringify(results), { status: 500, headers: { 'Content-Type': 'application/json' } });
    }
    if (!wants || wants.length === 0) {
      return new Response(JSON.stringify(results), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }

    // One query for every pending response across every open want, then
    // grouped in memory. The alternative is a query per want, which on a
    // scheduled sweep is the difference between one round trip and one
    // per row.
    const wantIds = wants.map((w: any) => w.id);
    const { data: responses, error: responsesError } = await supabase
      .from('item_responses')
      .select('item_request_id, responder_id, created_at')
      .eq('status', 'pending')
      .in('item_request_id', wantIds);

    if (responsesError) {
      results.errors.push(`responses fetch: ${responsesError.message}`);
      return new Response(JSON.stringify(results), { status: 500, headers: { 'Content-Type': 'application/json' } });
    }

    type Pending = { responder_id: string; created_at: string };
    const byWant = new Map<string, Pending[]>();
    for (const r of responses ?? []) {
      const list = byWant.get(r.item_request_id) ?? [];
      list.push({ responder_id: r.responder_id, created_at: r.created_at });
      byWant.set(r.item_request_id, list);
    }

    // Every push token needed this run, in one query rather than one per
    // person.
    const userIds = new Set<string>(wants.map((w: any) => w.user_id));
    for (const list of byWant.values()) for (const p of list) userIds.add(p.responder_id);

    const { data: profiles } = await supabase
      .from('profiles')
      .select('id, push_token')
      .in('id', Array.from(userIds));

    const tokenFor = new Map<string, string | null>();
    for (const p of profiles ?? []) tokenFor.set(p.id, p.push_token);

    const now = Date.now();

    for (const want of wants as any[]) {
      const offers = byWant.get(want.id);
      // Nobody is waiting on this one. Leave the buyer's post alone.
      if (!offers || offers.length === 0) continue;

      results.scanned++;

      const oldest = Math.min(...offers.map((o) => new Date(o.created_at).getTime()));
      const age = now - oldest;

      // Ordered newest-threshold-first: a want old enough to expire must
      // expire rather than merely get warned again.
      if (age >= EXPIRE_AFTER_DAYS * DAY) {
        results.plan.push(`expire: ${want.title} (${offers.length} sellers)`);
        results.expired++;
        if (dryRun) continue;

        const { error: expireError } = await supabase
          .from('item_requests')
          .update({ status: 'expired' })
          .eq('id', want.id)
          .eq('status', 'open'); // no-op if a buyer accepted in the meantime

        if (expireError) {
          results.errors.push(`expire ${want.id}: ${expireError.message}`);
          results.expired--;
          continue;
        }

        await sendExpoPushNotification(
          tokenFor.get(want.user_id),
          'Your want has expired',
          `"${want.title}" closed after ${EXPIRE_AFTER_DAYS} days without an answer. Post it again any time.`,
          { type: 'want_expired', item_request_id: want.id }
        );

        // The sellers are the reason this function exists. Their offers
        // are left as 'pending' on purpose: my-responses.tsx derives
        // "Closed" from the WANT's status, so no write to item_responses
        // is needed and none is made.
        for (const o of offers) {
          const sent = await sendExpoPushNotification(
            tokenFor.get(o.responder_id),
            'Offer closed',
            `The buyer never answered on "${want.title}", so it has closed. Your offer is free again.`,
            { type: 'want_expired_responder', item_request_id: want.id }
          );
          if (sent) results.sellers_told++;
        }
        continue;
      }

      if (age >= WARN_AFTER_DAYS * DAY && !want.expiry_warned_at) {
        const daysLeft = EXPIRE_AFTER_DAYS - WARN_AFTER_DAYS;
        results.plan.push(`warn: ${want.title}`);
        results.warned++;
        if (dryRun) continue;

        await sendExpoPushNotification(
          tokenFor.get(want.user_id),
          'Your want closes soon',
          `${offers.length} seller${offers.length === 1 ? '' : 's'} answered "${want.title}". It closes in ${daysLeft} days if you don't pick one.`,
          { type: 'want_expiring', item_request_id: want.id }
        );
        // Marked regardless of send success - best-effort, not a retry
        // queue. Same call notify-registration-expiring makes.
        await supabase.from('item_requests')
          .update({ expiry_warned_at: new Date().toISOString() })
          .eq('id', want.id);
        continue;
      }

      if (age >= NUDGE_AFTER_HOURS * HOUR && !want.offers_nudge_sent_at) {
        results.plan.push(`nudge: ${want.title} (${offers.length} sellers)`);
        results.nudged++;
        if (dryRun) continue;

        await sendExpoPushNotification(
          tokenFor.get(want.user_id),
          'Sellers are waiting on you',
          `${offers.length} seller${offers.length === 1 ? ' has' : 's have'} sent you a price for "${want.title}". Take a look and pick one.`,
          { type: 'offers_waiting', item_request_id: want.id }
        );
        await supabase.from('item_requests')
          .update({ offers_nudge_sent_at: new Date().toISOString() })
          .eq('id', want.id);
      }
    }

    return new Response(JSON.stringify(results), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('notify-stale-wants error:', err);
    return new Response(JSON.stringify({ ...results, fatal: String(err) }), { status: 500 });
  }
});
