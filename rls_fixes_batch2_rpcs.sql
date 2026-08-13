-- ImbizoHub RLS/RPC redesign — batch 2, part A: the RPCs
--
-- Moves every delivery_bookings / meetpay_sessions status-transition
-- write the app currently makes directly from the client into
-- SECURITY DEFINER RPCs that validate everything server-side. Right
-- now those writes are only protected by whichever guard the app's own
-- query happens to include (.eq('pin', entered), .eq('status',
-- 'requested')) — real protection, but only as strong as "the official
-- app always sends that exact query," which a participant bypassing
-- the app entirely and calling the REST API directly doesn't have to
-- respect. These RPCs make the same checks the database's problem
-- instead, matching the pattern submit_rating() already proved out
-- (derive everything from real server-side state, never trust a
-- client-supplied value for the security-critical part).
--
-- Ownership/derivation logic for create_meetpay_session mirrors
-- meetpay.tsx's own already-proven init() verification exactly (cross-
-- checking a van_hire reference_id against quotes.operator_id and,
-- via quotes.request_id, requests.user_id) rather than inventing new
-- logic — that check was itself added during an earlier security fix
-- in this same project, so it's the right thing to copy.
--
-- IMPORTANT: this is PART A only — it just creates the new functions.
-- Nothing in the app calls them yet, and nothing existing is disabled,
-- so running this part is safe at any time and changes no live
-- behavior. See rls_fixes_batch2_triggers.sql for part B, which is the
-- part that actually enforces this and must NOT run until the matching
-- app update is live.


-- ============================================================
-- delivery_bookings RPCs
-- ============================================================

create or replace function public.accept_delivery_job(p_booking_id uuid)
returns public.delivery_bookings
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_operator_id uuid;
  v_row public.delivery_bookings;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  select id into v_operator_id
  from public.delivery_operators
  where user_id = auth.uid();

  if v_operator_id is null then
    raise exception 'You are not a registered delivery operator';
  end if;

  update public.delivery_bookings
  set operator_id = v_operator_id,
      status = 'accepted',
      accepted_at = now()
  where id = p_booking_id
    and status = 'requested'
  returning * into v_row;

  if v_row.id is null then
    raise exception 'This job was just accepted by another driver';
  end if;

  return v_row;
end;
$$;

create or replace function public.mark_delivery_dispatched(p_booking_id uuid)
returns public.delivery_bookings
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_row public.delivery_bookings;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  update public.delivery_bookings b
  set status = 'dispatched',
      dispatched_at = now()
  where b.id = p_booking_id
    and b.status = 'accepted'
    and auth.uid() = (select user_id from public.delivery_operators where id = b.operator_id)
  returning * into v_row;

  if v_row.id is null then
    raise exception 'This job is not yours to update, or is not in the right state';
  end if;

  return v_row;
end;
$$;

create or replace function public.mark_delivery_delivered(p_booking_id uuid)
returns public.delivery_bookings
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_row public.delivery_bookings;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  update public.delivery_bookings b
  set status = 'delivered',
      delivered_at = now()
  where b.id = p_booking_id
    and b.status = 'dispatched'
    and auth.uid() = (select user_id from public.delivery_operators where id = b.operator_id)
  returning * into v_row;

  if v_row.id is null then
    raise exception 'This job is not yours to update, or is not in the right state';
  end if;

  return v_row;
end;
$$;

create or replace function public.generate_delivery_pin(p_booking_id uuid)
returns public.delivery_bookings
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_pin text;
  v_row public.delivery_bookings;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  v_pin := lpad(floor(random() * 10000)::text, 4, '0');

  update public.delivery_bookings
  set pin = v_pin,
      pin_expires_at = now() + interval '15 minutes'
  where id = p_booking_id
    and buyer_id = auth.uid()
  returning * into v_row;

  if v_row.id is null then
    raise exception 'This delivery is not yours';
  end if;

  return v_row;
end;
$$;

create or replace function public.confirm_delivery_pin(p_booking_id uuid, p_entered_pin text)
returns public.delivery_bookings
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_row public.delivery_bookings;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  update public.delivery_bookings b
  set status = 'confirmed',
      confirmed_at = now()
  where b.id = p_booking_id
    and b.status = 'delivered'
    and auth.uid() = (select user_id from public.delivery_operators where id = b.operator_id)
    and b.pin is not null
    and b.pin = p_entered_pin
    and b.pin_expires_at > now()
  returning * into v_row;

  if v_row.id is null then
    raise exception 'Incorrect or expired PIN, or this delivery is not ready to be confirmed';
  end if;

  return v_row;
end;
$$;


-- ============================================================
-- meetpay_sessions RPCs
-- ============================================================

