-- 20260910180000_double_blind_ratings.sql
--
-- Double-blind ratings for Meet & Pay.
--
-- THE PROBLEM, in this database's own numbers: 16 ratings, 16 of them
-- five stars, 2 with any text at all. That is not 16 excellent
-- transactions, it is reciprocity pressure. Both people can see what the
-- other wrote before deciding what to write, they expect to deal with
-- each other again in a small city, and the rational move is to give
-- five stars and hope for five back. Adding tags helped the emptiness
-- but could not touch the cause.
--
-- THE FIX: neither rating is visible until BOTH are in, or 14 days pass.
-- You write yours without knowing theirs, so there is nothing to
-- retaliate against and nothing to reward.
--
-- WHAT MADE THIS MORE THAN A `published` FLAG: profiles.rating and
-- rating_count were updated INSIDE submit_rating at insert time. Hiding
-- the row while moving the average is not double-blind at all — the
-- other person watches their own average shift and knows exactly what
-- they were given. The aggregate had to move to publish time too, and
-- that is the part that could have silently defeated the whole feature.
--
-- SCOPE — MEET & PAY ONLY. submit_delivery_rating is one-directional
-- (only the buyer rates, the driver never rates back — see the
-- `v_reviewer_id != v_booking.buyer_id` guard in it). There is no
-- reciprocal rating to wait for, so delivery ratings publish
-- immediately. Blinding them would hide them for 14 days in exchange for
-- nothing.

begin;

-- ---------------------------------------------------------------------
-- 1. published_at
-- ---------------------------------------------------------------------
alter table public.ratings
  add column if not exists published_at timestamptz;

-- Existing rows are already public and have been for weeks. Retroactively
-- hiding them would be a strange thing to do to people who already saw
-- them, and they are all five stars anyway.
update public.ratings set published_at = created_at where published_at is null;

comment on column public.ratings.published_at is
  'When this rating became visible to anyone other than its author. Null = written but still blind. Set when the counterparty rates the same Meet & Pay session, or by publish_due_ratings() after 14 days. Delivery ratings are set immediately - they are one-directional.';

create index if not exists ratings_unpublished_idx
  on public.ratings (created_at)
  where published_at is null;

-- ---------------------------------------------------------------------
-- 2. Who can see what
-- ---------------------------------------------------------------------
-- Your own rating stays visible to you always — you wrote it, and a
-- screen that forgets what you just submitted reads as a bug.
drop policy if exists "Anyone can view ratings" on public.ratings;

create policy "Published ratings are public"
  on public.ratings for select
  using (published_at is not null or reviewer_id = auth.uid());

