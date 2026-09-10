-- 20260910260000_listing_content_sane.sql
--
-- Listings and Wanted posts had NO content validation of any kind. No
-- check constraint, no trigger. Title and description accepted
-- anything: markup, control characters, and as much of it as you liked.
--
-- A tester posted a listing whose description is
--   <script> console.log('hello') </script>
-- and it is sitting in production now.
--
-- WHAT THAT ACTUALLY PROVED. Nothing executed. React escapes text by
-- default in both the app and the web build, and the one place in this
-- project that assembles HTML from user data — seller-preview — runs
-- every value through escapeHtml first. The tag is rendered as
-- characters, which is the defence working.
--
-- SO WHY BOTHER. Because escaping is a property of every future render
-- site, and there will be more of them. A listing preview card for
-- WhatsApp is the obvious next thing after seller-preview, and it puts
-- the description straight into og:description. Depending on one
-- rule being remembered at every boundary for ever is how these get
-- through eventually. Rejecting the handful of constructs that are
-- never legitimate in a description of a second-hand phone costs
-- nothing and closes the door before it exists.
--
-- ESCAPING REMAINS THE REAL DEFENCE. This is a second line, not a
-- replacement for it. Anything that renders these fields into HTML
-- still has to escape them.
--
-- WHAT IS DELIBERATELY ALLOWED. Bare < and > survive, because
-- "T-shirt <M>", "under <$50" and "5 > 3 bars of signal" are things
-- people really write in a marketplace. Only tags that can execute or
-- load something are refused, plus inline event handlers and
-- javascript: URLs. Punctuation, emoji, accents and other languages
-- are all untouched: this is not a spelling test.
--
-- ONLY ON CHANGE. Same rule as enforce_full_name_sane, for the same
-- reason: a row written before this existed must not be frozen out of
-- unrelated updates. The listing above will keep working, and its owner
-- will be told why the moment they try to edit that description.

create or replace function public.enforce_listing_content_sane()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_title text;
  v_desc  text;
  -- Tags that can execute code or pull in a remote resource, with
  -- optional whitespace after the < so "< script" is caught too.
  --
  -- \y, NOT \b. Postgres regular expressions are POSIX ARE, where \b is
  -- a BACKSPACE character and \y is the word boundary. Written with \b
  -- this pattern matched nothing whatsoever — <script>, <iframe> and
  -- <svg/onload=> all sailed straight through, and the only two attacks
  -- refused were the ones the other two patterns happened to catch.
  -- The rule looked right and did almost nothing. Found by testing it
  -- against eighteen real strings rather than reading it.
  bad_tag  text := '<\s*/?\s*(script|iframe|object|embed|applet|link|meta|style|svg|form|base)\y';
  -- onclick=, onerror=, onload= and friends. Leading [\s/] rather than
  -- \s so <svg/onload=...> is caught as well as <img src=x onerror=...>.
  bad_attr text := '[\s/]on[a-z]+\s*=';
  -- data: is narrowed to an actual payload (data:text/html,
  -- data:image/svg+xml). A bare "data:" must stay legal — "Data: 20GB
  -- monthly" is an ordinary thing to write on a SIM or router listing.
  bad_url  text := '(javascript|vbscript)\s*:|data\s*:\s*[a-z-]+/';

  -- FALSE ENDORSEMENT.
  --
  -- The name rule (20260910270000) stops someone BEING called ImbizoHub
  -- Support. It does nothing about a listing that SAYS "Official
  -- ImbizoHub verified seller" in its description — which buys the same
  -- false authority, in the place buyers actually read.
  --
  -- Deliberately NOT a ban on mentioning the brand. "Bought on
  -- ImbizoHub", "Happy to do Meet & Pay through ImbizoHub" and "see my
  -- other ImbizoHub listings" are ordinary, useful things to write, and
  -- a marketplace that refuses its own name in a description is absurd.
  -- What is refused is a claim of official STANDING: a status word
  -- sitting next to the brand, in either order, within 25 characters.
  --
  -- The proximity is what keeps it honest. "Official Manchester United
  -- jersey", "Admin desk chair", "Certified pre-owned Toyota parts",
  -- "Support beams, treated timber" and "Verified working, tested this
  -- morning" all contain a status word and all pass, because none of
  -- them mentions ImbizoHub anywhere near it. Those five are in the
  -- test set precisely because a substring rule would have eaten them.
  brand  text := 'imbizo\s*-?\s*hub';
  claim  text := '(official|officially|verified|authoris(ed|e)|authoriz(ed|e)|approved|certified|endorsed|accredited|partner|agent|staff|support|admin(istrator)?|moderator|team)';
begin
  v_title := btrim(coalesce(new.title, ''));
  v_desc  := btrim(coalesce(new.description, ''));

  -- Title: required, and must actually say something. Two letters
  -- somewhere is the same bar full_name uses — it rejects "..." and
  -- "12345" without rejecting "iPhone 15" or "Sony TV 42".
  if tg_op = 'INSERT' or new.title is distinct from old.title then
    if length(v_title) < 3 or length(v_title) > 120 then
      raise exception 'A title needs to be between 3 and 120 characters.';
    end if;
    if v_title !~ '[A-Za-zÀ-ɏ].*[A-Za-zÀ-ɏ]' then
      raise exception 'Please give this a real title so people can find it.';
    end if;
    if v_title ~* bad_tag or v_title ~* bad_attr or v_title ~* bad_url then
      raise exception 'That title contains code, which is not allowed. Please describe the item in plain words.';
    end if;
    if v_title ~* (brand || '.{0,25}\y' || claim || '\y')
       or v_title ~* ('\y' || claim || '\y.{0,25}' || brand) then
      raise exception 'Listings cannot claim to be official, verified or approved by ImbizoHub.';
    end if;
  end if;

  -- Description: optional, so an empty one is fine. Length cap is
  -- generous — some people write a lot — but not unbounded.
  if tg_op = 'INSERT' or new.description is distinct from old.description then
    if length(v_desc) > 4000 then
      raise exception 'That description is too long — please keep it under 4000 characters.';
    end if;
    if v_desc ~* bad_tag or v_desc ~* bad_attr or v_desc ~* bad_url then
      raise exception 'That description contains code, which is not allowed. Please describe the item in plain words.';
    end if;
    if v_desc ~* (brand || '.{0,25}\y' || claim || '\y')
       or v_desc ~* ('\y' || claim || '\y.{0,25}' || brand) then
      raise exception 'Listings cannot claim to be official, verified or approved by ImbizoHub.';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_enforce_listing_content_sane on public.listings;

create trigger trg_enforce_listing_content_sane
before insert or update of title, description on public.listings
for each row
execute function public.enforce_listing_content_sane();

drop trigger if exists trg_enforce_item_request_content_sane on public.item_requests;

create trigger trg_enforce_item_request_content_sane
before insert or update of title, description on public.item_requests
for each row
execute function public.enforce_listing_content_sane();

-- ── the two rows that predate all of this ────────────────────────────
--
-- Cleared rather than left for the pre-launch wipe, because both are
-- visible to other testers right now and both read as a broken product.
-- Prior values, for reversal:
--   listings.id 21 description  = '<script> console.log(''hello'') </script>'
--   profiles 0c2b344d-…c67e full_name = '  or  "
--
-- The name is nulled rather than replaced with something invented: a
-- profile with no name already falls back to "ImbizoHub Seller" in
-- seller-preview and to 👤 in chat, and its owner can set a real one
-- whenever they like.

update public.listings set description = null where id = 21;

update public.profiles set full_name = null
where id = '0c2b344d-72d5-43ba-96bf-1ab3c2a6c67e';
