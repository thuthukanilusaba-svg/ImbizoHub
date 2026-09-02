-- Lock down EXECUTE on public functions.
--
-- WHY THIS EXISTS
--
-- PostgreSQL grants EXECUTE on a new function to PUBLIC by default. In a
-- plain Postgres database that is mostly harmless, because nobody can
-- connect as an untrusted role. In Supabase it is not: `anon` and
-- `authenticated` are real roles that inherit PUBLIC's grants, and
-- PostgREST publishes every function in the `public` schema as a callable
-- REST endpoint at /rest/v1/rpc/<name>.
--
-- The practical effect, before this migration: all 53 non-trigger
-- functions in this database — including admin_suspend_user,
-- generate_delivery_pin and confirm_meetpay_pin — had a public URL that
-- anyone on the internet could POST to with nothing but the anon key,
-- which ships inside the app and is therefore not a secret.
--
-- WHAT THE RISK ACTUALLY WAS
--
-- Lower than that sounds, and it is worth being accurate rather than
-- dramatic. Every one of those functions was checked before writing this:
-- all six admin_* functions verify both auth.uid() and an admin role, and
-- every PIN function reads auth.uid(). An `anon` caller has a NULL
-- auth.uid(), so these calls already failed. There was no open door.
--
-- This migration is defence in depth: it removes the doors rather than
-- relying on every guard behind them being correct today and staying
-- correct through every future edit. The guard inside a function is one
-- `create or replace` away from being dropped by accident; a revoked
-- EXECUTE privilege is not.
--
-- THE ONE THING WORTH KNOWING BEFORE RUNNING THIS
--
-- Revoking EXECUTE on a TRIGGER function does not stop the trigger firing.
-- PostgreSQL checks EXECUTE on the function at CREATE TRIGGER time, not on
-- each invocation — the trigger machinery calls it directly, not on behalf
-- of the current user. So all 26 trigger functions below can be revoked
-- from every role with no runtime effect. (Postgres also refuses a direct
-- RPC call to a trigger function anyway; they are revoked here because a
-- trigger function should not be listed as an API endpoint at all.)
--
-- ROLES NOT TOUCHED
--
-- `service_role` and `postgres` are deliberately absent from every REVOKE.
-- Edge functions authenticate as service_role and must keep working —
-- notably paynow-webhook, delete-expired-accounts and the notify-* set.

begin;

-- ---------------------------------------------------------------------
-- 1. Trigger functions — never an API endpoint, under any role.
-- ---------------------------------------------------------------------

revoke execute on function public.accrue_van_hire_commission()                     from public, anon, authenticated;
revoke execute on function public.enforce_contact_info_block()                     from public, anon, authenticated;
revoke execute on function public.enforce_not_suspended_listings()                 from public, anon, authenticated;
revoke execute on function public.enforce_not_suspended_messages()                 from public, anon, authenticated;
revoke execute on function public.enforce_operator_profile_complete()              from public, anon, authenticated;
revoke execute on function public.handle_new_user()                                from public, anon, authenticated;
revoke execute on function public.notify_admins_new_verification()                 from public, anon, authenticated;
revoke execute on function public.notify_delivery_status()                         from public, anon, authenticated;
revoke execute on function public.notify_delivery_status_change()                  from public, anon, authenticated;
revoke execute on function public.notify_listing_sold()                            from public, anon, authenticated;
revoke execute on function public.notify_meetpay_session_change()                  from public, anon, authenticated;
revoke execute on function public.notify_new_message()                             from public, anon, authenticated;
revoke execute on function public.notify_new_quote()                               from public, anon, authenticated;
revoke execute on function public.notify_new_rating()                              from public, anon, authenticated;
revoke execute on function public.notify_new_wanted_post()                         from public, anon, authenticated;
revoke execute on function public.notify_new_wanted_response()                     from public, anon, authenticated;
revoke execute on function public.notify_verification_reviewed()                   from public, anon, authenticated;
revoke execute on function public.prevent_delivery_operator_privilege_escalation() from public, anon, authenticated;
revoke execute on function public.prevent_item_response_privilege_escalation()     from public, anon, authenticated;
revoke execute on function public.prevent_listing_deposit_tampering()              from public, anon, authenticated;
revoke execute on function public.prevent_listing_privilege_escalation()           from public, anon, authenticated;
revoke execute on function public.prevent_profile_privilege_escalation()           from public, anon, authenticated;
revoke execute on function public.prevent_quote_privilege_escalation()             from public, anon, authenticated;
revoke execute on function public.prevent_quoting_own_request()                    from public, anon, authenticated;
revoke execute on function public.prevent_request_status_tampering()               from public, anon, authenticated;
revoke execute on function public.set_updated_at()                                 from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 2. RPCs the app calls — signed-in users only.
--
-- Every name below was confirmed present as a supabase.rpc('...') call in
-- the app source. Revoking PUBLIC removes the implicit grant `anon`
-- inherits; the explicit GRANT then puts back exactly the role that needs
-- it. Both statements are required — revoking from `anon` alone would
-- leave the PUBLIC grant in place and change nothing.
-- ---------------------------------------------------------------------

