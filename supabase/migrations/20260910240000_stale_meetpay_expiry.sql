-- 20260910240000_stale_meetpay_expiry.sql
--
-- THE PROBLEM. Nothing ever closes a Meet & Pay session that was never
-- arranged. Four are open in production right now; the oldest was
-- created nine days ago. In every one of them seller_agreed_at is null
-- and no PIN was ever generated — these are buyers who tapped "Arrange
-- deal" and got silence.
--
-- And they are STUCK, not merely waiting. create_meetpay_session()
-- returns any existing pending session for the same reference rather
-- than making a new one, so a buyer whose seller never replied is
-- handed the same dead session back for ever. They cannot start again
-- with anyone else on that listing. The decline path built earlier
-- today does not help them: declining takes somebody pressing a
-- button, and the defining feature of these sessions is that nobody
-- did anything at all.
--
-- Wanted offers already have exactly this — 48h nudge, 12-day warning,
-- 14-day expiry (20260907120000). Meet & Pay had nothing. This is the
-- same idea on a shorter clock, because a handover is arranged in days
-- rather than weeks.
--
-- WHY 'cancelled' AND NOT A NEW 'expired' STATUS. chat.tsx already
-- renders a complete, correct screen for a cancelled session on both
-- sides. A new status value would render as nothing at all in every
-- copy of the app already installed, which is precisely the "waiting
-- and never happening look identical" bug this is meant to end. The
-- honest distinction is carried by declined_by being NULL — nobody
-- declined it, it timed out — and chat.tsx now has a third case for
-- exactly that.
--
-- WHY NO CHAT MESSAGE. decline_meetpay posts one because a real person
-- really said something. Here nobody did. Writing "I can't make this
-- meetup" into someone's thread under their own name, because a cron
-- job fired, would be putting words in their mouth. The state change
-- and the push notification are the honest way to say it.

alter table public.meetpay_sessions
  add column if not exists stale_nudge_sent_at timestamptz;

comment on column public.meetpay_sessions.stale_nudge_sent_at is
  'Set when the 24-hour "somebody is waiting on you" push was sent. Send-once marker: an hourly job with no marker re-notifies the same pair for ever.';

-- Only pending sessions are ever candidates, so the index that matters
-- is the partial one.
create index if not exists meetpay_sessions_pending_created_idx
  on public.meetpay_sessions (created_at)
  where status = 'pending';

-- One session, closed cleanly. Returns the row so the caller knows who
-- to tell; returns null if it was not eligible, which makes the whole
-- thing safe to call twice.
create or replace function public.expire_meetpay_session(p_session_id uuid)
returns public.meetpay_sessions
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_row public.meetpay_sessions;
begin
  update public.meetpay_sessions
  set status = 'cancelled',
      declined_at = now(),
      -- Deliberately null, and load-bearing: it is what tells the app
      -- that this was a timeout rather than a person, so it does not
      -- accuse either side of pulling out.
      declined_by = null,
      decline_reason = null
  where id = p_session_id
    and status = 'pending'
  returning * into v_row;

  return v_row;   -- null when it was already confirmed, cancelled, or gone
end;
$$;

revoke all on function public.expire_meetpay_session(uuid) from public, anon, authenticated;
