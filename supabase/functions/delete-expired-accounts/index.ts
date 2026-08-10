// supabase/functions/delete-expired-accounts/index.ts
//
// Completes what request_account_deletion() (see account-deletion.sql)
// starts. That RPC immediately anonymizes a user's sensitive profile
// fields the moment they ask — this function is the second half: once
// 30 days have passed since that request, it fully deletes the
// underlying auth.users row via Supabase's Admin API (which requires
// the service role key — not something a plain client-callable
// Postgres function can safely do on its own).
//
// Meant to run on a schedule (e.g. daily) via a cron trigger — see
// delete-expired-accounts-cron.sql. Never called directly by the
// client.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const NOTIFY_SHARED_SECRET = Deno.env.get('NOTIFY_SHARED_SECRET')!;

const GRACE_PERIOD_DAYS = 30;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  // Same shared-secret pattern as every other server-triggered
  // function in the app — this only ever runs from the scheduled
  // cron job, never a user's own session.
  const providedSecret = req.headers.get('X-Notify-Secret');
  if (!NOTIFY_SHARED_SECRET || providedSecret !== NOTIFY_SHARED_SECRET) {
    console.error('delete-expired-accounts: invalid or missing shared secret');
    return new Response('Unauthorized', { status: 401 });
  }

  try {
    const cutoff = new Date(Date.now() - GRACE_PERIOD_DAYS * 24 * 60 * 60 * 1000).toISOString();

    const { data: expiredProfiles, error: fetchError } = await supabase
      .from('profiles')
      .select('id')
      .not('deletion_requested_at', 'is', null)
      .lt('deletion_requested_at', cutoff);

    if (fetchError) {
      console.error('delete-expired-accounts: fetch failed', fetchError.message);
      return new Response('DB error', { status: 500 });
    }

    let deleted = 0;
    let failed = 0;

    for (const profile of expiredProfiles ?? []) {
      // Admin API delete — cascades to the profiles row too, since
      // profiles.id references auth.users.id with ON DELETE CASCADE
      // (the same foreign key pattern already used throughout this
      // schema). Everything referencing this user_id elsewhere
      // (listings, messages, ratings) is left in place per the
      // retention policy's own rules for those categories — this
      // function's only job is the account/profile identity itself.
      const { error: deleteError } = await supabase.auth.admin.deleteUser(profile.id);
      if (deleteError) {
        console.error(`delete-expired-accounts: failed to delete ${profile.id}`, deleteError.message);
        failed++;
      } else {
        deleted++;
      }
    }

    return new Response(JSON.stringify({ deleted, failed }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('delete-expired-accounts error:', err);
    return new Response('Server error', { status: 500 });
  }
});