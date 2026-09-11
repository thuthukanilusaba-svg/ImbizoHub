-- 20260911090000_listing_content_no_tags_at_all.sql
--
-- TIGHTENED, ON REQUEST: no HTML tags of any kind, not just dangerous
-- ones.
--
-- The previous rule (20260910260000) refused a named list — script,
-- iframe, object, svg, style and so on — plus event handlers and
-- javascript: URLs. That is the standard approach and it blocked every
-- attack thrown at it. But a list is a promise that the list is
-- complete, and it never is. The owner's question was the right one:
-- can we be certain nothing can ever be inserted?
--
-- A list cannot answer that. A shape can. The rule is now: a '<'
-- followed by a letter — optionally through a /, ! or ? — is a tag, and
-- so is '<!--'. Nothing in ordinary writing has that shape.
--
-- HTML COMMENTS NEARLY GOT THROUGH. The first cut was
-- '<\s*[/!?]?\s*[A-Za-z]', which requires a LETTER after the optional
-- !, and in '<!-- hidden -->' the next character is a dash. The '<!--'
-- alternative closes it. Caught by testing against twenty strings, not
-- by reading the pattern — the same way the \b/\y bug was caught the
-- night before. Two for two: these patterns do not survive inspection
-- alone.
--
-- WHAT THIS COSTS. "T-shirt <M>" is now refused; "T-shirt (M)" and
-- "size M" are not. That is the entire price, paid by a handful of
-- sellers writing a size in angle brackets, and it buys a rule with no
-- list to maintain and nothing to keep up to date.
--
-- STILL ALLOWED, deliberately: "under <$50", "5 > 3 bars", "Price <
-- 100", "Love it <3", "8am <> 5pm". A '<' followed by a space, digit or
-- symbol is how people write, not how they write code. Also allowed:
-- "&lt;script&gt;" — already-escaped text is inert and renders as
-- visible characters.
--
-- THE CLIENT AGREES WITH THIS FILE. lib/contentSafety.ts implements the
-- same rule so the seller is told in the form instead of after their
-- photos upload, and all 29 shared cases were verified to give the same
-- verdict on both sides. If you change one, change the other: a form
-- that accepts what the database refuses reads as a bug in the app.
--
-- AND ESCAPING IS STILL THE REAL DEFENCE. This stops the text being
-- stored. Anything that renders these fields into HTML — the listing
-- preview card for WhatsApp, when it gets built — must still escape
-- them, exactly as seller-preview already does.

create or replace function public.enforce_listing_content_sane()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_title text;
  v_desc  text;

  -- Any tag-shaped construct: every element that exists, every element
  -- that will exist, comments and processing instructions — without
  -- naming any of them.
  bad_tag  text := '<\s*[/!?]?\s*[A-Za-z]|<!--';
  bad_attr text := '[\s/]on[a-z]+\s*=';
  bad_url  text := '(javascript|vbscript)\s*:|data\s*:\s*[a-z-]+/';

  -- False endorsement: a status word within 25 characters of the brand,
  -- either order. Mentioning ImbizoHub is fine; claiming its blessing
  -- is not. See 20260910260000 for the full reasoning.
  brand  text := 'imbizo\s*-?\s*hub';
  claim  text := '(official|officially|verified|authoris(ed|e)|authoriz(ed|e)|approved|certified|endorsed|accredited|partner|agent|staff|support|admin(istrator)?|moderator|team)';
begin
  v_title := btrim(coalesce(new.title, ''));
  v_desc  := btrim(coalesce(new.description, ''));

  if tg_op = 'INSERT' or new.title is distinct from old.title then
    if length(v_title) < 3 or length(v_title) > 120 then
      raise exception 'A title needs to be between 3 and 120 characters.';
    end if;
    if v_title !~ '[A-Za-zÀ-ɏ].*[A-Za-zÀ-ɏ]' then
      raise exception 'Please give this a real title so people can find it.';
    end if;
    if v_title ~* bad_tag or v_title ~* bad_attr or v_title ~* bad_url then
      raise exception 'Titles cannot contain code or HTML tags. Please use plain words.';
    end if;
    if v_title ~* (brand || '.{0,25}\y' || claim || '\y')
       or v_title ~* ('\y' || claim || '\y.{0,25}' || brand) then
      raise exception 'Listings cannot claim to be official, verified or approved by ImbizoHub.';
    end if;
  end if;

  if tg_op = 'INSERT' or new.description is distinct from old.description then
    if length(v_desc) > 4000 then
      raise exception 'That description is too long — please keep it under 4000 characters.';
    end if;
    if v_desc ~* bad_tag or v_desc ~* bad_attr or v_desc ~* bad_url then
      raise exception 'Descriptions cannot contain code or HTML tags. Please describe the item in plain words.';
    end if;
    if v_desc ~* (brand || '.{0,25}\y' || claim || '\y')
       or v_desc ~* ('\y' || claim || '\y.{0,25}' || brand) then
      raise exception 'Listings cannot claim to be official, verified or approved by ImbizoHub.';
    end if;
  end if;

  return new;
end;
$$;
