// app/unlock.tsx
// (renamed from deposit.tsx) Buyer pays a 5% fee, capped at $15, before
// arranging a deal (Meet & Pay or delivery booking) with the seller.
//
// UPDATED: added a $1.50 MINIMUM fee, alongside the existing $15 cap —
// previously a cheap listing (e.g. a $10 item) could produce an
// arrange-deal fee well under a dollar, which doesn't meaningfully
// cover the actual cost/value of facilitating a deal. Mirrors the cap's
// own shape exactly: a hard floor regardless of listed price, same as
// the cap is a hard ceiling regardless of listed price.
//
// NOTE ON THE MODEL (updated): this fee used to gate CHAT itself. It now
// gates only the "Arrange deal" moment — chat.tsx allows unlimited free
// messaging for everyone. This reflects actual buying intent (wanting to
// meet/pay or book delivery) rather than charging before any signal of
// interest exists. The fee itself is still ImbizoHub's commission,
// collected upfront based on the listed price — it is NOT a refundable
// deposit and is NOT credited toward whatever price the buyer and seller
// eventually agree — once paid, ImbizoHub has already been paid in full
// for facilitating the deal-arrangement step, regardless of what happens
// in Meet & Pay or delivery afterward.
//
// The fee is capped at $15 regardless of listed price, so higher-priced
// items (e.g. vehicles) don't produce an unreasonably large upfront fee
// just to start arranging a deal.
//
// Usage: router.push(`/unlock?listing_id=${id}&seller_id=${sellerId}&price=${price}`)
//
// REAL PAYNOW INTEGRATION (replaces the old instant "mark as paid" insert):
// 1. handlePayUnlockFee() calls the create-payment Edge Function, which
//    creates a 'pending' payment_intents row and returns a real Paynow
//    checkout URL.
// 2. We open that URL in an in-app browser (expo-web-browser). The buyer
//    actually pays via EcoCash/card/etc. on Paynow's own site.
// 3. When the browser session closes (user completed or cancelled), we
//    poll our own payment_intents row for a few seconds waiting for the
//    webhook (paynow-webhook Edge Function) to have marked it 'paid' —
//    Paynow's webhook is the only thing that actually writes 'paid' to
//    listing_deposits; this screen never marks anything paid itself.
// 4. Only once payment_intents shows 'paid' do we redirect into chat with
//    the deal modal open. If it's still pending after the poll window
//    (e.g. slow webhook, or an EcoCash prompt the user hasn't confirmed
//    on their phone yet), we tell the buyer payment is processing rather
//    than silently failing or falsely granting access.
//
// UPDATED: first 5 arrange-deal unlocks are free for every buyer, so a
// new user can experience the full chat -> arrange -> meet -> confirm
// loop before ever being asked to pay — see free-unlocks.sql. Eligibility
// is checked server-side via claim_free_unlock() (a buyer can't fake
// having free unlocks left by manipulating the client), and
// my_free_unlocks_remaining() drives the "N free unlocks remaining"
// banner so the switch to paid isn't a surprise once they're used up.
// Everything about the paid flow itself (handlePayUnlockFee, the
// Paynow/webhook round-trip) is unchanged.

import { useLocalSearchParams, useRouter } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator, Platform,
  StyleSheet,
  Text, TouchableOpacity,
  View,
} from 'react-native';
import { supabase } from '../../lib/supabase';

const GOLD = '#B8860B';
const BLACK = '#1A1A18';
const DARK = '#2a2a2a';
const GREY = '#AAAAAA';
const GREEN = '#4fc96e';
const UNLOCK_FEE_PCT = 0.05; // 5%, charged on the LISTED price — this is ImbizoHub's commission
const UNLOCK_FEE_CAP = 15; // never charge more than this, regardless of listed price
// NEW: never charge less than this either, regardless of listed price —
// same reasoning as the cap, just the opposite direction.
const UNLOCK_FEE_MIN = 1.50;