create or replace function public.create_meetpay_session(p_type text, p_reference_id text, p_amount numeric default null)
returns public.meetpay_sessions
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_buyer_id uuid;
  v_seller_id uuid;
  v_pin text;
  v_pin_expires timestamptz;
  v_existing public.meetpay_sessions;
  v_row public.meetpay_sessions;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  if p_type not in ('listing', 'item_request', 'van_hire') then
    raise exception 'Invalid session type';
  end if;

  -- Re-use an existing session for this reference rather than creating
  -- a duplicate — same behavior the client-side callers already relied
  -- on (they SELECT for an existing session before ever calling this).
  select * into v_existing
  from public.meetpay_sessions
  where reference_id = p_reference_id and type = p_type
  order by created_at desc
  limit 1;

  if v_existing.id is not null then
    return v_existing;
  end if;

  if p_type = 'van_hire' then
    -- reference_id is a quotes.id. Derive both parties from the quote
    -- and its underlying trip request — never from client input — the
    -- exact cross-check meetpay.tsx's own init() already performs.
    select q.operator_id, r.user_id
    into v_seller_id, v_buyer_id
    from public.quotes q
    join public.requests r on r.id = q.request_id
    where q.id::text = p_reference_id;

    if v_seller_id is null or v_buyer_id is null then
      raise exception 'Trip not found';
    end if;
    if auth.uid() != v_seller_id and auth.uid() != v_buyer_id then
      raise exception 'This isn''t your trip';
    end if;
    -- No PIN for van_hire — mutual confirmation instead (see
    -- confirm_meetpay_trip below).
    v_pin := null;
    v_pin_expires := null;

  elsif p_type = 'listing' then
    select user_id into v_seller_id
    from public.listings
    where id = p_reference_id::bigint;

    if v_seller_id is null then
      raise exception 'Listing not found';
    end if;
    if auth.uid() = v_seller_id then
      raise exception 'You can''t start Meet & Pay on your own listing';
    end if;
    v_buyer_id := auth.uid();
    v_pin := lpad(floor(random() * 10000)::text, 4, '0');
    v_pin_expires := now() + interval '15 minutes';

  else -- item_request
    select ir.user_id into v_buyer_id
    from public.item_requests ir
    where ir.id::text = p_reference_id;

    if v_buyer_id is null then
      raise exception 'Wanted post not found';
    end if;
    if auth.uid() != v_buyer_id then
      raise exception 'Only the person who posted this want can start Meet & Pay';
    end if;

    select responder_id into v_seller_id
    from public.item_responses
    where item_request_id::text = p_reference_id
      and status = 'accepted'
    order by created_at desc
    limit 1;

    if v_seller_id is null then
      raise exception 'No accepted response found for this want yet';
    end if;
    v_pin := lpad(floor(random() * 10000)::text, 4, '0');
    v_pin_expires := now() + interval '15 minutes';
  end if;

  insert into public.meetpay_sessions
    (type, reference_id, buyer_id, seller_id, pin, pin_generated_at, pin_expires_at, amount, status)
  values
    (p_type, p_reference_id, v_buyer_id, v_seller_id, v_pin,
     case when v_pin is not null then now() else null end,
     v_pin_expires, p_amount, 'pending')
  returning * into v_row;

  return v_row;
end;
$$;

create or replace function public.regenerate_meetpay_pin(p_session_id uuid)
returns public.meetpay_sessions
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_row public.meetpay_sessions;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  update public.meetpay_sessions
  set pin = lpad(floor(random() * 10000)::text, 4, '0'),
      pin_generated_at = now(),
      pin_expires_at = now() + interval '15 minutes'
  where id = p_session_id
    and buyer_id = auth.uid()
    and status = 'pending'
    and type in ('listing', 'item_request')
  returning * into v_row;

  if v_row.id is null then
    raise exception 'Cannot regenerate a PIN for this session';
  end if;

  return v_row;
end;
$$;

create or replace function public.confirm_meetpay_pin(p_session_id uuid, p_entered_pin text)
returns public.meetpay_sessions
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_row public.meetpay_sessions;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  update public.meetpay_sessions
  set status = 'confirmed',
      confirmed_at = now(),
      confirmed_by = auth.uid()
  where id = p_session_id
    and seller_id = auth.uid()
    and status = 'pending'
    and pin is not null
    and pin = p_entered_pin
    and pin_expires_at > now()
  returning * into v_row;

  if v_row.id is null then
    raise exception 'Incorrect or expired PIN';
  end if;

  return v_row;
end;
$$;

create or replace function public.confirm_meetpay_trip(p_session_id uuid)
returns public.meetpay_sessions
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_session public.meetpay_sessions;
  v_row public.meetpay_sessions;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  select * into v_session
  from public.meetpay_sessions
  where id = p_session_id and type = 'van_hire';

  if v_session.id is null then
    raise exception 'Trip session not found';
  end if;
  if auth.uid() != v_session.buyer_id and auth.uid() != v_session.seller_id then
    raise exception 'This isn''t your trip';
  end if;
  if v_session.status = 'confirmed' then
    return v_session; -- already done — idempotent no-op
  end if;

  if auth.uid() = v_session.buyer_id then
    update public.meetpay_sessions
    set buyer_confirmed_at = coalesce(buyer_confirmed_at, now())
    where id = p_session_id
    returning * into v_row;
  else
    update public.meetpay_sessions
    set operator_confirmed_at = coalesce(operator_confirmed_at, now())
    where id = p_session_id
    returning * into v_row;
  end if;

  -- Finalize atomically in the same call if both sides are now in —
  -- closes the two-request race window the old client-side version had
  -- (read buyer/operator_confirmed_at, THEN issue a second update).
  if v_row.buyer_confirmed_at is not null and v_row.operator_confirmed_at is not null then
    update public.meetpay_sessions
    set status = 'confirmed',
        confirmed_at = now(),
        confirmed_by = auth.uid()
    where id = p_session_id
    returning * into v_row;
  end if;

  return v_row;
end;
$$;
