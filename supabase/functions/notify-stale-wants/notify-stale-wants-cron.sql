-- notify-stale-wants-cron.sql
--
-- Schedules the stale-want sweep. Run this once, in the SQL editor,
-- AFTER the function is deployed.
--
-- TWICE DAILY, AT CIVIL HOURS. Cron is UTC; Zimbabwe is UTC+2. 07:00
-- and 15:00 UTC are 09:00 and 17:00 in Harare — morning and knock-off.
-- An hourly job would hit the 48h mark more precisely and would also
-- push people at 03:00 local, which is a worse trade than the few hours
-- of slack. In practice a nudge lands 48-62h after the first offer.
--
-- Follows the cron_http_post + vault pattern the four existing jobs
-- already use, so the shared secret is never written into the job
-- definition (cron.job is readable by anyone who can read the schema).

select cron.schedule(
  'notify-stale-wants-twice-daily',
  '0 7,15 * * *',
  $$
  select public.cron_http_post(
    'notify-stale-wants-twice-daily',
    'https://goughfxpcwxwsfthlmii.supabase.co/functions/v1/notify-stale-wants',
    jsonb_build_object(
      'Content-Type', 'application/json',
      -- The vault entry is named 'admin_notify_shared_secret'. It is NOT
      -- called NOTIFY_SHARED_SECRET — that is the name of the Deno env
      -- var the function reads it from, and using it here yields NULL
      -- silently, so every run 401s with nothing in the logs to say why.
      'X-Notify-Secret', (select decrypted_secret from vault.decrypted_secrets where name = 'admin_notify_shared_secret')
    ),
    '{}'::jsonb
  );
  $$
);

-- To confirm it registered:
--   select jobid, jobname, schedule from cron.job where jobname = 'notify-stale-wants-twice-daily';
--
-- To remove it:
--   select cron.unschedule('notify-stale-wants-twice-daily');
