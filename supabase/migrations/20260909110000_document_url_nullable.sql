-- 20260909110000_document_url_nullable.sql
--
-- verification_requests.document_url is NOT NULL, which means the
-- entire document-deletion retention path has never been able to work.
--
-- FOUND BY: probing the new pending-expiry branch against a synthetic
-- row before shipping it. The update raised
--
--   null value in column "document_url" of relation
--   "verification_requests" violates not-null constraint
--
-- and the same statement is what rules 1 and 2 of
-- cleanup-expired-data have been running nightly against approved and
-- rejected documents:
--
--   await supabase.from('verification_requests')
--     .update({ document_url: null }).eq('id', row.id);
--   results.rejected_documents_deleted++;
--
-- WHY NOBODY SAW IT. Three things hid this, each individually
-- reasonable:
--   1. That update's error is never checked, and the counter increments
--      regardless — so the function reported documents deleted that it
--      had not finished deleting.
--   2. The function spent its whole life returning 401 to pg_cron
--      (deployed with verify_jwt defaulted true), so the code did not
--      run at all until that was fixed.
--   3. There has never been a single verification request in this
--      database, so there was nothing for it to act on afterwards.
--
-- The failure mode is worse than a no-op: storage.remove() runs FIRST
-- and succeeds, so the file is genuinely deleted, and only then does the
-- row update fail. The row keeps a document_url pointing at a file that
-- no longer exists, and matches the same query again on every
-- subsequent nightly run, for ever.
--
-- The retention policy published on imbizohub.com already promises this
-- behaviour: "the fact that verification happened is what matters; the
-- photograph itself is pure risk with diminishing benefit." The column
-- was simply never made nullable to allow it.
--
-- Safe: dropping NOT NULL cannot invalidate an existing row, and
-- submit_verification_document always writes a real path on insert, so
-- nothing starts creating null-document rows as a result of this.

begin;

alter table public.verification_requests
  alter column document_url drop not null;

comment on column public.verification_requests.document_url is
  'Storage path in the verification-documents bucket. Nulled by cleanup-expired-data once the file is deleted under the retention policy (rejected 90d, approved 1y, never-reviewed 60d). Null means the document is gone; the verification RESULT lives on profiles.is_verified and is never cleared.';

commit;
