-- Transport: let a trip say what it is carrying.
--
-- APPLIED TO PRODUCTION 2 September 2026. This file is the record of what
-- ran, written after the fact — the migration was applied through the
-- Supabase connection before it existed on disk, which is exactly the gap
-- that makes a schema impossible to rebuild from the repo. Keep new
-- migrations here as well as applying them.
--
-- WHY. `requests` could only describe a passenger trip: it had a passenger
-- count and nothing else, so hirevan.tsx made "Number of passengers" a
-- required field and offered no way to say what you were moving. Real
-- demand ignored that. The trip posted 1 Sep 2026 (Kwekwe -> Plumtree)
-- declared "2 passengers" because the form insisted, and put the actual job
-- in the notes: "Fragile glass to be wrapped in bubble wrap". It sat open
-- and unquoted, because operator-requests.tsx showed it as "2 pax" and no
-- operator could tell there was a load to price.
--
-- WHY THE OPTIONS ARE SO FEW. Every registered operator drives an
-- 8-seater — profiles.vehicle_capacity = 8 for all four with a vehicle
-- recorded. There is no truck supply, so weight bands and vehicle classes
-- would describe capacity nobody has. Two taps is enough for an operator
-- to price a van-sized job, and offering "farm load" or "truck load" would
-- produce more unquoted requests, which is the problem being fixed rather
-- than a bigger version of the feature. Widen this when the trucks exist.
--
-- BACKWARD COMPATIBILITY. load_type is nullable and the check constraint
-- passes when it is null, deliberately: the database change reaches every
-- client the moment it is applied, but the app update rolls out over days
-- via `eas update`. An older build still posting without these columns
-- inserts cleanly and simply doesn't describe its load. Do not tighten
-- this to NOT NULL without first checking how many old installs remain.

alter table public.requests
  add column if not exists load_type text,
  add column if not exists load_size text;

alter table public.requests
  drop constraint if exists requests_load_type_valid;
alter table public.requests
  add constraint requests_load_type_valid
  check (load_type is null or load_type in ('people', 'goods', 'large_item'));

alter table public.requests
  drop constraint if exists requests_load_size_valid;
alter table public.requests
  add constraint requests_load_size_valid
  check (load_size is null or load_size in ('boot', 'van'));

-- A passenger trip needs a count; a goods trip needs a size. Neither is
-- demanded of rows that predate this migration.
alter table public.requests
  drop constraint if exists requests_load_described;
alter table public.requests
  add constraint requests_load_described
  check (
    load_type is null
    or (load_type = 'people' and passengers is not null and passengers >= 1)
    or (load_type in ('goods', 'large_item') and load_size is not null)
  );

-- Backfill. Five of the six existing trips were genuine passenger runs.
-- The sixth — the glass — is left with a null load_type rather than being
-- relabelled as something its owner never chose, so it can be re-posted
-- properly instead of having its history rewritten.
update public.requests
   set load_type = 'people', load_size = null
 where load_type is null
   and passengers is not null
   and coalesce(description, '') not ilike '%glass%';

comment on column public.requests.load_type is
  'What the trip carries: people | goods | large_item. Null on rows predating the Sep 2026 goods migration.';
comment on column public.requests.load_size is
  'Rough volume for a goods trip: boot | van. Null for passenger trips.';

-- VERIFIED LIVE, 2 September 2026
--   goods trip with a size .......... inserts
--   goods trip with no size ......... rejected by requests_load_described
--   passenger trip .................. unchanged
