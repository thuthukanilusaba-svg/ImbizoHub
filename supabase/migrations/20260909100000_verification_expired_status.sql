-- 20260909100000_verification_expired_status.sql
--
-- Closes a hole in the retention promise: an ID document that nobody
-- ever reviews was kept for ever.
--
-- cleanup-expired-data deletes rejected documents after 90 days and
-- approved ones after a year. It has no branch for submissions still
-- sitting at 'pending_review', so the one case where the file is
-- retained indefinitely is the case where nobody is even looking at
-- it. With verification currently unused (0 requests, 0 verified
-- profiles) a pending backlog is exactly what switching it on for
-- service providers would produce.
--
-- A NOTE ON THE STATUS VALUE, because it nearly bit me: the pending
-- status is 'pending_review', NOT 'pending'. A cleanup branch written
-- as .eq('status','pending') would match zero rows for ever and look
-- like a working feature — no error, no failed run, an empty result
-- indistinguishable from "nothing to do yet".
--
-- WHY 'expired' RATHER THAN REUSING 'rejected':
-- Rejecting says we looked and said no. Expiring says we never looked.
-- The person is owed the difference — the first implies something was
-- wrong with their document, the second is our failure, and telling
-- them the first would send someone off to re-photograph a perfectly
-- good ID. Same principle as the mandatory block reason: say what
-- actually happened.

begin;

-- ---------------------------------------------------------------------
-- 1. Allow the new status
-- ---------------------------------------------------------------------
-- A widening, so every existing row still satisfies it. (And there are
-- no rows at all today, which is the cheapest possible moment to be
-- doing this.)
alter table public.verification_requests
  drop constraint if exists verification_requests_status_check;

alter table public.verification_requests
  add constraint verification_requests_status_check
  check (status = any (array['pending_review', 'approved', 'rejected', 'expired']));

-- ---------------------------------------------------------------------
-- 2. Tell the person
-- ---------------------------------------------------------------------
-- notify_verification_reviewed() only fired for 'approved' and
-- 'rejected'. Without adding 'expired' here, expiring a submission
-- would silently delete someone's document and leave them waiting on a
-- review that is never coming — worse than the bug being fixed, since
-- at least today the row still exists.
--
-- The early-return guard on old.status is kept exactly as it was: it is
-- what stops cleanup-expired-data's document_url nulling from
-- re-notifying people about verifications reviewed a year ago.
create or replace function public.notify_verification_reviewed()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  shared_secret text;
  project_url text := 'https://goughfxpcwxwsfthlmii.supabase.co';
begin
  -- Only fires on the actual transition into a finished state — not on
  -- every update to an already-finished row.
  if new.status not in ('approved', 'rejected', 'expired')
     or old.status is not distinct from new.status then
    return new;
  end if;

  select decrypted_secret into shared_secret
  from vault.decrypted_secrets
  where name = 'admin_notify_shared_secret';

  if shared_secret is null then
    raise warning 'admin_notify_shared_secret not set in Vault - skipping verification notification';
    return new;
  end if;

  perform net.http_post(
    url := project_url || '/functions/v1/notify-verification-reviewed',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'X-Notify-Secret', shared_secret
    ),
    body := jsonb_build_object('request_id', new.id)
  );

  return new;
end;
$function$;

commit;
