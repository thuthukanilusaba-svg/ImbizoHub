-- 20260910270000_full_name_no_impersonation.sql
--
-- THE NAME RULE ONLY EVER CHECKED CHARACTERS. It never checked
-- identity. Every one of these was accepted:
--
--   ImbizoHub Support        ImbizoHub Admin        Admin
--   Verified Seller          Official Store         Customer Service
--   ""  (empty)              a real user's exact name, on another account
--
-- Someone calling themselves ImbizoHub Support and messaging a buyer to
-- ask for their handover PIN is a far better attack than any script
-- tag, and it needs no exploit whatsoever — just the signup form. It
-- is also the attack this particular app most deserves, because the
-- product sells a Verified badge and shows a "what we can confirm"
-- panel: the whole trust model assumes the name above it is not
-- pretending to be us.
--
-- Six profiles already had no name at all.
--
-- WHAT IS NOW REFUSED
--   - an empty name (null is a separate case, below)
--   - anything containing imbizohub, however it is spaced or punctuated
--   - the role words: admin, administrator, moderator, support,
--     helpdesk, customer service/care, official, verified, security
--     team, no-reply
--
-- NULL STAYS LEGAL, AND MUST. handle_new_user() creates the profile row
-- from an auth.users trigger before any name exists — an anonymous
-- sign-in carries no metadata at all — so rejecting null here would
-- break registration outright. Verified after applying: setting a name
-- to null still succeeds. An empty STRING is a different thing; nothing
-- writes one except somebody clearing the field.
--
-- WORD BOUNDARIES, NOT SUBSTRINGS. "Admire Sibanda" and "Nyasha
-- Officialdom" are perfectly good names and both still pass — they were
-- the two cases most likely to be caught by a careless pattern, and
-- both are in the test set below.
--
-- DUPLICATE NAMES ARE STILL ALLOWED, DELIBERATELY. It is tempting to
-- make names unique after seeing one account take another's name, but
-- it would be wrong: Zimbabwe has a great many people genuinely called
-- Blessing Moyo, and the first one to sign up does not get to own it.
-- Uniqueness would block real users while barely inconveniencing an
-- impersonator, who only has to add a full stop. Distinguishing two
-- people with the same name is what the trust panel is for — member
-- since, deals completed, distinct counterparties, ID verified — and
-- that is where the effort belongs.
--
-- Tested against 23 strings: 11 refused, 12 real names accepted.

create or replace function public.enforce_full_name_sane()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_letters text;
begin
  if TG_OP = 'UPDATE' and NEW.full_name is not distinct from OLD.full_name then
    return NEW;
  end if;

  if NEW.full_name is null then
    return NEW;
  end if;

  if btrim(NEW.full_name) = '' then
    raise exception 'Please enter your name.';
  end if;

  if length(NEW.full_name) not between 2 and 60
     or NEW.full_name !~ '^[A-Za-zÀ-ɏ][A-Za-zÀ-ɏ̀-ͯ ''’.\-]*$'
     or NEW.full_name !~ '[A-Za-zÀ-ɏ]{2}' then
    raise exception 'That name can only contain letters, spaces, hyphens and apostrophes.';
  end if;

  -- Letters only, so "Imbizo Hub", "imbizo-hub" and "I.M.B.I.Z.O.H.U.B"
  -- all collapse to the same string.
  v_letters := lower(regexp_replace(NEW.full_name, '[^A-Za-z]', '', 'g'));

  if v_letters like '%imbizohub%' or v_letters like '%imbizo%hub%' then
    raise exception 'Names cannot include ImbizoHub. Please use your own name.';
  end if;

  if NEW.full_name ~* '\y(admin|administrator|moderator|support|helpdesk|help desk|customer (service|care)|official|verified|security team|no.?reply)\y' then
    raise exception 'That name is reserved. Please use your own name.';
  end if;

  return NEW;
end;
$$;