// NEW: launch promotion — the unlock fee is free until Jan 31, 2027,
// same window as every other promo built today. Deliberately checked
// BEFORE hasFreeUnlock below — during the promo, unlocking is free
// for everyone regardless of the separate "5 free unlocks" allowance,
// and importantly doesn't CONSUME that allowance either, so it's still
// fully intact for buyers once February's real pricing begins.
const FREE_PROMO_END = new Date('2027-01-31T23:59:59Z');
const isPromoActive = () => new Date() < FREE_PROMO_END;

// How long to poll payment_intents after the checkout browser closes,
// waiting for the paynow-webhook to have marked it paid.
const POLL_INTERVAL_MS = 2000;
const POLL_MAX_ATTEMPTS = 20; // ~40 seconds total — was 15 (~30s); a real
// trip_deposit payment on quotes.tsx took 32s to confirm and got missed
// by 2s under the old window. Widened here too for the same margin,
// since this screen shares the same webhook confirmation path.

export default function DepositScreen() {
  const router = useRouter();
  const { listing_id, seller_id, price, title } = useLocalSearchParams<{
    listing_id: string; seller_id: string; price: string; title?: string;
  }>();

  const [loading, setLoading] = useState(true);
  const [paying, setPaying] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [claimingFree, setClaimingFree] = useState(false);
  const [error, setError] = useState('');
  const [alreadyPaid, setAlreadyPaid] = useState(false);
  const [myId, setMyId] = useState('');
  const [myEmail, setMyEmail] = useState('');
  const [freeUnlocksRemaining, setFreeUnlocksRemaining] = useState(0);

  const priceNum = parseFloat(price || '0');
  const rawFee = priceNum * UNLOCK_FEE_PCT;
  const isCapped = rawFee > UNLOCK_FEE_CAP;
  // NEW: mirrors isCapped exactly, just for the floor instead of the
  // ceiling — true whenever the raw 5% calculation would land under the
  // new minimum.
  const isMinimum = rawFee < UNLOCK_FEE_MIN;
  const unlockFeeAmount = Math.max(Math.min(rawFee, UNLOCK_FEE_CAP), UNLOCK_FEE_MIN).toFixed(2);
  const hasFreeUnlock = freeUnlocksRemaining > 0;

  useEffect(() => { checkExisting(); }, []);

  async function checkExisting() {
    setLoading(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { router.replace('/login'); return; }
    setMyId(user.id);
    setMyEmail(user.email ?? '');

    // If this is the seller's own listing, skip the fee entirely
    if (user.id === seller_id) {
      router.replace(`/chat?listing_id=${listing_id}&receiver_id=${seller_id}`);
      return;
    }

    // NEW: Dealer Pro benefit — buyers never pay the unlock fee on a
    // listing owned by an active Pro subscriber. Same "paid boolean +
    // expires_at checked against now()" pattern used everywhere else in
    // the app. This is a client-side convenience redirect only — the
    // real enforcement (so a buyer can't just skip this screen and
    // share contact info in chat before ever reaching here) lives in
    // enforce_contact_info_block(), widened separately to check the
    // same condition server-side. See
    // widen-enforce-contact-info-block-dealer-pro.sql.
    const { data: sellerProfile } = await supabase
      .from('profiles')
      .select('dealer_pro_active, dealer_pro_expires_at')
      .eq('id', seller_id)
      .maybeSingle();

    const sellerIsDealerPro = !!(
      sellerProfile?.dealer_pro_active &&
      sellerProfile?.dealer_pro_expires_at &&
      new Date(sellerProfile.dealer_pro_expires_at).getTime() > Date.now()
    );

    if (sellerIsDealerPro) {
      router.replace(`/chat?listing_id=${listing_id}&receiver_id=${seller_id}`);
      return;
    }

    const { data } = await supabase
      .from('listing_deposits')
      .select('*')
      .eq('listing_id', listing_id)
      .eq('buyer_id', user.id)
      .eq('status', 'paid')
      .maybeSingle();

    if (data) {
      setAlreadyPaid(true);
      router.replace(`/chat?listing_id=${listing_id}&receiver_id=${seller_id}`);
      return;
    }

    // How many of the first 5 free unlocks this buyer has left — drives
    // the banner and which button (free vs. paid) is shown below.
    const { data: remaining } = await supabase.rpc('my_free_unlocks_remaining');
    setFreeUnlocksRemaining(remaining ?? 0);

    setLoading(false);
  }

  // NEW: promo unlock path — calls unlock-free-promo directly, no
  // Paynow checkout, and deliberately does NOT touch the separate
  // claim_free_unlock/my_free_unlocks_remaining allowance at all,
  // since this is a different rule (date-bound for everyone) from
  // that one (a fixed count per buyer). Kept fully separate from
  // handleClaimFreeUnlock and handlePayUnlockFee below for the same
  // reasoning used throughout today's promo work — each flow stays
  // simple and isolated, nothing to accidentally cross-contaminate.
  async function handleUnlockFreePromo() {
    setError('');
    setClaimingFree(true);

    const { data, error: fnError } = await supabase.functions.invoke('unlock-free-promo', {
      body: {
        listing_id: parseInt(listing_id),
        buyer_id: myId,
        seller_id,
      },
    });

    setClaimingFree(false);

    if (fnError || data?.error) {
      setError(fnError?.message || data?.error || 'Could not unlock. Please try again.');
      return;
    }

    router.replace(`/chat?listing_id=${listing_id}&receiver_id=${seller_id}&openDeal=1`);
  }

  async function handleClaimFreeUnlock() {
    setError('');
    setClaimingFree(true);

    const { error: rpcError } = await supabase.rpc('claim_free_unlock', {
      p_listing_id: parseInt(listing_id),
      p_seller_id: seller_id,
    });

    setClaimingFree(false);

    if (rpcError) {
      // Most likely someone else's tab already used the last free
      // unlock in the time since this screen loaded — re-check and
      // fall back to the normal paid flow rather than showing a dead
      // end.
      const { data: remaining } = await supabase.rpc('my_free_unlocks_remaining');
      setFreeUnlocksRemaining(remaining ?? 0);
      setError('That free unlock is no longer available — please use the paid option below.');
      return;
    }

    router.replace(`/chat?listing_id=${listing_id}&receiver_id=${seller_id}&openDeal=1`);
  }

  async function handlePayUnlockFee() {
    setError('');
    setPaying(true);

    const { data, error: fnError } = await supabase.functions.invoke('create-payment', {
      body: {
        kind: 'unlock_fee',
        amount: parseFloat(unlockFeeAmount),
        email: myEmail,
        listing_id: parseInt(listing_id),
        buyer_id: myId,
        seller_id,
      },
    });

    if (fnError || !data?.checkoutUrl) {
      setError(fnError?.message || data?.error || 'Could not start payment. Please try again.');
      setPaying(false);
      return;
    }

    const { reference, checkoutUrl } = data;

    // Open Paynow's real checkout page. The buyer completes payment there
    // (EcoCash prompt, card entry, etc.) — this app has no visibility into
    // that step and must not assume it succeeded just because the browser
    // closed; only the webhook confirms that.
    await WebBrowser.openBrowserAsync(checkoutUrl);

    setPaying(false);
    setVerifying(true);

    const paid = await pollForPaid(reference);

    setVerifying(false);

    if (paid) {
      router.replace(`/chat?listing_id=${listing_id}&receiver_id=${seller_id}&openDeal=1`);
    } else {
      setError(
        'We haven\'t received confirmation of your payment yet. If you completed an EcoCash prompt on your phone, it can take a moment — try again in a few seconds, or check your Paynow confirmation email.'
      );
    }
  }

  async function pollForPaid(reference: string): Promise<boolean> {
    for (let attempt = 0; attempt < POLL_MAX_ATTEMPTS; attempt++) {
      const { data } = await supabase
        .from('payment_intents')
        .select('status')
        .eq('our_reference', reference)
        .maybeSingle();

      if (data?.status === 'paid') return true;
      if (data?.status === 'error' || data?.status === 'cancelled') return false;

      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
    }
    return false;
  }

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={GOLD} />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
        <Text style={styles.backText}>← Back</Text>
      </TouchableOpacity>

      <Text style={styles.heading}>Pay to arrange this deal</Text>
      <Text style={styles.subheading}>
        Chatting with the seller is always free. A small fee applies when you're ready to arrange Meet & Pay
        or book delivery — this fee is non-refundable and isn't held against your purchase, even if you and
        the seller agree on a different price.
      </Text>

      {hasFreeUnlock && (
        <View style={styles.freeBanner}>
          <Text style={styles.freeBannerText}>
            🎁 You have {freeUnlocksRemaining} free unlock{freeUnlocksRemaining === 1 ? '' : 's'} remaining
          </Text>
        </View>
      )}

      {error ? (
        <View style={styles.errorBox}><Text style={styles.errorText}>⚠️ {error}</Text></View>
      ) : null}

      <View style={styles.summaryCard}>
        {title ? <Text style={styles.itemTitle}>{title}</Text> : null}
        <View style={styles.summaryRow}>
          <Text style={styles.summaryLabel}>Listed price</Text>
          <Text style={styles.summaryValue}>${priceNum}</Text>
        </View>
        <View style={styles.divider} />
        <View style={styles.summaryRow}>
          <Text style={styles.summaryLabelBold}>
            {isCapped ? 'Arrange-deal fee (capped)' : isMinimum ? 'Arrange-deal fee (minimum)' : 'Arrange-deal fee (5%)'}
          </Text>
          {isPromoActive() || hasFreeUnlock ? (
            <Text style={styles.summaryValueFree}>FREE</Text>
          ) : (
            <Text style={styles.summaryValueGold}>${unlockFeeAmount}</Text>
          )}
        </View>
        <Text style={styles.summaryNote}>
          {isPromoActive()
            ? `Free for everyone through Jan 31, 2027 \u2014 launch promotion. Normally ${isCapped ? `capped at $${UNLOCK_FEE_CAP}` : isMinimum ? `a minimum of $${UNLOCK_FEE_MIN.toFixed(2)}` : `$${unlockFeeAmount}`}.`
            : hasFreeUnlock
            ? `Normally ${isCapped ? `capped at $${UNLOCK_FEE_CAP}` : isMinimum ? `a minimum of $${UNLOCK_FEE_MIN.toFixed(2)}` : `$${unlockFeeAmount}`} — this one's on us.`
            : isCapped
            ? `Capped at $${UNLOCK_FEE_CAP} regardless of listed price. Non-refundable and not credited toward the final price.`
            : isMinimum
            ? `Minimum fee of $${UNLOCK_FEE_MIN.toFixed(2)} applies regardless of listed price. Non-refundable and not credited toward the final price.`
            : 'Non-refundable. This is not credited toward the final price.'}
        </Text>
        {!isPromoActive() && !hasFreeUnlock && freeUnlocksRemaining === 0 && (
          <Text style={styles.usedUpNote}>You've used your 5 free unlocks — this one's paid.</Text>
        )}
      </View>

      <View style={styles.infoBox}>
        <InfoStep icon="💬" text="Chat with the seller — always free, no message limit" />
        <InfoStep icon="🔓" text="This fee unlocks Meet & Pay and delivery booking" />
        <InfoStep icon="✅" text="Use Meet & Pay to confirm once you've inspected the item" />
      </View>

      {isPromoActive() ? (
        <TouchableOpacity
          style={[styles.freeBtn, claimingFree && { opacity: 0.6 }]}
          onPress={handleUnlockFreePromo}
          disabled={claimingFree}
        >
          {claimingFree
            ? <ActivityIndicator color={BLACK} />
            : <Text style={styles.payBtnText}>Unlock free — launch promo</Text>
          }
        </TouchableOpacity>
      ) : hasFreeUnlock ? (
        <TouchableOpacity
          style={[styles.freeBtn, claimingFree && { opacity: 0.6 }]}
          onPress={handleClaimFreeUnlock}
          disabled={claimingFree}
        >
          {claimingFree
            ? <ActivityIndicator color={BLACK} />
            : <Text style={styles.payBtnText}>Unlock for free</Text>
          }
        </TouchableOpacity>
      ) : (
        <TouchableOpacity
          style={[styles.payBtn, (paying || verifying) && { opacity: 0.6 }]}
          onPress={handlePayUnlockFee}
          disabled={paying || verifying}
        >
          {paying ? (
            <ActivityIndicator color="#fff" />
          ) : verifying ? (
            <>
              <ActivityIndicator color="#fff" />
              <Text style={styles.payBtnSubText}>Confirming your payment…</Text>
            </>
          ) : (
            <Text style={styles.payBtnText}>Pay ${unlockFeeAmount} to arrange deal</Text>
          )}
        </TouchableOpacity>
      )}
    </View>
  );
}

