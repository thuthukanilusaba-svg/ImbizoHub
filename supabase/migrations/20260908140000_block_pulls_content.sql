-- 20260908140000_block_pulls_content.sql
--
-- Blocking an account now pulls down what it published.
--
-- WHY: admin_block_user() stopped a scammer ACTING — no new listings,
-- messages, quotes or ratings — but everything already posted stayed
-- live and reachable. Someone blocked for "took payment and did not
-- deliver" kept a working shopfront on the marketplace, and could go on
-- sharing a direct listing link on WhatsApp indefinitely.
--
-- WHAT IS PULLED, AND WHY BOTH:
--   listings      -> 'removed_by_admin'
--   open wants    -> 'withdrawn_by_admin'
-- A Wanted post is a solicitation, not just an advert. Leaving a
-- blocked scammer's want open would keep honest sellers offering him
-- prices, and each of those offers is a person who then cannot be
-- answered. Pulling the listings while leaving the wants would close
-- the front door and leave the back one open.
--
-- WHY DISTINCT STATUS VALUES rather than reusing 'sold' / 'cancelled':
-- so an unblock can restore exactly what a block took down, and nothing
-- else. If a block set listings to 'sold', unblocking would have to
-- guess which 'sold' rows were genuinely sold by the seller and which
-- were pulled by a moderator — and would either resurrect real sales or
-- strand real listings. A value nobody else writes makes the reversal
-- exact.
--
-- Every public surface already filters .eq('status','active')
-- (index.tsx, explore.tsx, seller.tsx), so a new value disappears from
-- them with no client change. listing.tsx's DETAIL page did not filter
-- at all and is fixed in the same commit as this migration.

begin;

-- ---------------------------------------------------------------------
-- 1. Allow the new want status
-- ---------------------------------------------------------------------
-- Widening again, so every existing row still satisfies it and the
-- revalidation scan cannot fail. listings.status has no CHECK at all,
-- so it needs nothing here.
alter table public.item_requests
  drop constraint if exists item_requests_status_check;

alter table public.item_requests
  add constraint item_requests_status_check
  check (status = any (array['open', 'matched', 'fulfilled', 'cancelled', 'expired', 'withdrawn_by_admin']));

-- ---------------------------------------------------------------------
-- 2. Block: suspend, pull content, notify
-- ---------------------------------------------------------------------
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

  -- ONLY 'active' listings. A listing the seller had already marked
  -- sold stays sold: it is a record of something that happened, and
  -- rewriting it would both lose that history and make the unblock
  -- restore a listing that should never come back.
  update listings
  set status = 'removed_by_admin'
  where user_id = p_user_id and status = 'active';

  -- ONLY 'open' wants, for the same reason. A want already matched or
  -- fulfilled describes a completed transaction.
  update item_requests
  set status = 'withdrawn_by_admin'
  where user_id = p_user_id and status = 'open';

  select decrypted_secret into shared_secret
  from vault.decrypted_secrets
  where name = 'admin_notify_shared_secret';

  if shared_secret is null then
    raise warning 'admin_notify_shared_secret not set in Vault - skipping block notification';
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

revoke execute on function public.admin_block_user(uuid, text) from public, anon;
grant execute on function public.admin_block_user(uuid, text) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- 3. Unblock: put back exactly what the block took
-- ---------------------------------------------------------------------
-- Also the "Lift suspension" button for TIMED suspensions, which never
-- pull content — for those the two updates below match zero rows and
-- cost nothing. Restoring is deliberately unconditional rather than
-- checking whether the person was blocked or merely suspended: if these
-- statuses exist on their rows, a moderator put them there, and lifting
-- the penalty should lift all of it.
create or replace function public.admin_unsuspend_user(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if not exists (select 1 from profiles where id = auth.uid() and is_admin = true) then
    raise exception 'Not authorized';
  end if;

  update profiles
  set suspended_until = null,
      suspension_reason = null
  where id = p_user_id;

  update listings
  set status = 'active'
  where user_id = p_user_id and status = 'removed_by_admin';

  update item_requests
  set status = 'open'
  where user_id = p_user_id and status = 'withdrawn_by_admin';
end;
$function$;

commit;