-- Meet & Pay: the PIN handover. The most sensitive group in the database.
revoke execute on function public.create_meetpay_session(text, text, numeric) from public, anon;
grant  execute on function public.create_meetpay_session(text, text, numeric) to authenticated;

revoke execute on function public.agree_to_meetpay(uuid)                      from public, anon;
grant  execute on function public.agree_to_meetpay(uuid)                      to authenticated;

revoke execute on function public.confirm_meetpay_pin(uuid, text)             from public, anon;
grant  execute on function public.confirm_meetpay_pin(uuid, text)             to authenticated;

revoke execute on function public.confirm_meetpay_trip(uuid)                  from public, anon;
grant  execute on function public.confirm_meetpay_trip(uuid)                  to authenticated;

revoke execute on function public.regenerate_meetpay_pin(uuid)                from public, anon;
grant  execute on function public.regenerate_meetpay_pin(uuid)                to authenticated;

-- Delivery: paused for new bookings, but in-flight ones still run.
revoke execute on function public.accept_delivery_job(uuid)                   from public, anon;
grant  execute on function public.accept_delivery_job(uuid)                   to authenticated;

revoke execute on function public.decline_delivery_job(uuid)                  from public, anon;
grant  execute on function public.decline_delivery_job(uuid)                  to authenticated;

revoke execute on function public.generate_delivery_pin(uuid)                 from public, anon;
grant  execute on function public.generate_delivery_pin(uuid)                 to authenticated;

revoke execute on function public.confirm_delivery_pin(uuid, text)            from public, anon;
grant  execute on function public.confirm_delivery_pin(uuid, text)            to authenticated;

revoke execute on function public.mark_delivery_dispatched(uuid)              from public, anon;
grant  execute on function public.mark_delivery_dispatched(uuid)              to authenticated;

revoke execute on function public.mark_delivery_delivered(uuid)               from public, anon;
grant  execute on function public.mark_delivery_delivered(uuid)               to authenticated;

revoke execute on function public.reassign_delivery_operator(uuid, uuid)      from public, anon;
grant  execute on function public.reassign_delivery_operator(uuid, uuid)      to authenticated;

-- Ratings.
revoke execute on function public.submit_rating(uuid, integer, text)                  from public, anon;
grant  execute on function public.submit_rating(uuid, integer, text)                  to authenticated;

revoke execute on function public.submit_delivery_rating(uuid, text, integer, text)   from public, anon;
grant  execute on function public.submit_delivery_rating(uuid, text, integer, text)   to authenticated;

-- Admin. These already verify auth.uid() AND an admin role internally —
-- this makes a signed-out caller fail at the door rather than inside.
revoke execute on function public.admin_list_pending_verifications(text)          from public, anon;
grant  execute on function public.admin_list_pending_verifications(text)          to authenticated;

revoke execute on function public.admin_list_reports(text)                        from public, anon;
grant  execute on function public.admin_list_reports(text)                        to authenticated;

revoke execute on function public.admin_review_report(uuid, text)                 from public, anon;
grant  execute on function public.admin_review_report(uuid, text)                 to authenticated;

revoke execute on function public.admin_review_verification(uuid, boolean, text)  from public, anon;
grant  execute on function public.admin_review_verification(uuid, boolean, text)  to authenticated;

