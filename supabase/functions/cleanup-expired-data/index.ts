// supabase/functions/cleanup-expired-data/index.ts
//
// Runs the lower-risk, more mechanical parts of the retention policy
// on a schedule: stale push tokens, rejected/approved ID documents
// past their retention windows, dispatch/Wanted-response/listing
// photos past 1 year (post.tsx confirmed the listings schema:
// image_url + image_urls, same listing-photos bucket as the others),
// and payment records past 5 years.
//
// IMPORTANT — what this does NOT do: delete verification_requests
// rows for approved submissions, or touch profiles.is_verified /
// delivery_operators.verification_tier / profiles.operator_id_verified
// in any way. The retention policy is specific: only the RAW
// DOCUMENT FILE loses its purpose after a year: the fact that
// someone was verified needs to remain permanent. Only
// document_url is nulled and the file itself removed from storage.
//
// Meant to run daily via cron (see cleanup-expired-data-cron.sql).
//
// DEPLOYED WITH verify_jwt: false. It had been deployed with verify_jwt
// left at the default true, so every nightly cron call was rejected by
// the platform with 401 before reaching the shared-secret check below —
// this function had never once actually run. pg_cron reported the job as
// succeeded throughout, because net.http_post succeeds as a SQL
// statement no matter what HTTP status comes back.
//
// Four column references were wrong and could not have worked. They were
// invisible for as long as the 401 stopped the code running at all:
//   - verification_requests.document_path  -> document_url  (FIXED)
//     Despite the name, that column holds a bare storage path, not a
//     URL: submit_verification() writes p_document_path straight into
//     it. So .remove() still takes it directly, no parsing needed.
//   - item_responses.image_url             -> photo_url     (FIXED)
//     Latent: the block never ran, because the item_requests query
//     above it errored first.
//   - item_requests.updated_at             -> COLUMN ADDED (FIXED)
//   - listings.updated_at                  -> COLUMN ADDED (FIXED)
//     Neither table recorded when a row last changed, so both queries
//     referenced a column that did not exist. Switching them to
//     created_at would have been worse than the error: "one year after
//     the listing was marked sold" and "one year after it was posted"
//     are different promises, and the second deletes the photos of a
//     listing posted two years ago and sold last week. The column the
//     rule actually depends on was added instead, with a trigger to
//     maintain it, backfilled to created_at for existing rows.
//
// Verified after all four fixes: the function returns 200 with
// "errors":[] — an empty list, not an absent one.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const NOTIFY_SHARED_SECRET = Deno.env.get('NOTIFY_SHARED_SECRET')!;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const REJECTED_ID_DAYS = 90;
const APPROVED_ID_DAYS = 365;
const STALE_PUSH_TOKEN_DAYS = 180;

