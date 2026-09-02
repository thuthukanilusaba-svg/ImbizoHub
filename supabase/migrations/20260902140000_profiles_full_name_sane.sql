-- A name must look like a name.
--
-- APPLIED TO PRODUCTION 2 September 2026.
--
-- WHY. Registration accepted anything at all, and the table proves it:
-- one row's full_name is  '  or  "  — a SQL injection probe typed into
-- the sign-up form by a person or a scanner. It never did any damage
-- (supabase-js parameterises every query, so it was only ever stored as
-- text), but it should not have been accepted, and the same field would
-- as happily have held a URL, an emoji wall, or "ImbizoHub Support".
-- Two other rows carry trailing spaces because register.tsx stored the
-- raw string without trimming.
--
-- THE IMPERSONATION CASE MATTERS MORE THAN THE PUNCTUATION. This is a
-- marketplace where strangers agree to meet and hand over money. A seller
-- who can call themselves "ImbizoHub Official" is impersonating the one
-- party everyone in the transaction is trusting. The reserved-word list
-- lives in lib/nameValidation.ts (it needs case- and spacing-insensitive
-- matching that is clumsy in a CHECK); this constraint covers the
-- character rule, which is the half a database can express well.
--
-- WHAT IS ALLOWED, and why it is not simply A-Z. Real names here carry
-- double-barrelled surnames (Sibanda-Lusaba), apostrophes (N'dlovu, and
-- the typographic U+2019 iOS substitutes as you type), and accented
-- letters from neighbouring countries (José, Nuño). A rule that rejects
-- any of those tells a real person their real name is invalid — a worse
-- failure than accepting a bad one.
--
-- WHY A CONSTRAINT AS WELL AS THE APP CHECK. The app rule ships in
-- JavaScript delivered over the air, so an older install keeps writing
-- under the old rule for days after an update. The database is the one
-- place a rule reaches every client at once.
--
-- NOT VALID IS DELIBERATE. It applies to every future write while leaving
-- existing rows alone — including the injection probe, which is left in
-- place rather than quietly edited, because it is evidence of someone
-- testing this form and it belongs to a test account worth looking at.
-- Once the old rows are cleaned:
--     alter table public.profiles validate constraint profiles_full_name_sane;

alter table public.profiles
  drop constraint if exists profiles_full_name_sane;

alter table public.profiles
  add constraint profiles_full_name_sane
  check (
    full_name is null
    or full_name = ''
    or (
      length(full_name) between 2 and 60
      and full_name ~ '^[A-Za-zÀ-ɏ][A-Za-zÀ-ɏ̀-ͯ ''’.\-]*$'
      -- Two letters in a row somewhere, so "A ." and "- -" cannot pass.
      and full_name ~ '[A-Za-zÀ-ɏ]{2}'
    )
  )
  not valid;

comment on constraint profiles_full_name_sane on public.profiles is
  'Names: letters (incl. accented), spaces, hyphens, apostrophes, full stops. 2-60 chars. Added 2 Sep 2026 after an injection probe was found stored as a full_name. NOT VALID — existing rows exempt until cleaned.';

-- VERIFIED LIVE, 2 September 2026 (rolled back)
--   rejected 6/6:  '  or  "  ·  <script>x</script>  ·  https://spam.example
--                  ·  Nkosi123  ·  🔥🔥🔥  ·  A
--   accepted 6/6:  Thuthukani Lusaba · Sibanda-Lusaba · N'dlovu
--                  · José Nuño · T. Lusaba · Sindiso
