-- Structured feedback on a rating, instead of only a free text box.
--
-- APPLIED TO PRODUCTION 3 September 2026.
--
-- WHY. All 16 ratings in this app were 5 stars, and 14 of them had no text
-- at all. The two that did read "Awesome" and "5 star". Asked to write a
-- review with no prompt, people type one word — and a profile showing
-- "★★★★★ · From a seller" tells the next buyer nothing about whether it is
-- safe to meet this person. Which is the entire job of a rating here.
--
-- Tags are tapped, not typed. People will tap "Late" when they would never
-- compose a sentence saying so, and unlike free text a tag aggregates:
-- "As described (6)" is something a profile can show. The list is short and
-- concrete — every tag names something the other person could have done
-- differently. No "friendly", no "professional", nothing that is a mood.
--
-- NOT ADDRESSED HERE, and it is the bigger one: every rating in this app
-- is reciprocal, given minutes after a deal both sides just agreed went
-- fine, with each knowing the other is about to rate them back. That is
-- what produces 16/16 five stars, and tags will not fix it. The structural
-- answer is double-blind — neither side sees the other's rating until both
-- have rated or a week passes — which is where eBay and Airbnb both ended
-- up after exactly this problem.

alter table public.ratings
  add column if not exists tags text[];

alter table public.ratings
  drop constraint if exists ratings_tags_known;
alter table public.ratings
  add constraint ratings_tags_known
  check (
    tags is null
    or (
      array_length(tags, 1) between 1 and 4
      and tags <@ array[
        'as_described', 'on_time', 'easy_to_deal_with', 'fair_price',
        'not_as_described', 'late', 'hard_to_reach', 'pushed_off_app'
      ]::text[]
    )
  );

comment on column public.ratings.tags is
  'Tapped feedback chips, constrained by ratings_tags_known. Added 3 Sep 2026 because free-text reviews were arriving as "Awesome".';

-- submit_rating gains p_tags.
--
-- DROPPED AND RECREATED rather than adding an overload: two functions
-- differing only by a defaulted trailing argument makes every existing
-- 3-argument call ambiguous, and PostgREST would begin failing on calls
-- that worked yesterday. The body is otherwise unchanged from the version
-- that has been running — including the already_rated handling and the
-- atomic aggregate update, neither of which was worth re-deriving.
drop function if exists public.submit_rating(uuid, integer, text);

create function public.submit_rating(
  p_session_id uuid,
  p_stars integer,
  p_review text default null,
  p_tags text[] default null
)
returns json
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_session record;
  v_reviewer_id uuid;
  v_reviewee_id uuid;
  v_role text;
  v_existing_id uuid;
  v_new_rating numeric;
  v_new_count integer;
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
    insert into ratings (meetpay_session_id, reviewer_id, reviewee_id, listing_id, stars, review, role, tags)
    values (
      p_session_id, v_reviewer_id, v_reviewee_id,
      case when v_session.type = 'listing' then v_session.reference_id::bigint else null end,
      p_stars, nullif(trim(p_review), ''), v_role,
      case when p_tags is null or array_length(p_tags, 1) is null then null else p_tags end
    );

    if v_role = 'buyer' then
      update profiles
      set rating_count = coalesce(rating_count, 0) + 1,
          rating = ((coalesce(rating, 0) * coalesce(rating_count, 0)) + p_stars)
                   / (coalesce(rating_count, 0) + 1)
      where id = v_reviewee_id
      returning rating, rating_count into v_new_rating, v_new_count;
    else
      update profiles
      set buyer_rating_count = coalesce(buyer_rating_count, 0) + 1,
          buyer_rating = ((coalesce(buyer_rating, 0) * coalesce(buyer_rating_count, 0)) + p_stars)
                         / (coalesce(buyer_rating_count, 0) + 1)
      where id = v_reviewee_id
      returning buyer_rating, buyer_rating_count into v_new_rating, v_new_count;
    end if;
  exception
    when unique_violation then
      select id into v_existing_id from ratings
      where meetpay_session_id = p_session_id and reviewer_id = v_reviewer_id;
      return json_build_object('status', 'already_rated', 'rating_id', v_existing_id);
  end;

  return json_build_object('status', 'submitted', 'new_rating', v_new_rating, 'new_count', v_new_count);
end;
$$;

revoke execute on function public.submit_rating(uuid, integer, text, text[]) from public, anon;
grant  execute on function public.submit_rating(uuid, integer, text, text[]) to authenticated, service_role;

-- VERIFIED LIVE, 3 September 2026 (rolled back)
--   two valid tags .............. accepted
--   four negative tags .......... accepted
--   an unknown tag .............. rejected
--   five tags (over the cap) .... rejected
--   null ........................ accepted
