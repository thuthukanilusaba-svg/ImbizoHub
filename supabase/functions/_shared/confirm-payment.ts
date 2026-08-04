// supabase/functions/_shared/confirm-payment.ts
//
// Single source of truth for what happens once a payment_intents row is
// confirmed paid, regardless of how the confirmation arrived:
//   - paynow-webhook calls this after verifying a real Paynow hash
//   - create-payment calls this directly when PAYMENT_TEST_MODE is on,
//     so test-mode payments produce EXACTLY the same DB writes and
//     notifications a real payment would. No separate "fake" logic
//     exists to drift out of sync with the real thing over time.
//
// Callers are responsible for, BEFORE calling this function:
//   1. Verifying the request is legitimate (webhook hash check, or
//      being create-payment itself running in a trusted server context)
//   2. Fetching the payment_intents row
//   3. Checking intent.status !== 'paid' already (idempotency) —
//      this function does not re-check that, so callers must not call
//      it twice for the same intent.
//
// This file is pure logic + notifications, no HTTP handling — it's
// imported by both index.ts files below, not deployed on its own.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

type SupabaseClient = ReturnType<typeof createClient>;

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

async function sendExpoPushNotification(
  pushToken: string | null | undefined,
  title: string,
  body: string,
  data?: Record<string, unknown>
) {
  if (!pushToken || !pushToken.startsWith('ExponentPushToken')) {
    return;
  }
  try {
    const resp = await fetch(EXPO_PUSH_URL, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Accept-Encoding': 'gzip, deflate',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ to: pushToken, sound: 'default', title, body, data: data ?? {} }),
    });
    const result = await resp.json().catch(() => null);
    if (result?.data?.status === 'error') {
      console.error('Expo push send error:', result.data.message, result.data.details);
    }
  } catch (err) {
    console.error('sendExpoPushNotification failed:', err);
  }
}

async function notifyUnlockFeeReceived(supabase: SupabaseClient, sellerId: string, listingId: number) {
  try {
    const { data: sellerProfile } = await supabase
      .from('profiles')
      .select('push_token')
      .eq('id', sellerId)
      .maybeSingle();
    if (!sellerProfile?.push_token) return;

    let listingTitle = 'your listing';
    const { data: listing } = await supabase
      .from('listings')
      .select('title')
      .eq('id', listingId)
      .maybeSingle();
    if (listing?.title) listingTitle = listing.title;

    await sendExpoPushNotification(
      sellerProfile.push_token,
      'New buyer unlocked your chat 🔓',
      `Someone paid to message you about "${listingTitle}". Reply now.`,
      { type: 'unlock', listing_id: String(listingId) }
    );
  } catch (err) {
    console.error('confirmPaymentIntent: notifyUnlockFeeReceived failed', err);
  }
}

async function notifyWantedMatchAccepted(supabase: SupabaseClient, sellerId: string, itemRequestId: string) {
  try {
    const { data: sellerProfile } = await supabase
      .from('profiles')
      .select('push_token')
      .eq('id', sellerId)
      .maybeSingle();
    if (!sellerProfile?.push_token) return;

    let requestTitle = 'a wanted post';
    const { data: request } = await supabase
      .from('item_requests')
      .select('title')
      .eq('id', itemRequestId)
      .maybeSingle();
    if (request?.title) requestTitle = request.title;

    await sendExpoPushNotification(
      sellerProfile.push_token,
      'Your offer was accepted! 🎉',
      `The buyer chose your offer for "${requestTitle}". Chat is now open.`,
      { type: 'wanted_match', item_request_id: itemRequestId }
    );
  } catch (err) {
    console.error('confirmPaymentIntent: notifyWantedMatchAccepted failed', err);
  }
}

async function notifyTripDepositPaid(supabase: SupabaseClient, operatorId: string, requestId: string) {
  try {
    const { data: operatorProfile } = await supabase
      .from('profiles')
      .select('push_token')
      .eq('id', operatorId)
      .maybeSingle();
    if (!operatorProfile?.push_token) return;

    let routeLabel = 'a trip';
    const { data: request } = await supabase
      .from('requests')
      .select('pickup, destination')
      .eq('id', requestId)
      .maybeSingle();
    if (request?.pickup && request?.destination) {
      routeLabel = `${request.pickup} → ${request.destination}`;
    }

    await sendExpoPushNotification(
      operatorProfile.push_token,
      'Your quote was accepted! 🚐',
      `The customer paid their deposit for "${routeLabel}". Contact details are now visible in your dashboard.`,
      { type: 'trip_deposit', request_id: requestId }
    );
  } catch (err) {
    console.error('confirmPaymentIntent: notifyTripDepositPaid failed', err);
  }
}

