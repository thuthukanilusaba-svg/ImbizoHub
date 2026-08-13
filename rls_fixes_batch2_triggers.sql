-- ImbizoHub RLS/RPC redesign — batch 2, part B: the enforcement
--
-- ⚠️ DO NOT RUN THIS FILE until:
--   1. rls_fixes_batch2_rpcs.sql has been run successfully, AND
--   2. dealer.tsx, delivery-track.tsx, chat.tsx, and meetpay.tsx have
--      been updated to call the new RPCs instead of their current
--      direct .update()/.insert() calls, AND
--   3. that updated app build is actually the one live/installed.
--
-- Running this before all three are true will make the CURRENT app
-- version's delivery-accept, PIN-generate, and PIN-confirm actions
-- start failing for every real user immediately — this file is the
-- part that actually removes the old direct-write path, not just adds
-- a new one alongside it.
--
-- Everything below is provided ready to run, but commented out as a
-- safety rail — uncomment each block only once its precondition above
-- is satisfied.

create or replace function public.prevent_delivery_booking_privilege_escalation()
returns trigger as $$
begin
  if pg_has_role(current_user, 'service_role', 'member') then
    return new;
  end if;
  if new.status is distinct from old.status
     or new.operator_id is distinct from old.operator_id
     or new.pin is distinct from old.pin
     or new.pin_expires_at is distinct from old.pin_expires_at
     or new.accepted_at is distinct from old.accepted_at
     or new.dispatched_at is distinct from old.dispatched_at
     or new.delivered_at is distinct from old.delivered_at
     or new.confirmed_at is distinct from old.confirmed_at
  then
    raise exception 'Cannot modify delivery booking status/assignment fields directly — use the app''s delivery actions.';
  end if;
  return new;
end;
$$ language plpgsql security definer;

-- drop trigger if exists prevent_delivery_booking_privilege_escalation on public.delivery_bookings;
-- create trigger prevent_delivery_booking_privilege_escalation
-- before update on public.delivery_bookings
-- for each row execute function public.prevent_delivery_booking_privilege_escalation();


create or replace function public.prevent_meetpay_session_privilege_escalation()
returns trigger as $$
begin
  if pg_has_role(current_user, 'service_role', 'member') then
    return new;
  end if;
  if new.status is distinct from old.status
     or new.pin is distinct from old.pin
     or new.pin_expires_at is distinct from old.pin_expires_at
     or new.confirmed_at is distinct from old.confirmed_at
     or new.confirmed_by is distinct from old.confirmed_by
     or new.buyer_confirmed_at is distinct from old.buyer_confirmed_at
     or new.operator_confirmed_at is distinct from old.operator_confirmed_at
  then
    raise exception 'Cannot modify meetpay session status/confirmation fields directly — use the app''s confirm actions.';
  end if;
  return new;
end;
$$ language plpgsql security definer;

-- drop trigger if exists prevent_meetpay_session_privilege_escalation on public.meetpay_sessions;
-- create trigger prevent_meetpay_session_privilege_escalation
-- before update on public.meetpay_sessions
-- for each row execute function public.prevent_meetpay_session_privilege_escalation();


-- Once the app is calling create_meetpay_session() instead of
-- inserting directly, remove the direct-client insert path entirely —
-- right now "Buyer can create session" has no restriction on `status`,
-- meaning a buyer could currently insert a session pre-marked
-- status='confirmed', skipping the seller's involvement completely.
-- The RPC bypasses this policy anyway (SECURITY DEFINER), so dropping
-- it only removes the direct-insert path, not the real one.

-- drop policy if exists "Buyer can create session" on public.meetpay_sessions;
