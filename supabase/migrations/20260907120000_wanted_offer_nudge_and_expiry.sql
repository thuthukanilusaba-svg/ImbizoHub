-- 20260907120000_wanted_offer_nudge_and_expiry.sql
--
-- WHY: a tester with four offers out asked whether a lost offer ever
-- leaves the list. Two things were wrong underneath that question.
-- The list ordering was one (fixed in my-responses.tsx). The other is
-- that "Waiting" had no end: his oldest offer had sat unanswered since
-- 1 Sep with nothing in the system that would ever resolve it. A buyer
-- who never decides leaves every seller who answered him waiting for
-- ever.
--
-- So: nudge the buyer at 48h, warn him at 12 days, expire at 14. The
-- seller's wait is now bounded, and the bound is enforced by the clock
-- rather than by the buyer's goodwill.
--
-- The clock runs from the OLDEST PENDING RESPONSE, not from the want's
-- created_at. A want posted three weeks ago that gets its first offer
-- today would otherwise expire the same day, punishing the seller for
-- the buyer's stale post.

begin;

-- ---------------------------------------------------------------------
-- 1. 'expired' as a status
-- ---------------------------------------------------------------------
-- A widening of the allowed set, so every existing row still satisfies
-- it and the revalidation scan on re-add cannot fail. (Narrowing one of
-- these is the dangerous direction — a CHECK is re-evaluated on EVERY
-- update of the row, not only when the checked column changes, so one
-- legacy bad value freezes the whole row for ever. That is what the
-- profiles_full_name_sane constraint did to Test2 on 3 Sep.)
--
-- 'cancelled' was the alternative to adding a value. It is rejected on
-- purpose: cancelled means the buyer chose to stop, expired means the
-- buyer never chose at all, and the app tells the two apart in what it
-- says to the sellers.
alter table public.item_requests
  drop constraint if exists item_requests_status_check;

alter table public.item_requests
  add constraint item_requests_status_check
  check (status = any (array['open', 'matched', 'fulfilled', 'cancelled', 'expired']));

-- ---------------------------------------------------------------------
-- 2. Send-once markers
-- ---------------------------------------------------------------------
-- Without these a daily cron re-nudges the same buyer every single day
-- of the window — the bug notify-registration-expiring already had to
-- solve with expiry_reminder_sent_at. Set immediately after the send
-- attempt, whether or not a push actually left the building: this is a
-- best-effort reminder, not a delivery guarantee to retry for ever.
alter table public.item_requests
  add column if not exists offers_nudge_sent_at timestamptz,
  add column if not exists expiry_warned_at timestamptz;

comment on column public.item_requests.offers_nudge_sent_at is
  'When the buyer was pushed about unanswered offers (48h). Null = not yet nudged. Send-once marker for notify-stale-wants.';
comment on column public.item_requests.expiry_warned_at is
  'When the buyer was warned this post is about to expire (day 12). Null = not yet warned.';

-- ---------------------------------------------------------------------
-- 3. Grants on the new columns — BELT AND BRACES, NOT LOAD-BEARING
-- ---------------------------------------------------------------------
-- I added these expecting the profiles.carries trap of 2 Sep, where a
-- new column inherited no grant because that table grants UPDATE column
-- by column, and the resulting error says "permission denied for TABLE
-- profiles" — naming the table, not the column, which is what made it
-- so slow to find.
--
-- item_requests is NOT that shape. It has TABLE-level grants to anon,
-- authenticated and service_role, so new columns are covered
-- automatically and these two statements change nothing. The reason
-- it looked otherwise is that information_schema.column_privileges
-- expands a table-level grant into one row per column, so it reads
-- exactly like a column-by-column grant. Check role_table_grants
-- before believing that view.
--
-- Left in place because they are harmless and make the intent explicit
-- if the table is ever tightened to column grants later.
grant select (offers_nudge_sent_at, expiry_warned_at)
  on public.item_requests to service_role;
grant update (offers_nudge_sent_at, expiry_warned_at)
  on public.item_requests to service_role;

-- NOTE for later, not fixed here: item_requests_update_own lets the
-- owner update ANY column of their own row, so a buyer can clear his
-- own offers_nudge_sent_at (silencing his own reminder) or set his own
-- status. Pre-existing, self-affecting only, and not worth a
-- privilege-escalation trigger of the kind item_responses carries
-- until someone actually does it.

-- ---------------------------------------------------------------------
-- 4. Index for the sweep
-- ---------------------------------------------------------------------
-- item_requests_status_idx exists but covers all four statuses. The
-- cron only ever wants open ones, and open is the shrinking minority as
-- the table grows.
create index if not exists item_requests_open_idx
  on public.item_requests (created_at)
  where status = 'open';

commit;
