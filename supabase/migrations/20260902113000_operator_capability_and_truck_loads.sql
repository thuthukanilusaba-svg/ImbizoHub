-- Operators declare what they can carry; trips can now be truck-sized.
--
-- APPLIED TO PRODUCTION 2 September 2026.
--
-- WHY. Transport gained goods earlier the same day, but the customer's
-- size options stopped at "a van load" because every registered operator
-- drove an 8-seater, and offering a truck option would have produced posts
-- nobody could quote — the failure that left the Kwekwe -> Plumtree glass
-- job unanswered.
--
-- That was right on the day and wrong as a design. It baked a snapshot of
-- supply into the customer's form, so the day a truck operator registered,
-- a person would have had to notice and edit the app. Now the operator
-- declares capability and the customer's options are derived from it:
-- hirevan.tsx shows "A truck load" only while an active operator with
-- max_load_size = 'truck' exists, and the option turns itself off again if
-- every such operator lapses.
--
--   profiles.max_load_size  boot | van | truck — the biggest job they take
--   profiles.carries        people | goods | both
--
-- NULL MEANS "NOT ASKED YET", NEVER "CANNOT CARRY". The five operators
-- registered before this migration have null in both columns.
-- operator-requests.tsx's canServe() treats null as unrestricted, so none
-- of them silently stops being shown work because of a question they were
-- never given — they are the only supply this marketplace has. Any future
-- screen that filters on these columns must keep that rule.

alter table public.profiles
  add column if not exists max_load_size text,
  add column if not exists carries text;

alter table public.profiles
  drop constraint if exists profiles_max_load_size_valid;
alter table public.profiles
  add constraint profiles_max_load_size_valid
  check (max_load_size is null or max_load_size in ('boot', 'van', 'truck'));

alter table public.profiles
  drop constraint if exists profiles_carries_valid;
alter table public.profiles
  add constraint profiles_carries_valid
  check (carries is null or carries in ('people', 'goods', 'both'));

-- Trips may now be truck-sized. Replaces the two-value constraint added
-- with the goods migration earlier today.
alter table public.requests
  drop constraint if exists requests_load_size_valid;
alter table public.requests
  add constraint requests_load_size_valid
  check (load_size is null or load_size in ('boot', 'van', 'truck'));

comment on column public.profiles.max_load_size is
  'Largest job this operator can take: boot | van | truck. NULL = not asked yet, treated as unrestricted.';
comment on column public.profiles.carries is
  'people | goods | both. NULL = not asked yet, treated as both.';

-- VERIFIED LIVE, 2 September 2026 (in a rolled-back transaction)
--   truck-sized trip ............... inserts
--   operator with max_load_size truck / carries goods ... accepted
--   existing five operators ........ untouched, both columns still null
