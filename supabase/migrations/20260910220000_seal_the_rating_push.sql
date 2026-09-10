-- 20260910220000_seal_the_rating_push.sql
--
-- TWO FAULTS FOUND BY RUNNING THE WHOLE CYCLE.
--
-- 1. THE PUSH NOTIFICATION WAS BREAKING THE SEAL.
--
-- Double-blind ratings (20260910180000) hide the other side's stars
-- behind RLS until both have rated. But `on_new_rating` fires AFTER
-- INSERT — before publication — and notify-new-rating's push body is
-- literally "<name> rated you ⭐⭐". So the seal held in the app and
-- leaked on the lock screen: rate first and the other person is told
-- your score before they write theirs. That is the exact retaliation
-- loop blinding exists to stop, and it made the claim on the website
-- untrue in practice.
--
-- Fix: the trigger now also fires when published_at goes from null to
-- non-null, and the edge function decides what may be said. Sealed ->
-- a nudge with no number in it. Published -> the stars, which are
-- public by then anyway.
--
-- The sealed nudge is not just damage limitation. The one thing that
-- unseals a rating early is the other side rating back, so telling
-- them there is something waiting is the push most likely to close the
-- pair — it does the job the old push was accidentally doing, without
-- the number.
--
-- (Superseded three hours later by 20260910230000, which moves the
-- sealed/published decision into SQL. See that file for why the shape
-- below could not work.)
--
-- 2. THE STORED AGGREGATE WAS NEVER RECONCILED.
--
-- profiles.rating/rating_count are moved by publish_rating() and by
-- nothing else. No DELETE trigger, no recompute. ratings rows can and
-- do disappear — ON DELETE CASCADE from delivery_bookings, an account
-- deletion cascading through reviewee_id, a moderator removing a
-- review — and the aggregate stays where it was.
--
-- It had already happened: one live profile showed 5.0 from 3 ratings
-- with zero rating rows behind it. Reputation outliving its evidence
-- is worse than no reputation, and it sat directly under a "what we
-- can confirm" panel.
--
-- Fix: recompute_profile_ratings() as the single source of truth, a
-- DELETE trigger that calls it, and a one-off repair.
--
-- Values before the repair, for reversal:
--   ca68ed38-8d21-46fd-a638-68e3ef389d4b  rating 5,    rating_count 3
--   b1fd832d-face-4f2e-a374-710ed6202320  buyer_rating_count 5

drop trigger if exists on_new_rating on public.ratings;

create trigger on_new_rating
after insert on public.ratings
for each row
execute function public.notify_new_rating();

drop trigger if exists on_rating_published on public.ratings;

create trigger on_rating_published
after update of published_at on public.ratings
for each row
when (old.published_at is null and new.published_at is not null)
execute function public.notify_new_rating();

-- ---------------------------------------------------------------
-- Recompute, rather than nudge, the stored aggregate.
--
-- Mirrors publish_rating()'s own split exactly: role 'buyer' means a
-- buyer rated a seller, so it lands on the seller-side figures;
-- anything else lands on the buyer-side ones. Only published ratings
-- count, which is what makes this safe to run at any moment — a
-- sealed rating must never move a public average.
-- ---------------------------------------------------------------

create or replace function public.recompute_profile_ratings(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
begin
  update profiles p
  set rating             = coalesce(a.seller_avg, 0),
      rating_count       = coalesce(a.seller_count, 0),
      buyer_rating       = coalesce(a.buyer_avg, 0),
      buyer_rating_count = coalesce(a.buyer_count, 0)
  from (
    select
      avg(stars) filter (where role = 'buyer')  as seller_avg,
      count(*)   filter (where role = 'buyer')  as seller_count,
      avg(stars) filter (where role <> 'buyer') as buyer_avg,
      count(*)   filter (where role <> 'buyer') as buyer_count
    from ratings
    where reviewee_id = p_user_id
      and published_at is not null
  ) a
  where p.id = p_user_id;
end;
$$;

create or replace function public.recompute_all_profile_ratings()
returns integer
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  r record;
  n integer := 0;
begin
  for r in select id from profiles loop
    perform recompute_profile_ratings(r.id);
    n := n + 1;
  end loop;
  return n;
end;
$$;

-- A deleted rating must take its contribution with it. AFTER DELETE
-- rather than BEFORE, so the recompute sees the row already gone.
create or replace function public.on_rating_deleted()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
begin
  if old.reviewee_id is not null then
    perform recompute_profile_ratings(old.reviewee_id);
  end if;
  return old;
end;
$$;

drop trigger if exists trg_rating_deleted on public.ratings;

create trigger trg_rating_deleted
after delete on public.ratings
for each row
execute function public.on_rating_deleted();

revoke all on function public.recompute_profile_ratings(uuid) from public, anon, authenticated;
revoke all on function public.recompute_all_profile_ratings() from public, anon, authenticated;

-- Repair the drift that already exists.
select public.recompute_all_profile_ratings();