-- ---------------------------------------------------------------------
-- 3. Publishing, and the aggregate that moves with it
-- ---------------------------------------------------------------------
-- One place that knows how to reveal a rating, used by both the
-- reciprocity path and the 14-day sweep. Keeping the aggregate update
-- here rather than duplicating it is the whole point: two copies of this
-- arithmetic would drift, and the way it fails is a rating average that
-- is quietly wrong for ever.
create or replace function public.publish_rating(p_rating_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  r record;
begin
  select * into r from ratings where id = p_rating_id and published_at is null
  for update;

  if not found then
    return; -- already published, or gone. Idempotent on purpose.
  end if;

  update ratings set published_at = now() where id = p_rating_id;

  -- role = 'buyer' means the REVIEWER was buying, so the reviewee was
  -- the seller: their seller-side average moves. Mirrors exactly what
  -- submit_rating used to do inline.
  if r.role = 'buyer' then
    update profiles
    set rating_count = coalesce(rating_count, 0) + 1,
        rating = ((coalesce(rating, 0) * coalesce(rating_count, 0)) + r.stars)
                 / (coalesce(rating_count, 0) + 1)
    where id = r.reviewee_id;
  else
    update profiles
    set buyer_rating_count = coalesce(buyer_rating_count, 0) + 1,
        buyer_rating = ((coalesce(buyer_rating, 0) * coalesce(buyer_rating_count, 0)) + r.stars)
                       / (coalesce(buyer_rating_count, 0) + 1)
    where id = r.reviewee_id;
  end if;
end;
$function$;

revoke execute on function public.publish_rating(uuid) from public, anon, authenticated;
grant execute on function public.publish_rating(uuid) to service_role;

-- ---------------------------------------------------------------------
-- 4. submit_rating — insert blind, publish only when both are in
-- ---------------------------------------------------------------------
create or replace function public.submit_rating(
  p_session_id uuid,
  p_stars integer,
  p_review text default null,
  p_tags text[] default null
)
returns json
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_session record;
  v_reviewer_id uuid;
  v_reviewee_id uuid;
  v_role text;
  v_existing_id uuid;
  v_new_id uuid;
  v_other_id uuid;
  v_i_confirmed boolean;
begin
  v_reviewer_id := auth.uid();
  if v_reviewer_id is null then
    raise exception 'Not authenticated';
  end if;

  if p_stars < 1 or p_stars > 5 then
    raise exception 'Rating must be between 1 and 5 stars';
  end if;

  select * into v_session from meetpay_sessions where id = p_session_id;
  if not found then
    raise exception 'Transaction not found';
  end if;

  v_i_confirmed :=
    (v_reviewer_id = v_session.buyer_id  and v_session.buyer_confirmed_at is not null)
    or
    (v_reviewer_id = v_session.seller_id and v_session.operator_confirmed_at is not null);

  if v_session.status != 'confirmed'
     and not (v_session.type = 'van_hire' and v_i_confirmed) then
    raise exception 'This transaction has not been confirmed yet';
  end if;

  if v_reviewer_id = v_session.buyer_id then
    v_reviewee_id := v_session.seller_id;
    v_role := 'buyer';
  elsif v_reviewer_id = v_session.seller_id then
    v_reviewee_id := v_session.buyer_id;
    v_role := 'seller';
  else
    raise exception 'You were not part of this transaction';
  end if;

  select id into v_existing_id from ratings
  where meetpay_session_id = p_session_id and reviewer_id = v_reviewer_id;

  if v_existing_id is not null then
    return json_build_object('status', 'already_rated', 'rating_id', v_existing_id);
  end if;

  begin
    -- NO published_at, and NO aggregate update. Both happen only in
    -- publish_rating() below, and only once the other side is in.
    insert into ratings (meetpay_session_id, reviewer_id, reviewee_id, listing_id, stars, review, role, tags)
    values (
      p_session_id, v_reviewer_id, v_reviewee_id,
      case when v_session.type = 'listing' then v_session.reference_id::bigint else null end,
      p_stars, nullif(trim(p_review), ''), v_role,
      case when p_tags is null or array_length(p_tags, 1) is null then null else p_tags end
    )
    returning id into v_new_id;
  exception
    when unique_violation then
      select id into v_existing_id from ratings
      where meetpay_session_id = p_session_id and reviewer_id = v_reviewer_id;
      return json_build_object('status', 'already_rated', 'rating_id', v_existing_id);
  end;

  -- Has the other person already rated this same session?
  select id into v_other_id from ratings
  where meetpay_session_id = p_session_id
    and reviewer_id = v_reviewee_id
    and published_at is null;

  if v_other_id is not null then
    -- Both are in. Reveal them together, in the same transaction, so
    -- there is no instant where one is visible and the other is not.
    perform publish_rating(v_new_id);
    perform publish_rating(v_other_id);
    return json_build_object('status', 'submitted', 'published', true);
  end if;

  return json_build_object('status', 'submitted', 'published', false);
end;
$function$;

revoke execute on function public.submit_rating(uuid, integer, text, text[]) from public, anon;
grant execute on function public.submit_rating(uuid, integer, text, text[]) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- 5. The 14-day release
-- ---------------------------------------------------------------------
-- Without this, a rating whose counterparty never rates back is hidden
-- for ever — and most will never rate back. That would make the feature
-- strictly worse than what it replaced: fewer visible ratings, not
-- fairer ones.
--
-- 14 days is long enough that reciprocity is genuinely dead, and short
-- enough that an honest review still lands while the deal is remembered.
create or replace function public.publish_due_ratings()
returns integer
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  r record;
  n integer := 0;
begin
  for r in
    select id from ratings
    where published_at is null
      and created_at < now() - interval '14 days'
    order by created_at
  loop
    perform publish_rating(r.id);
    n := n + 1;
  end loop;
  return n;
end;
$function$;

revoke execute on function public.publish_due_ratings() from public, anon, authenticated;
grant execute on function public.publish_due_ratings() to service_role;

-- ---------------------------------------------------------------------
-- 6. Delivery ratings publish on the spot
-- ---------------------------------------------------------------------
-- Only the buyer ever rates a delivery, so there is no second rating to
-- wait for. The single line added is published_at in the two inserts;
-- the aggregate updates stay exactly where they were.
create or replace function public.submit_delivery_rating(
  p_booking_id uuid,
  p_target text,
  p_stars integer,
  p_review text default null
)
returns json
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_booking record;
  v_reviewer_id uuid;
  v_reviewee_id uuid;
  v_existing_id uuid;
  v_new_rating numeric;
  v_new_count integer;
begin
  v_reviewer_id := auth.uid();
  if v_reviewer_id is null then
    raise exception 'Not authenticated';
  end if;

  if p_stars < 1 or p_stars > 5 then
    raise exception 'Rating must be between 1 and 5 stars';
  end if;

  if p_target not in ('seller', 'driver') then
    raise exception 'Invalid rating target';
  end if;

  select * into v_booking from delivery_bookings where id = p_booking_id;
  if not found then
    raise exception 'Delivery booking not found';
  end if;

  if v_booking.status != 'confirmed' then
    raise exception 'This delivery has not been confirmed yet';
  end if;

  if v_reviewer_id != v_booking.buyer_id then
    raise exception 'You were not the buyer on this delivery';
  end if;

  select id into v_existing_id
  from ratings
  where delivery_booking_id = p_booking_id
    and reviewer_id = v_reviewer_id
    and target = p_target;

  if v_existing_id is not null then
    return json_build_object('status', 'already_rated', 'rating_id', v_existing_id);
  end if;

  begin
    if p_target = 'seller' then
      v_reviewee_id := v_booking.seller_id;
      if v_reviewee_id is null then
        raise exception 'No seller on this booking';
      end if;

      insert into ratings (delivery_booking_id, reviewer_id, reviewee_id, listing_id, stars, review, role, target, published_at)
      values (p_booking_id, v_reviewer_id, v_reviewee_id, v_booking.listing_id, p_stars, nullif(trim(p_review), ''), 'buyer', 'seller', now());

      update profiles
      set
        rating_count = coalesce(rating_count, 0) + 1,
        rating = ((coalesce(rating, 0) * coalesce(rating_count, 0)) + p_stars) / (coalesce(rating_count, 0) + 1)
      where id = v_reviewee_id
      returning rating, rating_count into v_new_rating, v_new_count;
    else
      if v_booking.operator_id is null then
        raise exception 'No driver assigned to this booking';
      end if;
      v_reviewee_id := v_booking.operator_id;

      insert into ratings (delivery_booking_id, reviewer_id, reviewee_id, listing_id, stars, review, role, target, published_at)
      values (p_booking_id, v_reviewer_id, v_reviewee_id, v_booking.listing_id, p_stars, nullif(trim(p_review), ''), 'buyer', 'driver', now());

      update delivery_operators
      set
        rating_count = coalesce(rating_count, 0) + 1,
        rating = ((coalesce(rating, 0) * coalesce(rating_count, 0)) + p_stars) / (coalesce(rating_count, 0) + 1)
      where id = v_booking.operator_id
      returning rating, rating_count into v_new_rating, v_new_count;

      if not found then
        raise exception 'Driver record not found';
      end if;
    end if;
  exception
    when unique_violation then
      select id into v_existing_id
      from ratings
      where delivery_booking_id = p_booking_id
        and reviewer_id = v_reviewer_id
        and target = p_target;
      return json_build_object('status', 'already_rated', 'rating_id', v_existing_id);
  end;

  return json_build_object('status', 'submitted', 'new_rating', v_new_rating, 'new_count', v_new_count);
end;
$function$;

revoke execute on function public.submit_delivery_rating(uuid, text, integer, text) from public, anon;
grant execute on function public.submit_delivery_rating(uuid, text, integer, text) to authenticated, service_role;

commit;
