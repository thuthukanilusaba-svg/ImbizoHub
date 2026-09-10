// supabase/functions/notify-stale-meetpay/index.ts
//
// Chases, then closes, a Meet & Pay handover that was never arranged.
//
// THE GAP THIS FILLS. Nothing closed an abandoned session. Four were
// open in production when this was written, the oldest nine days old,
// and in every one the seller had never agreed and no PIN had ever
// been generated — buyers who tapped "Arrange deal" and got silence.
//
// Worse than untidy: create_meetpay_session() hands back an existing
// pending session for the same reference rather than creating a new
// one, so those buyers could not start again with anyone else on that
// listing. Closing the dead session is what frees them, and it needs
// no further change — the next attempt simply finds nothing pending.
//
// TWO STAGES, MIRRORING notify-stale-wants:
//
//   24 hours  nudge whoever the deal is actually waiting on
//   7 days    close it, and tell both sides
//
// WHO IS THE DEAL WAITING ON. The seller, whenever seller_agreed_at is
// null — agreeing is the one blocked step and only they can take it.
// Once they have agreed, the next move is physical (meet, then the
// seller generates a PIN), and no push makes that happen sooner, so
// nobody is nudged for it. The session is still marked as nudged
// either way, so it is considered once and never again.
//
// WHY IT DOES NOT WRITE INTO THE CHAT. decline_meetpay posts a message
// because a real person really said something. Here nobody did.
// Writing "I can't make this meetup" into a thread under someone's own
// name because a cron job fired would be putting words in their mouth.
// The status change plus these pushes are the honest version, and
// chat.tsx renders the closed state for both sides on its own.
//
// SEND-ONCE via stale_nudge_sent_at, the same pattern as
// notify-stale-wants and notify-registration-expiring. Expiry needs no
// marker: it changes status, so the row stops matching.
//
// Supports ?dry=1 to see exactly what it would do, which is worth
// running before the first live fire because of the backlog.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const NOTIFY_SHARED_SECRET = Deno.env.get('NOTIFY_SHARED_SECRET')!;

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

const NUDGE_HOURS = 24;
const EXPIRE_DAYS = 7;

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

// The chat a session belongs to, so a tapped push lands in the right
// thread rather than on a generic screen.
function chatRouteFor(s: any): string {
  if (s.type === 'listing') return `/chat?listing_id=${s.reference_id}`;
  if (s.type === 'item_request') return `/chat?item_request_id=${s.reference_id}`;
  return '/chat';
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  const providedSecret = req.headers.get('X-Notify-Secret');
  if (!NOTIFY_SHARED_SECRET || providedSecret !== NOTIFY_SHARED_SECRET) {
    console.error('notify-stale-meetpay: invalid or missing shared secret');
    return new Response('Unauthorized', { status: 401 });
  }

  const dryRun = new URL(req.url).searchParams.get('dry') === '1';

  const results = {
    dry_run: dryRun,
    nudges_planned: 0,
    nudges_sent: 0,
    expired: 0,
    expiry_notices_sent: 0,
    plan: [] as string[],
    errors: [] as string[],
  };

  try {
    const now = Date.now();
    const nudgeCutoff = new Date(now - NUDGE_HOURS * 60 * 60 * 1000).toISOString();
    const expireCutoff = new Date(now - EXPIRE_DAYS * 24 * 60 * 60 * 1000).toISOString();

    const { data: pending, error: pendingError } = await supabase
      .from('meetpay_sessions')
      .select('id, type, reference_id, buyer_id, seller_id, created_at, seller_agreed_at, stale_nudge_sent_at')
      .eq('status', 'pending')
      .lt('created_at', nudgeCutoff)
      .order('created_at');

    if (pendingError) {
      results.errors.push(`pending fetch: ${pendingError.message}`);
      return new Response(JSON.stringify(results), { status: 500, headers: { 'Content-Type': 'application/json' } });
    }
    if (!pending || pending.length === 0) {
      return new Response(JSON.stringify(results), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }

    // Every token in one query rather than one per person.
    const userIds = new Set<string>();
    for (const s of pending as any[]) {
      if (s.buyer_id) userIds.add(s.buyer_id);
      if (s.seller_id) userIds.add(s.seller_id);
    }
    const { data: profiles } = await supabase
      .from('profiles')
      .select('id, push_token, full_name')
      .in('id', Array.from(userIds));

    const tokenFor = new Map<string, string | null>();
    const nameFor = new Map<string, string>();
    for (const p of profiles ?? []) {
      tokenFor.set(p.id, p.push_token);
      nameFor.set(p.id, p.full_name || 'Someone');
    }

    for (const s of pending as any[]) {
      const tooOld = s.created_at < expireCutoff;

      // ---- 7 days: close it -------------------------------------
      if (tooOld) {
        results.plan.push(`expire ${s.id} (${s.type}, opened ${s.created_at})`);
        if (dryRun) continue;

        // The RPC returns null if it was confirmed or cancelled between
        // the query above and now, which is the whole reason the update
        // is conditional rather than blind.
        const { data: closed, error: expireError } = await supabase
          .rpc('expire_meetpay_session', { p_session_id: s.id });

        if (expireError) {
          results.errors.push(`expire ${s.id}: ${expireError.message}`);
          continue;
        }
        if (!closed) continue;

        results.expired++;

        const route = chatRouteFor(s);
        for (const uid of [s.buyer_id, s.seller_id]) {
          if (!uid) continue;
          const sent = await sendExpoPushNotification(
            tokenFor.get(uid),
            'Meetup closed',
            'This handover was never arranged, so we have closed it. Nothing was charged — you can arrange a new one any time.',
            { type: 'meetpay_expired', session_id: s.id, route }
          );
          if (sent) results.expiry_notices_sent++;
        }
        continue;
      }

      // ---- 24 hours: nudge whoever is holding it up --------------
      if (s.stale_nudge_sent_at) continue;

      // Only the seller can take the one blocked step. Once they have
      // agreed, what remains is meeting in person, and no notification
      // makes that happen sooner.
      const target = s.seller_agreed_at ? null : s.seller_id;

      if (target) {
        results.nudges_planned++;
        results.plan.push(`nudge seller on ${s.id} (${s.type})`);
      }

      if (dryRun) continue;

      if (target) {
        const waitingName = nameFor.get(s.buyer_id) ?? 'Someone';
        const sent = await sendExpoPushNotification(
          tokenFor.get(target),
          'Someone is waiting on you',
          `${waitingName} asked to arrange a handover a day ago. Open the chat to agree a time — or say you can't make it.`,
          { type: 'meetpay_waiting', session_id: s.id, route: chatRouteFor(s) }
        );
        if (sent) results.nudges_sent++;
      }

      // Marked whether or not a push left, and whether or not there was
      // anyone to nudge: this session has now had its one consideration.
      const { error: markError } = await supabase
        .from('meetpay_sessions')
        .update({ stale_nudge_sent_at: new Date().toISOString() })
        .eq('id', s.id);
      if (markError) results.errors.push(`mark ${s.id}: ${markError.message}`);
    }

    return new Response(JSON.stringify(results), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('notify-stale-meetpay error:', err);
    return new Response(JSON.stringify({ ...results, fatal: String(err) }), { status: 500 });
  }
});
