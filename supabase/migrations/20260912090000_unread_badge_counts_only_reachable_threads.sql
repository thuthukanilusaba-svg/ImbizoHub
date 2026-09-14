-- 20260912090000_unread_badge_counts_only_reachable_threads.sql
--
-- A BADGE YOU CANNOT CLEAR.
--
-- my_unread_conversation_count bucketed messages by
--   coalesce(listing_id, request_id, item_request_id, 'none')
-- so a message belonging to NO thread still counted, under 'none'.
--
-- messages.tsx does the opposite: it skips those rows outright, because
-- there is no chat to open for a message that references nothing. So
-- the tab showed a red badge for a conversation that does not appear in
-- the list, and no amount of reading could clear it — the only screen
-- that calls mark_conversation_read() is the chat you cannot reach.
--
-- Nine such messages exist, all unread, all belonging to one person.
-- They predate item_request_id being added to the messages table, so
-- their thread was never recorded.
--
-- The badge should count what you can actually go and read. Anything
-- else trains people to ignore it, and then it stops working for the
-- messages that matter.
--
-- Verified after applying, as that person: badge 0, conversations in
-- the list 0 — they agree.

create or replace function public.my_unread_conversation_count()
returns integer
language sql
security definer
set search_path to 'public', 'pg_temp'
as $$
  select coalesce(count(distinct (
           sender_id,
           coalesce(listing_id::text, request_id::text, item_request_id::text)
         )), 0)::integer
  from public.messages
  where receiver_id = auth.uid()
    and read_at is null
    -- Must match messages.tsx's own filter exactly: a message with no
    -- thread has no chat screen to open, so it cannot be counted.
    and (listing_id is not null or request_id is not null or item_request_id is not null);
$$;
