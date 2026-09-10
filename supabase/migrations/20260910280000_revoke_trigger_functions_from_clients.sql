-- 20260910280000_revoke_trigger_functions_from_clients.sql
--
-- TRIGGER FUNCTIONS WERE CALLABLE AS RPCs.
--
-- Every function returning `trigger` was reachable at
-- /rest/v1/rpc/<name> by anon and authenticated, because functions
-- inherit EXECUTE from PUBLIC by default. Calling one outside a trigger
-- raises rather than doing damage — but a SECURITY DEFINER function
-- that nothing should ever call has no business being reachable from a
-- phone, and the next one written might not fail so politely.
--
-- The database linter flagged three of tonight's. Rather than name
-- them, this keys off the return type, so it covers every trigger
-- function in the schema and anything added later that gets re-run
-- through this migration.
do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as sig
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prorettype = 'trigger'::regtype
  loop
    execute format('revoke all on function %s from public, anon, authenticated', r.sig);
  end loop;
end $$;

-- pg_net, for the same reason: the database making outbound HTTP calls
-- on behalf of whoever asks is server-side request forgery with the
-- database's own network position.
--
-- Partly out of reach. net.http_post and net.http_get are owned by
-- supabase_admin and granted EXECUTE to PUBLIC by the extension itself,
-- so `postgres` cannot revoke that grant — the statements below remove
-- what this project controls and leave the extension's own grant in
-- place.
--
-- Not currently reachable either way: PostgREST exposes public,
-- graphql_public and storage, and `net` is not among them, so there is
-- no route to it from the API. It becomes live the day someone adds a
-- schema to that list, which is the only reason it is worth writing
-- down.
--
-- Safe regardless: every net.http_post call in this project comes from
-- a SECURITY DEFINER trigger or a cron job, both of which run as the
-- definer rather than as the caller.
revoke all on schema net from anon, authenticated;
revoke all on all functions in schema net from anon, authenticated;
