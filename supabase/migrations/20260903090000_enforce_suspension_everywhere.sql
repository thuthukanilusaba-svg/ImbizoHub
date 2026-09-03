-- Suspension now actually suspends.
--
-- APPLIED TO PRODUCTION 3 September 2026.
--
-- WHAT IT DID BEFORE. Exactly two triggers enforced suspended_until:
-- enforce_not_suspended_listings and enforce_not_suspended_messages. So a
-- suspended account could not post a listing or send a message — and could
-- still post Wanted posts, respond to Wanted posts, post trips, submit
-- quotes and leave ratings. Somebody suspended for scamming buyers on
-- listings could carry straight on through the Wanted tab, which is the
-- part of this app that actually moves money.
--
-- One parameterised function replaces writing the same twelve lines five
-- more times. Each trigger passes the column holding the acting user, and
-- a verb for the message — an error that names the action ("cannot respond
-- to a Wanted post") is the difference between a person understanding they
-- are suspended and thinking the app is broken.
--
-- The two original functions are deliberately left alone. They work, they
-- are referenced by existing triggers, and rewriting working enforcement
-- to save a few lines is the kind of tidying that introduces a gap.

create or replace function public.enforce_not_suspended()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_col text := TG_ARGV[0];
  v_action   text := TG_ARGV[1];
  v_uid      uuid;
  v_until    timestamptz;
begin
  execute format('select ($1).%I', v_user_col) into v_uid using NEW;

  -- No owner on the row (anonymous or system-written): nothing to check.
  if v_uid is null then
    return NEW;
  end if;

  select suspended_until into v_until from public.profiles where id = v_uid;

  if v_until is not null and v_until > now() then
    raise exception 'Your account is suspended until % and cannot %.',
      to_char(v_until, 'DD Mon YYYY'), v_action;
  end if;

  return NEW;
end;
$$;

revoke execute on function public.enforce_not_suspended() from public, anon, authenticated;

drop trigger if exists trg_enforce_not_suspended_wanted_posts on public.item_requests;
create trigger trg_enforce_not_suspended_wanted_posts
  before insert on public.item_requests
  for each row execute function public.enforce_not_suspended('user_id', 'post a Wanted post');

drop trigger if exists trg_enforce_not_suspended_wanted_responses on public.item_responses;
create trigger trg_enforce_not_suspended_wanted_responses
  before insert on public.item_responses
  for each row execute function public.enforce_not_suspended('responder_id', 'respond to a Wanted post');

drop trigger if exists trg_enforce_not_suspended_trips on public.requests;
create trigger trg_enforce_not_suspended_trips
  before insert on public.requests
  for each row execute function public.enforce_not_suspended('user_id', 'post a trip');

drop trigger if exists trg_enforce_not_suspended_quotes on public.quotes;
create trigger trg_enforce_not_suspended_quotes
  before insert on public.quotes
  for each row execute function public.enforce_not_suspended('operator_id', 'send a quote');

drop trigger if exists trg_enforce_not_suspended_ratings on public.ratings;
create trigger trg_enforce_not_suspended_ratings
  before insert on public.ratings
  for each row execute function public.enforce_not_suspended('reviewer_id', 'leave a rating');

-- VERIFIED LIVE, 3 September 2026 (rolled back). With a suspended account:
--   Wanted post ......... blocked
--   Wanted response ..... blocked
--   Trip ................ blocked
--   Message ............. blocked
-- And an unsuspended account could still post a Wanted post.