revoke execute on function public.admin_suspend_user(uuid, integer, text)         from public, anon;
grant  execute on function public.admin_suspend_user(uuid, integer, text)         to authenticated;

revoke execute on function public.admin_unsuspend_user(uuid)                      from public, anon;
grant  execute on function public.admin_unsuspend_user(uuid)                      to authenticated;

-- Verification, unlocks, operators, account.
revoke execute on function public.submit_verification(text, text)          from public, anon;
grant  execute on function public.submit_verification(text, text)          to authenticated;

revoke execute on function public.my_verification_status(text)             from public, anon;
grant  execute on function public.my_verification_status(text)             to authenticated;

revoke execute on function public.claim_free_unlock(bigint, uuid)          from public, anon;
grant  execute on function public.claim_free_unlock(bigint, uuid)          to authenticated;

revoke execute on function public.my_free_unlocks_remaining()              from public, anon;
grant  execute on function public.my_free_unlocks_remaining()              to authenticated;

revoke execute on function public.register_operator_free_promo(text)       from public, anon;
grant  execute on function public.register_operator_free_promo(text)       to authenticated;

revoke execute on function public.request_account_deletion()               from public, anon;
grant  execute on function public.request_account_deletion()               to authenticated;

-- Called by login.tsx and lib/oauth.ts immediately AFTER sign-in succeeds,
-- so the caller is already `authenticated` at that point despite the name.
revoke execute on function public.merge_anonymous_session(uuid)            from public, anon;
grant  execute on function public.merge_anonymous_session(uuid)            to authenticated;

-- ---------------------------------------------------------------------
-- 3. Service-role only — no app call site exists for either.
--
-- mark_contact_email is called by an edge function to record that a
-- contact email was sent. submit_verification_document appears to be dead
-- code superseded by submit_verification(); it is revoked rather than
-- dropped so that dropping it can be a separate, reversible decision.
-- ---------------------------------------------------------------------

revoke execute on function public.mark_contact_email(uuid, boolean, text) from public, anon, authenticated;
revoke execute on function public.submit_verification_document(text)      from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 4. Deliberately left callable by `anon`.
--
--   report_crash            — lib/crashReporter.ts must be able to report
--                             a crash that happened before or during
--                             sign-in. A crash reporter that only works
--                             for logged-in users misses the failures
--                             most worth knowing about.
--   submit_contact_message  — designed for anonymous submission (it takes
--                             name, email, ip_hash, user_agent and does
--                             not read auth.uid()). The website contact
--                             form is the intended caller.
--
-- Both only insert a row of their own arguments. If either is ever abused
-- for spam, the answer is rate limiting, not revoking EXECUTE.
-- ---------------------------------------------------------------------

-- ---------------------------------------------------------------------
-- 5. Stop the problem recurring.
--
-- Everything above is retrospective. This changes the default so a
-- function created from now on is not published to `anon` the moment it
-- exists. New functions must be granted deliberately:
--
--     grant execute on function public.my_new_rpc(...) to authenticated;
--
-- If a future function appears to "not exist" from the app with a 404 or
-- a permission error, this default is why, and the line above is the fix.
-- ---------------------------------------------------------------------

alter default privileges in schema public revoke execute on functions from public;
alter default privileges in schema public revoke execute on functions from anon;

-- ---------------------------------------------------------------------
-- 6. service_role — the correction this migration needed.
--
-- FOUND DURING VERIFICATION, 2 Sep 2026. Everything above revokes "from
-- public", and `public` is not a synonym for `anon`: service_role was
-- ALSO taking its EXECUTE from the PUBLIC grant, so section 2 silently
-- removed service_role's access to all 29 functions it named.
--
-- Nothing actually broke — every edge function in supabase/functions/
-- works through table operations and none of them calls an RPC, which is
-- why this passed unnoticed until the privileges were read back. But it
-- was a regression, not a decision, and the first edge function to need
-- an RPC would have failed for a reason nobody would have connected to
-- this migration months later.
--
-- The lesson worth keeping: REVOKE ... FROM PUBLIC on a Supabase function
-- hits every role that had no explicit grant of its own. Always name the
-- roles you intend to keep straight afterwards.
--
-- Not restored here: health_check, cron_http_post, resolve_cron_http_calls,
-- pending_contact_emails and cleanup_inactive_messages. Those were already
-- closed to service_role beforehand and run under pg_cron as postgres.
-- ---------------------------------------------------------------------

