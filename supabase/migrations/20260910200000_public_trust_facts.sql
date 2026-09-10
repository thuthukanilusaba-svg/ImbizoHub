-- 20260910200000_public_trust_facts.sql
--
-- "What we can confirm" — verifiable facts about a seller or operator,
-- to sit where a star average currently sits.
--
-- WHY, in this database's numbers: every rating on the platform is five
-- stars. An average of 5.0 over 3 reviews tells a buyer nothing, and
-- worse, it tells them nothing while LOOKING like it tells them
-- something. Double-blind ratings (10 Sep) fix the incentive going
-- forward, but they also mean fewer visible ratings for a while, so the
-- gap where a buyer decides whether to trust someone gets wider before
-- it gets narrower.
--
-- Facts do not have that problem. Account age, deals completed, and how
-- many DIFFERENT people someone has dealt with are all things ImbizoHub
-- can attest to directly, they cannot be inflated by politeness, and
-- they are honestly unimpressive on a new account — which is the point.
--
-- DISTINCT COUNTERPARTIES IS THE ANTI-GAMING NUMBER. Five deals with
-- five different people is a real trading history. Five deals with one
-- friend is not, and a plain deal count cannot tell them apart. This is
-- the single most useful field here.
--
-- WHY A SECURITY DEFINER RPC AND NOT A VIEW: meetpay_sessions RLS only
-- lets participants see their own sessions, which is correct and must
-- stay that way. Counting someone else's completed deals therefore needs
-- elevated rights. The function returns ONLY aggregates — never a row,
-- never a counterparty's identity, never an amount — so nothing leaks
-- beyond the numbers a profile is meant to show.
--
-- DELIBERATELY NOT INCLUDED:
--   * Reports or suspensions. The absence of a report on a two-day-old
--     account means nothing, and publishing report counts would let one
--     malicious reporter mark someone permanently.
--   * Anything phrased as a judgement. "ID verified" is a fact.
--     "Trusted seller" is an endorsement of work nobody inspected, and
--     the day it appears above a scammer is the day it becomes a legal
--     problem rather than a product one.

begin;

create or replace function public.public_trust_facts(p_user_id uuid)
returns json
language plpgsql
security definer
stable
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_profile record;
  v_deals integer;
  v_people integer;
  v_id_verified boolean;
begin
  select created_at, is_verified, verified_expires_at, operator_id_verified, account_type
    into v_profile
  from profiles where id = p_user_id;

  if not found then
    return null;
  end if;

  -- Confirmed Meet & Pay sessions where this person was either side.
  -- 'confirmed' only: a started-and-abandoned deal is not a completed
  -- one, and counting it would make the number gameable by simply
  -- opening sessions.
  select
    count(*),
    count(distinct case when buyer_id = p_user_id then seller_id else buyer_id end)
  into v_deals, v_people
  from meetpay_sessions
  where status = 'confirmed'
    and (buyer_id = p_user_id or seller_id = p_user_id);

  -- An expired verification is not a current one. Checked rather than
  -- trusting is_verified alone, which stays true after the date passes.
  v_id_verified :=
    (coalesce(v_profile.is_verified, false)
      and v_profile.verified_expires_at is not null
      and v_profile.verified_expires_at > now())
    or coalesce(v_profile.operator_id_verified, false);

  return json_build_object(
    'member_since', v_profile.created_at,
    'days_on_platform', (current_date - v_profile.created_at::date),
    'deals_completed', coalesce(v_deals, 0),
    'distinct_counterparties', coalesce(v_people, 0),
    'id_verified', v_id_verified
  );
end;
$function$;

-- Readable by anyone, including a buyer browsing without an account —
-- that is exactly the person deciding whether to trust a stranger.
revoke execute on function public.public_trust_facts(uuid) from public;
grant execute on function public.public_trust_facts(uuid) to anon, authenticated, service_role;

commit;
