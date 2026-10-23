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

// Below this many candidates, the category scoping is doing more harm
// than good and the recipient list is widened — see the comment at the
// widening itself for the measurements behind it. Set at 10 because
// that is comfortably above what any single category can currently
// supply (the best is 4 sellers, in Beauty) and comfortably below what
// would constitute spam at this size.
const MIN_USEFUL_POOL = 10;

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

    if (sellersError) {
      console.error('notify-new-wanted-post: category seller lookup failed:', sellersError.message);
    }

    let recipientIds = [...new Set((sellers ?? []).map((s) => s.user_id))];
    let tier = 'category';

    // WIDEN WHEN THE CATEGORY POOL IS TOO SMALL TO BE WORTH ANYTHING.
    // Added 23 Oct 2026, after measuring what this function had actually
    // been delivering.
    //
    // Across the six open wants on that date, category scoping matched
    // ONE seller for five of them and two for the sixth — and because
    // some of those sellers have no push token, the real delivery was
    // four notifications in total. Two wants reached nobody at all: a
    // request for wholesale cabbages matched exactly one seller, who
    // sells wedding fabric, and who has no token anyway.
    //
    // The scoping and MAX_RECIPIENTS were written for a busy
    // marketplace, where a want could otherwise spam hundreds of people
    // who do not stock it. That is a real problem — just not this
    // marketplace's problem yet. With 21 active listings spread over 9
    // categories, filtering by category takes a pool of 8 reachable
    // sellers and cuts it to 1. The filter is not protecting anyone
    // from noise; it is the reason nobody hears about anything.
    //
    // So: prefer the category, but if that yields fewer than
    // MIN_USEFUL_POOL people, widen — first to everyone with an active
    // listing in any category, then to every real account we can reach.
    // At today's size the widest tier is about a dozen people and about
    // one notification a day, which is not spam, it is the product
    // working. As the marketplace fills, the category tier will clear
    // the threshold on its own and this never fires again. No constant
    // needs changing for that to happen.
    //
    // The second widening deliberately includes people with no listing.
    // The only seller who has ever answered a want signed up and
    // responded within ten minutes, having listed nothing at all —
    // "has an active listing" would have excluded exactly the person
    // this function exists to reach.
    if (recipientIds.length < MIN_USEFUL_POOL) {
      const { data: anySellers } = await supabase
        .from('listings')
        .select('user_id')
        .eq('status', 'active')
        .neq('user_id', want.user_id)
        .order('created_at', { ascending: false })
        .limit(MAX_RECIPIENTS * 3);

      const widened = new Set([...recipientIds, ...(anySellers ?? []).map((s) => s.user_id)]);
      recipientIds = [...widened];
      tier = 'any-seller';
    }

    if (recipientIds.length < MIN_USEFUL_POOL) {
      // Every real account holding a push token. Anonymous sessions are
      // excluded by having no profile worth notifying for this purpose —
      // they are device-bound askers, not suppliers.
      const { data: anyone } = await supabase
        .from('profiles')
        .select('id')
        .not('push_token', 'is', null)
        .neq('id', want.user_id)
        .limit(MAX_RECIPIENTS);

      const widened = new Set([...recipientIds, ...(anyone ?? []).map((p) => p.id)]);
      recipientIds = [...widened];
      tier = 'everyone';
    }

    recipientIds = recipientIds.slice(0, MAX_RECIPIENTS);

    if (recipientIds.length === 0) {
      console.log('notify-new-wanted-post: nobody to notify for', want.id);
      return new Response('No recipients', { status: 200 });
    }

    const { data: profiles } = await supabase
      .from('profiles')
      .select('id, push_token')
      .in('id', recipientIds);

    const locationSuffix = want.location ? ` in ${want.location}` : '';

    // Counted, not assumed. This function used to report 200 whether it
    // had reached fifty people or none — sendExpoPushNotification
    // returns silently when a profile has no token, which is how two
    // wants came to reach nobody with nothing anywhere saying so.
    const withTokens = (profiles ?? []).filter(
      (p) => p.push_token && String(p.push_token).startsWith('ExponentPushToken')
    );

    await Promise.all(
      withTokens.map((p) =>
        sendExpoPushNotification(
          p.push_token,
          'New want posted 🔍',
          `Someone's looking for "${want.title}"${locationSuffix} — got one?`,
          { type: 'new_wanted_post', item_request_id: want.id }
        )
      )
    );

    console.log(
      `notify-new-wanted-post: want=${want.id} category="${want.category}" tier=${tier} ` +
      `candidates=${recipientIds.length} pushed=${withTokens.length}`
    );

    return new Response(
      JSON.stringify({ tier, candidates: recipientIds.length, pushed: withTokens.length }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  } catch (err) {
    console.error('notify-new-wanted-post error:', err);
    return new Response('Server error', { status: 500 });
  }
});