async function notifyDeliveryBooked(supabase: SupabaseClient, sellerId: string, itemTitle: string) {
  try {
    const { data: sellerProfile } = await supabase
      .from('profiles')
      .select('push_token')
      .eq('id', sellerId)
      .maybeSingle();
    if (!sellerProfile?.push_token) return;

    await sendExpoPushNotification(
      sellerProfile.push_token,
      'Delivery booked 📦',
      `A driver has been booked to collect "${itemTitle}". Have it ready for pickup.`,
      { type: 'delivery_booked' }
    );
  } catch (err) {
    console.error('confirmPaymentIntent: notifyDeliveryBooked failed', err);
  }
}

export interface ConfirmMeta {
  // Real payments: Paynow's own reference + poll URL from the webhook
  // payload. Test-mode payments: a synthetic value clearly marked as
  // such (see create-payment/index.ts), never a blank/null reference,
  // so payment_intents rows stay easy to tell apart in the dashboard.
  paynowReference: string;
  pollUrl: string | null;
}

// The full per-kind side-effect logic, unchanged from paynow-webhook's
// original inline version — only the top-level `supabase` singleton
// became a parameter, and every "return new Response(...)" became a
// returned {ok:false, error} instead, since HTTP responses are the
// caller's concern (a webhook 500 vs. a create-payment JSON error body
// look different even though the underlying failure is the same).
export async function confirmPaymentIntent(
  supabase: SupabaseClient,
  intent: Record<string, any>,
  meta: ConfirmMeta
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (intent.kind === 'unlock_fee') {
    const { error: depositError } = await supabase.from('listing_deposits').insert({
      listing_id: intent.listing_id,
      buyer_id: intent.buyer_id,
      seller_id: intent.seller_id,
      amount: intent.amount,
      status: 'paid',
    });
    if (depositError) {
      console.error('confirmPaymentIntent: listing_deposits insert failed', depositError.message);
      return { ok: false, error: 'DB error' };
    }
    await notifyUnlockFeeReceived(supabase, intent.seller_id, intent.listing_id);

  } else if (intent.kind === 'delivery_operator_registration') {
    const expiresAt = new Date();
    expiresAt.setFullYear(expiresAt.getFullYear() + 1);

    const { error: opError } = await supabase
      .from('delivery_operators')
      .update({
        registration_paid: true,
        registration_paid_at: new Date().toISOString(),
        registration_expires_at: expiresAt.toISOString(),
      })
      .eq('user_id', intent.operator_user_id);

    if (opError) {
      console.error('confirmPaymentIntent: delivery_operators update failed', opError.message);
      return { ok: false, error: 'DB error' };
    }

    await supabase.from('transactions').insert({
      user_id: intent.operator_user_id,
      type: 'delivery_operator_registration',
      amount: intent.amount,
      status: 'completed',
      notes: `Delivery operator registration fee — paid via Paynow, valid until ${expiresAt.toLocaleDateString()}`,
    });

  } else if (intent.kind === 'transport_operator_registration') {
    const expiresAt = new Date();
    expiresAt.setFullYear(expiresAt.getFullYear() + 1);

    const { error: opError } = await supabase
      .from('profiles')
      .update({
        account_type: 'transport_operator',
        operator_status: 'active',
        registration_expires_at: expiresAt.toISOString(),
      })
      .eq('id', intent.operator_user_id);

    if (opError) {
      console.error('confirmPaymentIntent: profiles (transport operator) update failed', opError.message);
      return { ok: false, error: 'DB error' };
    }

    await supabase.from('transactions').insert({
      user_id: intent.operator_user_id,
      type: 'transport_operator_registration',
      amount: intent.amount,
      status: 'completed',
      notes: `Transport operator registration fee — paid via Paynow, valid until ${expiresAt.toLocaleDateString()}`,
    });

  } else if (intent.kind === 'wanted_request_match') {
    const { error: responseError } = await supabase
      .from('item_responses')
      .update({
        status: 'accepted',
        commission_paid: true,
        commission_amount: intent.amount,
      })
      .eq('id', intent.item_response_id);

    if (responseError) {
      console.error('confirmPaymentIntent: item_responses update failed', responseError.message);
      return { ok: false, error: 'DB error' };
    }

    await supabase
      .from('item_responses')
      .update({ status: 'declined' })
      .eq('item_request_id', intent.item_request_id)
      .neq('id', intent.item_response_id)
      .eq('status', 'pending');

    const { error: requestError } = await supabase
      .from('item_requests')
      .update({ status: 'matched' })
      .eq('id', intent.item_request_id);

    if (requestError) {
      console.error('confirmPaymentIntent: item_requests update failed', requestError.message);
      return { ok: false, error: 'DB error' };
    }

    await supabase.from('transactions').insert({
      user_id: intent.buyer_id,
      type: 'wanted_request_match',
      amount: intent.amount,
      status: 'completed',
      notes: `Wanted-post match fee — paid via Paynow`,
    });

    await notifyWantedMatchAccepted(supabase, intent.seller_id, intent.item_request_id);

  } else if (intent.kind === 'trip_deposit') {
    const { data: quote, error: quoteFetchError } = await supabase
      .from('quotes')
      .select('id, request_id, price')
      .eq('id', intent.trip_quote_id)
      .maybeSingle();

    if (quoteFetchError || !quote) {
      console.error('confirmPaymentIntent: quote not found for trip_deposit', intent.trip_quote_id);
      return { ok: false, error: 'Quote not found' };
    }

    // UPDATED (pricing decision): was a flat 10% deposit, no cap, plus
    // a SEPARATE 3% commission on top (removed entirely — see the
    // comment block below). Now: 7% commitment fee, capped at $30,
    // matching the pattern already used on the listing unlock fee (5%
    // capped at $15) — quotes.tsx computes this exact same capped
    // value client-side and it arrives here as intent.amount.
    //
    // FIX: balanceAmount used to be a hardcoded quote.price * 0.90 —
    // only correct when the deposit is a pure, uncapped percentage.
    // Once a cap can apply, that formula silently undercounts the
    // balance on any trip expensive enough to hit it (e.g. a $1000
    // trip: real deposit is $30, not $70, so balance should be $970,
    // not $930). Deriving balance as price - depositAmount instead is
    // correct in both the capped and uncapped case — matches the exact
    // same fix already applied to quotes.tsx's own display
    // calculation.
    const depositAmount = intent.amount;
    const balanceAmount = parseFloat((quote.price - depositAmount).toFixed(2));

    // UPDATED (pricing model simplified): ImbizoHub's entire take is
    // now this single upfront commitment fee — no second commission
    // layered on top. Used to also charge a SEPARATE 3% commission on
    // the 90% cash balance, tracked as a debt (profiles.
    // commission_owed) since there was no digital touchpoint for cash
    // the operator collects in person — nothing ever actually
    // collected it. Confusing to explain and easy for an operator to
    // just never pay. Removed entirely.

    const { error: quoteUpdateError } = await supabase
      .from('quotes')
      .update({
        status: 'accepted',
        deposit_paid: true,
        deposit_paid_at: new Date().toISOString(),
        deposit_amount: depositAmount,
        balance_amount: balanceAmount,
        // commission_amount deliberately no longer set — the column
        // stays in the schema (harmless, avoids a migration for
        // something that's fine to just leave unused) but is never
        // populated for new quotes going forward.
      })
      .eq('id', quote.id);

    if (quoteUpdateError) {
      console.error('confirmPaymentIntent: quotes update failed', quoteUpdateError.message);
      return { ok: false, error: 'DB error' };
    }

    await supabase
      .from('quotes')
      .update({ status: 'declined' })
      .eq('request_id', quote.request_id)
      .neq('id', quote.id);

    const { error: requestUpdateError } = await supabase
      .from('requests')
      .update({ status: 'filled' })
      .eq('id', quote.request_id);

    if (requestUpdateError) {
      console.error('confirmPaymentIntent: requests update failed', requestUpdateError.message);
      return { ok: false, error: 'DB error' };
    }

    await supabase.from('transactions').insert({
      user_id: intent.buyer_id,
      type: 'deposit',
      amount: depositAmount,
      reference_id: quote.id,
      status: 'completed',
      notes: `Commitment fee (7%, capped at $30) — trip request, paid via Paynow`,
    });

    await notifyTripDepositPaid(supabase, intent.seller_id, quote.request_id);

  } else if (intent.kind === 'dealer_pro_subscription') {
    // UPDATED: was 1 year for $30; product decision to keep the price
    // but shorten the period to 6 months instead — effectively doubling
    // the annualized price without changing the sticker amount shown at
    // checkout. setMonth() correctly handles month/year rollover on its
    // own (e.g. July + 6 -> January of the following year), same as
    // setFullYear() did for the old 1-year version.
    const expiresAt = new Date();
    expiresAt.setMonth(expiresAt.getMonth() + 6);

    const { error: dealerProError } = await supabase
      .from('profiles')
      .update({
        dealer_pro_active: true,
        dealer_pro_paid_at: new Date().toISOString(),
        dealer_pro_expires_at: expiresAt.toISOString(),
      })
      .eq('id', intent.buyer_id);

    if (dealerProError) {
      console.error('confirmPaymentIntent: profiles (dealer pro) update failed', dealerProError.message);
      return { ok: false, error: 'DB error' };
    }

    await supabase.from('transactions').insert({
      user_id: intent.buyer_id,
      type: 'dealer_pro_subscription',
      amount: intent.amount,
      status: 'completed',
      notes: `Dealer Pro subscription — paid via Paynow, valid until ${expiresAt.toLocaleDateString()}`,
    });

  } else if (intent.kind === 'featured_listing') {
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7);

    const { error: featuredError } = await supabase
      .from('listings')
      .update({ featured_until: expiresAt.toISOString() })
      .eq('id', intent.listing_id);

    if (featuredError) {
      console.error('confirmPaymentIntent: listings (featured) update failed', featuredError.message);
      return { ok: false, error: 'DB error' };
    }

    await supabase.from('transactions').insert({
      user_id: intent.buyer_id,
      type: 'featured_listing',
      amount: intent.amount,
      reference_id: intent.listing_id,
      status: 'completed',
      notes: `Featured listing — paid via Paynow, live until ${expiresAt.toLocaleDateString()}`,
    });

  } else if (intent.kind === 'verified_seller') {
    const { data: profileRow, error: fetchProfileError } = await supabase
      .from('profiles')
      .select('verification_review_status, verification_document_url')
      .eq('id', intent.buyer_id)
      .maybeSingle();

    if (fetchProfileError) {
      console.error('confirmPaymentIntent: profiles (verified seller) fetch failed', fetchProfileError.message);
      return { ok: false, error: 'DB error' };
    }

    const updatePayload: Record<string, unknown> = {
      verified_paid_at: new Date().toISOString(),
    };
    if (profileRow?.verification_document_url && profileRow.verification_review_status !== 'approved') {
      updatePayload.verification_review_status = 'pending_review';
    }

    const { error: verifiedError } = await supabase
      .from('profiles')
      .update(updatePayload)
      .eq('id', intent.buyer_id);

    if (verifiedError) {
      console.error('confirmPaymentIntent: profiles (verified seller) update failed', verifiedError.message);
      return { ok: false, error: 'DB error' };
    }

    await supabase.from('transactions').insert({
      user_id: intent.buyer_id,
      type: 'verified_seller',
      amount: intent.amount,
      status: 'completed',
      notes: `Verified Seller fee — paid via Paynow, pending document review`,
    });

  } else if (intent.kind === 'delivery_booking_fee') {
    const { error: bookingError } = await supabase
      .from('delivery_bookings')
      .insert({
        listing_id: intent.listing_id,
        item_request_id: intent.item_request_id,
        buyer_id: intent.buyer_id,
        seller_id: intent.seller_id,
        operator_id: intent.operator_user_id,
        pickup_city: intent.pickup_city,
        dropoff_city: intent.dropoff_city,
        delivery_type: intent.delivery_type,
        delivery_fee: intent.delivery_fee,
        booking_fee: intent.amount,
        parcel_description: intent.parcel_description,
        status: 'accepted',
        accepted_at: new Date().toISOString(),
      })
      .select('*')
      .maybeSingle();

    if (bookingError) {
      console.error('confirmPaymentIntent: delivery_bookings insert failed', bookingError.message);
      return { ok: false, error: 'DB error' };
    }

    let itemTitle = 'your item';
    if (intent.listing_id) {
      const { data: listing } = await supabase
        .from('listings')
        .select('title')
        .eq('id', intent.listing_id)
        .maybeSingle();
      if (listing?.title) itemTitle = listing.title;
    } else if (intent.item_request_id) {
      const { data: request } = await supabase
        .from('item_requests')
        .select('title')
        .eq('id', intent.item_request_id)
        .maybeSingle();
      if (request?.title) itemTitle = request.title;
    }

    await notifyDeliveryBooked(supabase, intent.seller_id, itemTitle);

  } else {
    console.error('confirmPaymentIntent: unrecognized payment_intents kind', intent.kind, intent.our_reference);
    return { ok: false, error: 'Unrecognized kind' };
  }

  await supabase
    .from('payment_intents')
    .update({
      status: 'paid',
      paynow_reference: meta.paynowReference,
      poll_url: meta.pollUrl,
      paid_at: new Date().toISOString(),
    })
    .eq('our_reference', intent.our_reference);

  return { ok: true };
}