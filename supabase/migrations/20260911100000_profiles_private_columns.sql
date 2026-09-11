-- 20260911100000_profiles_private_columns.sql
--
-- EVERY COLUMN OF EVERY PROFILE WAS READABLE BY ANYONE.
--
-- `profiles_select_all` is `true` and anon held SELECT at table level,
-- so the public anon key — which ships inside the app bundle, by
-- design, and is downloadable by anyone — returned all 19 profiles with
-- all 41 columns. Verified by querying as the anon role: 13 real phone
-- numbers came back without an account.
--
-- Also exposed: push_token (a SEND capability — once tokens start
-- saving, anyone could push a notification to every user, in an app
-- that sells a Verified badge and has just had to block people calling
-- themselves "ImbizoHub Support"), verification_document_url,
-- suspension_reason, verification_rejection_reason, commission_owed,
-- deletion_requested_at, and is_admin, which names the one account
-- worth attacking.
--
-- Three problems in one. Personal data, under the act POTRAZ
-- registration is being weighed against. The unlock fee's entire
-- product is a phone number, sold to people who could already read it.
-- And a directory of who to target.
--
-- WHY RLS COULD NOT FIX IT. RLS is row-level: a policy either returns
-- the row or it does not, and every column comes with it. Column-level
-- grants are the only per-column mechanism, and they are per-ROLE, so
-- they cannot express "your own phone yes, everyone else's no". Hence
-- an RPC for the own-row case, and one for the single legitimate
-- cross-user read.
--
-- A COLUMN-LEVEL REVOKE DOES NOT SUBTRACT FROM A TABLE-LEVEL GRANT.
-- The first attempt at this was `revoke select (phone, ...)`, which ran
-- without error and changed nothing at all — Postgres records table and
-- column grants separately and the broader one wins. Caught only
-- because the probe was re-run afterwards: all 13 numbers still came
-- back. It is the push_token bug of the night before, run backwards —
-- there a column grant was too narrow and a write failed silently, here
-- a table grant was too broad and a revoke failed silently. The lesson
-- is the same both ways: state grants per column, then TEST the result.

-- ── 1. Your own profile, in full ────────────────────────────────────
-- SECURITY DEFINER so it keeps working once the columns come off the
-- table, and keyed on auth.uid() so it can only ever return the
-- caller's own row.
create or replace function public.my_profile()
returns public.profiles
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_row public.profiles;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;
  select * into v_row from public.profiles where id = auth.uid();
  return v_row;
end;
$$;

revoke all on function public.my_profile() from public, anon;
grant execute on function public.my_profile() to authenticated;

-- ── 2. The one cross-user read that legitimately needs a phone ──────
-- quotes.tsx fetched the phone of EVERY operator who had quoted, on
-- load, and merely hid it in the UI until the quote was accepted and
-- the fee paid. The gate was decorative: every number was already on
-- the device before anyone paid, visible in the network tab. That is
-- both the leak and the revenue hole, since the number is what the fee
-- buys.
--
-- The server decides now: the caller must own the request, and the
-- quote must be accepted AND paid. No rows otherwise.
create or replace function public.operator_contact_for_quote(p_quote_id bigint)
returns table (full_name text, phone text, base_city text)
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_me uuid := auth.uid();
begin
  if v_me is null then
    raise exception 'Not authenticated';
  end if;

  return query
  select p.full_name, p.phone, p.base_city
  from quotes q
  join requests r on r.id = q.request_id
  join profiles p on p.id = q.operator_id
  where q.id = p_quote_id
    and r.user_id = v_me
    and q.status = 'accepted'
    and q.deposit_paid;
end;
$$;

revoke all on function public.operator_contact_for_quote(bigint) from public, anon;
grant execute on function public.operator_contact_for_quote(bigint) to authenticated;

-- ── 3. Take the private columns off the public API ──────────────────
-- Drop the table-level grant first, THEN name what is public. Doing
-- only the second half is what silently failed.
--
-- Revoked from authenticated as well as anon, deliberately: signing up
-- is free, so a rule that stopped only anonymous callers would stop
-- nobody — the phone numbers would be one registration away.
revoke select on public.profiles from anon, authenticated;

-- Everything below is already shown to someone who is not signed in, on
-- a listing card, a public seller profile or the transport directory.
-- These columns ARE the product.
grant select (
  id,
  full_name,
  avatar_url,
  account_type,
  country,
  created_at,
  location,
  base_city,
  rating,
  rating_count,
  buyer_rating,
  buyer_rating_count,
  is_verified,
  verified_expires_at,
  dealer_pro_active,
  dealer_pro_expires_at,
  operator_status,
  registration_paid,
  registration_expires_at,
  suspended_until,
  vehicle_type,
  vehicle_capacity,
  licence_plate,
  carries,
  max_load_size,
  operating_area
) on public.profiles to anon, authenticated;

-- Verified after applying, as anon AND as a signed-in user: phone,
-- push_token, is_admin, verification_document_url and suspension_reason
-- all refused; public browsing unaffected. Seventeen real client
-- queries were replayed under the new grants — ten unchanged, seven
-- moved to my_profile() or operator_contact_for_quote().
