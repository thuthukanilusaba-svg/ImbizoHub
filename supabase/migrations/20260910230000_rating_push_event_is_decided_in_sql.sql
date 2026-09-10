-- 20260910230000_rating_push_event_is_decided_in_sql.sql
--
-- Supersedes the trigger half of 20260910220000.
--
-- WHY THAT SHAPE COULD NOT WORK. It told the edge function only the
-- rating_id and let the function read published_at to decide whether
-- to name the stars. pg_net delivers AFTER COMMIT. So a rating that
-- was sealed when the INSERT trigger fired, and published later in the
-- SAME transaction (which is exactly what submit_rating does when the
-- second person rates), already reads as published by the time the
-- function runs. Both the insert call and the publish call therefore
-- took the published branch, and the same person got the same push
-- twice.
--
-- Caught by probing the real RPC twice and reading net._http_response:
-- one submission produced three outbound calls where two were correct.
--
-- The transition is knowable in SQL and nowhere else, so SQL decides
-- it and sends it in the payload as `event`.
--
-- THE DEFERRED CONSTRAINT TRIGGER. The INSERT trigger is deferred to
-- commit time, which is the only point at which it can see whether the
-- rating it fired for has since been published. If it has, the UPDATE
-- trigger has already announced it and this one stays silent. A rating
-- born published — a delivery rating, which never has an UPDATE to
-- fire — announces itself.
--
-- Verified after applying: first submission -> exactly one call, body
-- "OK sealed". Reciprocation -> exactly two calls, both "OK published",
-- and nothing sealed. No duplicate, no number before publication.

create or replace function public.notify_rating_event()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  shared_secret text;
  project_url text := 'https://goughfxpcwxwsfthlmii.supabase.co';
  v_event text;
  v_published_now boolean;
begin
  if tg_op = 'UPDATE' then
    v_event := 'published';
  elsif new.published_at is not null then
    v_event := 'published';
  else
    select published_at is not null into v_published_now
    from ratings where id = new.id;

    if v_published_now is null then
      return null;                      -- rating gone before commit
    elsif v_published_now then
      return null;                      -- the UPDATE trigger has it
    end if;

    v_event := 'sealed';
  end if;

  select decrypted_secret into shared_secret
  from vault.decrypted_secrets
  where name = 'admin_notify_shared_secret';

  if shared_secret is null then
    raise warning 'admin_notify_shared_secret not set in Vault - skipping rating notification';
    return null;
  end if;

  perform net.http_post(
    url := project_url || '/functions/v1/notify-new-rating',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'X-Notify-Secret', shared_secret
    ),
    body := jsonb_build_object('rating_id', new.id, 'event', v_event)
  );

  return null;
end;
$$;

drop trigger if exists on_new_rating on public.ratings;
drop trigger if exists on_rating_published on public.ratings;

create constraint trigger on_new_rating
after insert on public.ratings
deferrable initially deferred
for each row
execute function public.notify_rating_event();

create trigger on_rating_published
after update of published_at on public.ratings
for each row
when (old.published_at is null and new.published_at is not null)
execute function public.notify_rating_event();