function InfoStep({ icon, text }: { icon: string; text: string }) {
  return (
    <View style={styles.infoRow}>
      <Text style={styles.infoIcon}>{icon}</Text>
      <Text style={styles.infoText}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#111111', padding: 20, paddingTop: Platform.OS === 'ios' ? 56 : 40 },
  center: { flex: 1, backgroundColor: '#111', alignItems: 'center', justifyContent: 'center' },

  backBtn: { marginBottom: 16 },
  backText: { color: GREY, fontSize: 14 },
  heading: { fontSize: 24, fontWeight: '800', color: '#fff', marginBottom: 8 },
  subheading: { fontSize: 13, color: GREY, lineHeight: 19, marginBottom: 24 },

  freeBanner: { backgroundColor: '#1a2a1a', borderRadius: 10, padding: 12, marginBottom: 16, borderWidth: 0.5, borderColor: '#2a4a2a' },
  freeBannerText: { color: GREEN, fontSize: 13, fontWeight: '700', textAlign: 'center' },

  errorBox: { backgroundColor: '#3a1a1a', borderRadius: 10, padding: 12, marginBottom: 16 },
  errorText: { color: '#ff8a8a', fontSize: 13 },

  summaryCard: { backgroundColor: BLACK, borderRadius: 16, padding: 20, marginBottom: 16, borderWidth: 0.5, borderColor: '#333' },
  itemTitle: { fontSize: 15, fontWeight: '700', color: '#fff', marginBottom: 14 },
  summaryRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8 },
  summaryLabel: { fontSize: 13, color: GREY },
  summaryValue: { fontSize: 13, color: '#fff' },
  summaryLabelBold: { fontSize: 14, fontWeight: '700', color: '#fff' },
  summaryValueGold: { fontSize: 22, fontWeight: '800', color: GOLD },
  summaryValueFree: { fontSize: 22, fontWeight: '800', color: GREEN },
  divider: { height: 1, backgroundColor: '#2a2a2a', marginVertical: 8 },
  summaryNote: { fontSize: 11, color: '#888', marginTop: 8, lineHeight: 16 },
  usedUpNote: { fontSize: 11, color: '#888', marginTop: 8, lineHeight: 16, fontStyle: 'italic' },

  infoBox: { backgroundColor: BLACK, borderRadius: 14, padding: 18, marginBottom: 24, borderWidth: 0.5, borderColor: '#333' },
  infoRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 12 },
  infoIcon: { fontSize: 18, width: 26 },
  infoText: { fontSize: 13, color: '#ccc', flex: 1 },

  payBtn: { backgroundColor: GOLD, borderRadius: 14, paddingVertical: 16, alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 10 },
  freeBtn: { backgroundColor: GREEN, borderRadius: 14, paddingVertical: 16, alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 10 },
  payBtnText: { color: BLACK, fontSize: 16, fontWeight: '800' },
  payBtnSubText: { color: BLACK, fontSize: 14, fontWeight: '700' },
});