function daysAgoIso(days: number): string {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  const providedSecret = req.headers.get('X-Notify-Secret');
  if (!NOTIFY_SHARED_SECRET || providedSecret !== NOTIFY_SHARED_SECRET) {
    console.error('cleanup-expired-data: invalid or missing shared secret');
    return new Response('Unauthorized', { status: 401 });
  }

  const results = {
    rejected_documents_deleted: 0,
    approved_documents_deleted: 0,
    stale_push_tokens_cleared: 0,
    // NEW: photo and payment-record cleanup — see additions below.
    dispatch_photos_deleted: 0,
    wanted_response_photos_deleted: 0,
    listing_photos_deleted: 0,
    payment_records_deleted: 0,
    errors: [] as string[],
  };

  try {
    // 1. Rejected ID documents older than 90 days — no ongoing
    // purpose once rejected; this window just covers a reasonable
    // appeal period.
    const { data: rejected, error: rejectedError } = await supabase
      .from('verification_requests')
      .select('id, document_url')
      .eq('status', 'rejected')
      .lt('reviewed_at', daysAgoIso(REJECTED_ID_DAYS))
      .not('document_url', 'is', null);

    if (rejectedError) {
      results.errors.push(`rejected fetch: ${rejectedError.message}`);
    } else {
      for (const row of rejected ?? []) {
        const { error: removeError } = await supabase.storage
          .from('verification-documents')
          .remove([row.document_url]);
        if (removeError) {
          results.errors.push(`rejected remove ${row.id}: ${removeError.message}`);
          continue;
        }
        await supabase.from('verification_requests').update({ document_url: null }).eq('id', row.id);
        results.rejected_documents_deleted++;
      }
    }

    // 2. Approved ID documents older than 1 year — the raw file only.
    // is_verified / verification_tier / operator_id_verified are
    // never touched here; the fact of verification stays permanent.
    const { data: approved, error: approvedError } = await supabase
      .from('verification_requests')
      .select('id, document_url')
      .eq('status', 'approved')
      .lt('reviewed_at', daysAgoIso(APPROVED_ID_DAYS))
      .not('document_url', 'is', null);

    if (approvedError) {
      results.errors.push(`approved fetch: ${approvedError.message}`);
    } else {
      for (const row of approved ?? []) {
        const { error: removeError } = await supabase.storage
          .from('verification-documents')
          .remove([row.document_url]);
        if (removeError) {
          results.errors.push(`approved remove ${row.id}: ${removeError.message}`);
          continue;
        }
        await supabase.from('verification_requests').update({ document_url: null }).eq('id', row.id);
        results.approved_documents_deleted++;
      }
    }

    // 3. Stale push tokens — tokens naturally go stale (app
    // reinstalled, device replaced); this just formalizes cleanup of
    // ones that haven't refreshed in 6 months.
    const { data: staleProfiles, error: staleError } = await supabase
      .from('profiles')
      .select('id')
      .not('push_token', 'is', null)
      .lt('push_token_updated_at', daysAgoIso(STALE_PUSH_TOKEN_DAYS));

    if (staleError) {
      results.errors.push(`stale tokens fetch: ${staleError.message}`);
    } else if (staleProfiles && staleProfiles.length > 0) {
      const { error: clearError } = await supabase
        .from('profiles')
        .update({ push_token: null, push_token_updated_at: null })
        .in('id', staleProfiles.map((p) => p.id));
      if (clearError) {
        results.errors.push(`stale tokens clear: ${clearError.message}`);
      } else {
        results.stale_push_tokens_cleared = staleProfiles.length;
      }
    }

    // 4. Dispatch photos — 1 year after the delivery was confirmed.
    // Only the photo file and its reference are removed; the booking
    // row itself stays (needed for historical ratings/records).
    const { data: oldBookings, error: bookingsError } = await supabase
      .from('delivery_bookings')
      .select('id, dispatch_photo_url')
      .not('dispatch_photo_url', 'is', null)
      .eq('status', 'confirmed')
      .lt('confirmed_at', daysAgoIso(365));

    if (bookingsError) {
      results.errors.push(`dispatch photos fetch: ${bookingsError.message}`);
    } else {
      for (const booking of oldBookings ?? []) {
        // dispatch_photo_url is a full public URL, not a bare storage
        // path — extract the path (everything after the bucket name)
        // the same way it was constructed when uploaded.
        const match = booking.dispatch_photo_url?.match(/listing-photos\/(.+)$/);
        if (!match) continue;
        const { error: removeError } = await supabase.storage.from('listing-photos').remove([match[1]]);
        if (removeError) {
          results.errors.push(`dispatch photo remove ${booking.id}: ${removeError.message}`);
          continue;
        }
        await supabase.from('delivery_bookings').update({ dispatch_photo_url: null }).eq('id', booking.id);
        results.dispatch_photos_deleted++;
      }
    }

    // 5. Wanted-tab response photos — 1 year after the parent request
    // is no longer open (matched, or otherwise closed).
    const { data: closedRequests, error: closedRequestsError } = await supabase
      .from('item_requests')
      .select('id')
      .neq('status', 'open')
      .lt('updated_at', daysAgoIso(365));

    if (closedRequestsError) {
      results.errors.push(`closed requests fetch: ${closedRequestsError.message}`);
    } else if (closedRequests && closedRequests.length > 0) {
      const { data: oldResponses, error: responsesError } = await supabase
        .from('item_responses')
        .select('id, photo_url')
        .in('item_request_id', closedRequests.map((r) => r.id))
        .not('photo_url', 'is', null);

      if (responsesError) {
        results.errors.push(`wanted responses fetch: ${responsesError.message}`);
      } else {
        for (const response of oldResponses ?? []) {
          const match = response.photo_url?.match(/listing-photos\/(.+)$/);
          if (!match) continue;
          const { error: removeError } = await supabase.storage.from('listing-photos').remove([match[1]]);
          if (removeError) {
            results.errors.push(`wanted photo remove ${response.id}: ${removeError.message}`);
            continue;
          }
          await supabase.from('item_responses').update({ photo_url: null }).eq('id', response.id);
          results.wanted_response_photos_deleted++;
        }
      }
    }

    // 6. Payment records — 5 years. CONFIRMED: Zimbabwe's statutory
    // financial record retention period is 3-5 years; 5 is used here
    // as the safer end of that confirmed range, replacing the earlier
    // unconfirmed 7-year placeholder. Full row deletion, not
    // anonymization: by 5 years out, the tax-retention need has
    // expired, so there's no remaining purpose to keep a stripped
    // version around either.
    const PAYMENT_RECORD_DAYS = 365 * 5;

    const { error: intentsError, count: intentsCount } = await supabase
      .from('payment_intents')
      .delete({ count: 'exact' })
      .lt('created_at', daysAgoIso(PAYMENT_RECORD_DAYS));

    if (intentsError) {
      results.errors.push(`payment_intents delete: ${intentsError.message}`);
    }

    const { error: transactionsError, count: transactionsCount } = await supabase
      .from('transactions')
      .delete({ count: 'exact' })
      .lt('created_at', daysAgoIso(PAYMENT_RECORD_DAYS));

    if (transactionsError) {
      results.errors.push(`transactions delete: ${transactionsError.message}`);
    }

    results.payment_records_deleted = (intentsCount ?? 0) + (transactionsCount ?? 0);

    // 7. Main marketplace listing photos — 1 year after a listing is
    // marked sold or removed. Confirmed schema (post.tsx): image_url
    // (single, backwards-compatible first photo) and image_urls (full
    // gallery array), both full public URLs from the same
    // listing-photos bucket dispatch/Wanted photos already use. The
    // listing ROW itself is untouched — only its photo references and
    // the underlying files, matching the same "keep the record, drop
    // the media" pattern as sections 4 and 5 above.
    const { data: oldListings, error: oldListingsError } = await supabase
      .from('listings')
      .select('id, image_url, image_urls')
      .in('status', ['sold', 'removed'])
      .lt('updated_at', daysAgoIso(365))
      .or('image_url.not.is.null,image_urls.not.is.null');

    if (oldListingsError) {
      results.errors.push(`old listings fetch: ${oldListingsError.message}`);
    } else {
      for (const listing of oldListings ?? []) {
        const allUrls: string[] = [
          ...(listing.image_url ? [listing.image_url] : []),
          ...(listing.image_urls ?? []),
        ];
        const paths = allUrls
          .map((u: string) => u.match(/listing-photos\/(.+)$/)?.[1])
          .filter((p): p is string => !!p);

        if (paths.length === 0) continue;

        const { error: removeError } = await supabase.storage.from('listing-photos').remove(paths);
        if (removeError) {
          results.errors.push(`listing photos remove ${listing.id}: ${removeError.message}`);
          continue;
        }
        await supabase.from('listings').update({ image_url: null, image_urls: [] }).eq('id', listing.id);
        results.listing_photos_deleted++;
      }
    }

    return new Response(JSON.stringify(results), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('cleanup-expired-data error:', err);
    return new Response(JSON.stringify({ ...results, fatal: String(err) }), { status: 500 });
  }
});