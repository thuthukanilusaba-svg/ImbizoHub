-- Replaces the profiles_full_name_sane CHECK with a trigger that fires
-- only when full_name is actually being set or changed.
--
-- APPLIED TO PRODUCTION 3 September 2026.
--
-- THE BUG THIS FIXES, found while testing something else entirely. A CHECK
-- constraint is re-evaluated on EVERY update to the row, not only when the
-- checked column changes. NOT VALID exempts existing rows from the initial
-- validation pass — it does NOT exempt them from later updates. So the
-- moment yesterday's constraint went on, every profile whose name predated
-- the rule became frozen: 'Test2' (contains a digit) could no longer
-- change its phone number, its city, its push token or anything else,
-- because each of those updates re-checked the name and failed on a value
-- the person had never had a chance to fix.
--
-- Two rows were affected, both test accounts — luck, not design. Had any
-- of the eight real people signed up as "Nkosi2", they would have been
-- silently unable to edit their own profile, and the error would have
-- named the name constraint on an update that had nothing to do with their
-- name.
--
-- A trigger expresses the actual intent: you may not SET a bad name; a bad
-- name you already have does not brick the rest of your account. The rule
-- itself is unchanged — same characters, same length, same reasoning as
-- lib/nameValidation.ts.

alter table public.profiles drop constraint if exists profiles_full_name_sane;

create or replace function public.enforce_full_name_sane()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  -- Only when the value is actually being written or changed. An update
  -- that leaves full_name alone is none of this rule's business.
  if TG_OP = 'UPDATE' and NEW.full_name is not distinct from OLD.full_name then
    return NEW;
  end if;

  if NEW.full_name is null or NEW.full_name = '' then
    return NEW;
  end if;

  if length(NEW.full_name) not between 2 and 60
     or NEW.full_name !~ '^[A-Za-zÀ-ɏ][A-Za-zÀ-ɏ̀-ͯ ''’.\-]*$'
     or NEW.full_name !~ '[A-Za-zÀ-ɏ]{2}' then
    raise exception 'That name can only contain letters, spaces, hyphens and apostrophes.';
  end if;

  return NEW;
end;
$$;

revoke execute on function public.enforce_full_name_sane() from public, anon, authenticated;

drop trigger if exists trg_enforce_full_name_sane on public.profiles;
create trigger trg_enforce_full_name_sane
  before insert or update of full_name on public.profiles
  for each row execute function public.enforce_full_name_sane();

-- VERIFIED LIVE, 3 September 2026 (rolled back)
--   editing a legacy bad-name profile ... allowed
--   setting a new bad name .............. blocked