grant execute on function public.create_meetpay_session(text, text, numeric) to service_role;
grant execute on function public.agree_to_meetpay(uuid)                      to service_role;
grant execute on function public.confirm_meetpay_pin(uuid, text)             to service_role;
grant execute on function public.confirm_meetpay_trip(uuid)                  to service_role;
grant execute on function public.regenerate_meetpay_pin(uuid)                to service_role;
grant execute on function public.accept_delivery_job(uuid)                   to service_role;
grant execute on function public.decline_delivery_job(uuid)                  to service_role;
grant execute on function public.generate_delivery_pin(uuid)                 to service_role;
grant execute on function public.confirm_delivery_pin(uuid, text)            to service_role;
grant execute on function public.mark_delivery_dispatched(uuid)              to service_role;
grant execute on function public.mark_delivery_delivered(uuid)               to service_role;
grant execute on function public.reassign_delivery_operator(uuid, uuid)      to service_role;
grant execute on function public.submit_rating(uuid, integer, text)                to service_role;
grant execute on function public.submit_delivery_rating(uuid, text, integer, text) to service_role;
grant execute on function public.admin_list_pending_verifications(text)         to service_role;
grant execute on function public.admin_list_reports(text)                       to service_role;
grant execute on function public.admin_review_report(uuid, text)                to service_role;
grant execute on function public.admin_review_verification(uuid, boolean, text) to service_role;
grant execute on function public.admin_suspend_user(uuid, integer, text)        to service_role;
grant execute on function public.admin_unsuspend_user(uuid)                     to service_role;
grant execute on function public.submit_verification(text, text)         to service_role;
grant execute on function public.my_verification_status(text)            to service_role;
grant execute on function public.claim_free_unlock(bigint, uuid)         to service_role;
grant execute on function public.my_free_unlocks_remaining()             to service_role;
grant execute on function public.register_operator_free_promo(text)      to service_role;
grant execute on function public.request_account_deletion()              to service_role;
grant execute on function public.merge_anonymous_session(uuid)           to service_role;
grant execute on function public.mark_contact_email(uuid, boolean, text) to service_role;
grant execute on function public.submit_verification_document(text)      to service_role;

-- Pre-existing gap, not caused above: an earlier migration had already
-- revoked PUBLIC on this one and granted `anon` explicitly, leaving it the
-- only half of the contact pair service_role could not call.
grant execute on function public.submit_contact_message(text, text, text, text, text, text, text)
  to service_role;

-- Keep the schema default consistent with all of the above: new functions
-- stay hidden from anon, and service_role keeps working without a manual
-- grant every time one is added.
alter default privileges in schema public grant execute on functions to service_role;

commit;

-- ---------------------------------------------------------------------
-- VERIFIED AGAINST THE LIVE DATABASE, 2 September 2026
--
--   Trigger functions reachable by anon or authenticated ... 26 -> 0
--   Non-trigger functions callable by anon ................. 53 -> 2
--     (report_crash and submit_contact_message, both intended)
--   App RPCs callable by authenticated ..................... 31, unchanged
--   service_role gaps ...................................... 0
--
-- Triggers proven to still fire with EXECUTE revoked:
--   set_updated_at ............. listings.updated_at still bumps on update
--   notify_new_message ......... message insert succeeds, trigger runs
--   enforce_contact_info_block . still RAISES on a phone number sent in a
--                                chat for a listing with no paid deposit
--
-- That last one is worth recording carefully: the first attempt at this
-- test PASSED the insert, which looked like the guard had stopped firing.
-- It had not. The probe reused a listing that was already unlocked, so the
-- trigger detected the number and correctly allowed it. Re-run against a
-- listing with no paid deposit and no Dealer Pro seller, it raised. A test
-- that cannot fail proves nothing — this one needed the unlocked case
-- excluded before it meant anything.
-- ---------------------------------------------------------------------
