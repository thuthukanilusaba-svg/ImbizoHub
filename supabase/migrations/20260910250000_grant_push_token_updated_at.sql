-- 20260910250000_grant_push_token_updated_at.sql
--
-- EVERY PUSH NOTIFICATION THIS APP HAS EVER SENT WENT NOWHERE.
--
-- Found while checking who would actually receive the stale-meetup
-- nudges: zero rows in profiles have a push_token. Not few. Zero, out
-- of 19 accounts.
--
-- profiles has NO table-level UPDATE for `authenticated` — only
-- column-level grants (this is deliberate; it is what stops a client
-- writing its own rating or verification status). push_token is in
-- that list. push_token_updated_at, added later for the retention
-- policy's stale-token cleanup, never was. And savePushToken() set
-- both in ONE statement:
--
--   .update({ push_token: token, push_token_updated_at: ... })
--
-- One UPDATE touching one ungranted column fails in its entirety.
-- Proven by running that exact statement as `authenticated`:
--
--   savePushToken() as the app sends it -> 42501 permission denied
--                                          for table profiles
--   push_token column alone             -> SUCCEEDED
--
-- Note what the error names: the TABLE, not the column — which is why
-- reading it would not have pointed at the cause. And savePushToken()
-- never checked the returned error, so it failed silently on every
-- launch, for every user, from the day the timestamp column was added.
--
-- This is the third instance of the same shape in this project:
-- 20260902160000 (new operator columns) and the document_url NOT NULL
-- bug. An unchecked write plus a schema change that quietly withdrew
-- permission for it. The lesson each time is the same — a write that
-- matters must report failure.
--
-- THE GRANT MATTERS ON ITS OWN. It fixes every copy of the app already
-- installed on a phone, with no update needed there. The client change
-- (writing one column, and checking the error) ships alongside it, but
-- nobody has to take it for notifications to start working.

grant update (push_token_updated_at) on public.profiles to authenticated;

-- The timestamp now tells the truth whoever writes it.
-- cleanup-expired-data clears any token not refreshed in six months,
-- so this value decides when a real person stops being notified. That
-- should not be something the client can get wrong, or set to a date
-- of its choosing.
create or replace function public.stamp_push_token_updated_at()
returns trigger
language plpgsql
set search_path to 'public', 'pg_temp'
as $$
begin
  if new.push_token is distinct from old.push_token then
    new.push_token_updated_at := now();
  end if;
  return new;
end;
$$;

drop trigger if exists trg_stamp_push_token_updated_at on public.profiles;

create trigger trg_stamp_push_token_updated_at
before update of push_token on public.profiles
for each row
execute function public.stamp_push_token_updated_at();
