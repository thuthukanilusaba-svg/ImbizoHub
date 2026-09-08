-- 20260908090000_block_user_permanently.sql
--
-- Adds a permanent block for scammers, and makes the reason reach the
-- person reliably rather than only by push.
--
-- WHAT WAS ALREADY THERE: admin_suspend_user(user_id, days, reason)
-- writes suspended_until + suspension_reason and posts to
-- notify-user-suspended, which is deployed and does send the reason in
-- the push body. The gaps were that every suspension had to end, that
-- the "reason" was whichever category the REPORTER picked rather than a
-- moderator's own words, and that push is the only channel — no token,
-- notifications off, or a missed notification and the person never
-- learns anything.

begin;

-- ---------------------------------------------------------------------
-- 1. admin_block_user — permanent, reason mandatory
-- ---------------------------------------------------------------------
-- 'infinity' rather than a new is_blocked column, or now() + 100 years.
--
-- The whole enforcement layer is five triggers calling
-- enforce_not_suspended(), which tests `suspended_until > now()`.
-- 'infinity'::timestamptz > now() is true for ever, so a block needs NO
-- change to any of them and cannot be missed by one that got forgotten.
-- A boolean column would have to be added to all five tests, and
-- now() + 100 years is a lie that silently expires in 2126.
--
-- admin_unsuspend_user() already sets suspended_until = null, so it
-- lifts a block too. No separate unblock is needed.
create or replace function public.admin_block_user(
  p_user_id uuid,
  p_reason text
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  shared_secret text;
  project_url text := 'https://goughfxpcwxwsfthlmii.supabase.co';
begin
  if not exists (select 1 from profiles where id = auth.uid() and is_admin = true) then
    raise exception 'Not authorized';
  end if;

  -- Mandatory, unlike admin_suspend_user's optional p_reason. A block is
  -- permanent and the person is owed a statement of why; an empty reason
  -- would produce "Your account has been blocked. Reason: ." and leave
  -- them nothing to appeal against.
  if p_reason is null or btrim(p_reason) = '' then
    raise exception 'A reason is required when blocking an account';
  end if;

  update profiles
  set suspended_until = 'infinity'::timestamptz,
      suspension_reason = btrim(p_reason)
  where id = p_user_id;

  if not found then
    raise exception 'No such user';
  end if;

  -- Fail-soft notification, same reasoning as admin_suspend_user: a
  -- missing Vault secret must not stop the block from taking effect.
  select decrypted_secret into shared_secret
  from vault.decrypted_secrets
  where name = 'admin_notify_shared_secret';

  if shared_secret is null then
    raise warning 'admin_notify_shared_secret not set in Vault — skipping block notification';
    return;
  end if;

  perform net.http_post(
    url := project_url || '/functions/v1/notify-user-suspended',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'X-Notify-Secret', shared_secret
    ),
    body := jsonb_build_object(
      'user_id', p_user_id,
      'days', null,
      'permanent', true,
      'reason', btrim(p_reason)
    )
  );
end;
$function$;

-- Matches the lockdown of 2 Sep: no PUBLIC, no anon. The is_admin check
-- inside is the real guard, but an un-revoked SECURITY DEFINER function
-- is exactly the shape that lockdown existed to remove.
revoke execute on function public.admin_block_user(uuid, text) from public, anon;
grant execute on function public.admin_block_user(uuid, text) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- 2. Tell the person WHY, at the moment they are stopped
-- ---------------------------------------------------------------------
-- This is the reliable channel. The push may never arrive — no token,
-- notifications denied, app uninstalled and reinstalled — but this text
-- is raised the instant they try to post, message, quote or rate, and
-- the app surfaces it directly.
--
-- Two fixes beyond the block wording:
--   * the reason was never included at all, so even a correctly
--     delivered suspension said only "until 14 Sep 2026".
--   * to_char('infinity', 'DD Mon YYYY') returns NULL, not a word, so a
--     blocked user would have read "suspended until  and cannot post."
--     with a hole in the sentence.
create or replace function public.enforce_not_suspended()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_user_col text := TG_ARGV[0];
  v_action   text := TG_ARGV[1];
  v_uid      uuid;
  v_until    timestamptz;
  v_reason   text;
  v_why      text;
begin
  execute format('select ($1).%I', v_user_col) into v_uid using NEW;

  -- No owner on the row (anonymous or system-written): nothing to check.
  if v_uid is null then
    return NEW;
  end if;

  select suspended_until, suspension_reason
    into v_until, v_reason
  from public.profiles where id = v_uid;

  if v_until is null or v_until <= now() then
    return NEW;
  end if;

  v_why := case
             when v_reason is null or btrim(v_reason) = '' then ''
             else ' Reason: ' || v_reason || '.'
           end;

  if v_until = 'infinity'::timestamptz then
    raise exception 'Your account has been blocked and you cannot %.% Contact support@imbizohub.com if you believe this is a mistake.',
      v_action, v_why;
  end if;

  raise exception 'Your account is suspended until % and cannot %.%',
    to_char(v_until, 'DD Mon YYYY'), v_action, v_why;
end;
$function$;

commit;
