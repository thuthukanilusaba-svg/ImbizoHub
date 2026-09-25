// app/dealer-pro-pay.tsx
// Dealer Pro subscription purchase screen.
//
// dealer.tsx has always displayed "Dealer Pro Plan · Renews 1 Aug 2026 ·
// $30/month" as hardcoded mock text, with zero real payment or
// subscription state behind it — one of the three outstanding items
// from the original project plan never actually built. This screen
// closes that gap, reusing the exact real-Paynow pattern already proven
// working in quotes.tsx and unlock.tsx: create-payment → Paynow
// checkout → poll payment_intents (updated by the webhook) → reveal on
// confirmed payment. No new payment architecture invented.
//
// $30 buys 6 months, matching the "paid boolean + expires_at" pattern
// already proven correct for delivery/transport operator registrations.
//
// RE-PAUSED (found during a review pass): the feature list previously
// claimed "Priority placement in search results" and "Full listing
// performance analytics" — at the time, both looked unbuilt.
// explore.tsx/index.tsx sort purely by created_at, no Pro-boost logic
// exists anywhere, so "Priority placement" genuinely is still unbuilt.
// "Full listing performance analytics" turned out to be a false
// alarm on closer inspection — a real, properly Dealer-Pro-gated
// screen (analytics.tsx) already exists, computing genuine numbers
// from the listings table. The claim is restored below, linking to
// that real screen. dealer.tsx's separate inline stats card
// ($2,840, 23, 4.9, etc.) is still hardcoded mock text and still not
// gated behind Pro at all — that's a different surface, fixed
// separately, not the same thing as this real dedicated screen.
//
// The single DEALER_PRO_PAUSED flag was split into two on 23 Sep 2026 —
// see DEALER_PRO_HIDDEN and DEALER_PRO_PAYMENT_OPEN below. The offer is
// now visible while payment stays shut, because "can people see it" and
// "can people be charged" were never the same question. Already-active
// subscribers are
// completely unaffected either way (see the `success || currentlyActive`
// branch below) — this only blocks NEW purchases while paused, never
// blocks managing/renewing an existing one.
//
// FIX (cosmetic, but worth closing): the "Full listing performance
// analytics" feature row's own comment claimed it was "restored,
// linking to that real screen" — but the Feature component had no tap
// handler at all, just static text. Nobody was told anything false
// (the feature genuinely exists and is genuinely gated correctly on
// analytics.tsx), it just wasn't literally clickable the way the
// comment implied. Made Feature accept an optional onPress, and wired
// this one specifically to /analytics — matches the comment's own
// claim now, and gives an active subscriber a real, direct way to
// reach the feature being advertised right here, not just a promise.
//
// Usage: router.push('/dealer-pro-pay')

// TWO FLAGS, not one, because "can people see it" and "can people be
// charged" are different questions and were previously the same switch.
//
// DEALER_PRO_HIDDEN false  -> the offer is visible: feature list, price,
//                             everything. Dealers can read what Pro is.
// DEALER_PRO_PAYMENT_OPEN false -> nothing can take money. The button
//                             states the opening date instead of calling
//                             Paynow.
//
// Held shut on purpose (product decision, 23 Sep 2026): payment_intents
// and transactions are both EMPTY — not one payment has ever completed
// on this system. Opening a $30 button would make the first stranger who
// taps it the person who tests Paynow for us. Verified Seller is paused
// for the same reason.
//
// TO OPEN PAYMENT IN FEBRUARY: put one real payment through yourself
// first, confirm a paid row lands in transactions, and only then set
// DEALER_PRO_PAYMENT_OPEN to true. The short shop link the feature list
// advertises was the other blocker and is now built (app/shop-link.tsx,
// lib/slug.ts, profiles.slug) — nothing on this list is a promise any
// more.
const DEALER_PRO_HIDDEN = false;
const DEALER_PRO_PAYMENT_OPEN = false;

// FREE TRIAL, closing 31 January 2027 (product decision, 25 Sep 2026).
//
// The problem it solves: February is the first time anyone will be asked
// for $30, and nobody will have the faintest idea what they are buying.
// A dealer who has spent four months with the badge on their listings and
// a short link on their van knows exactly what lapsing costs them. A
// dealer meeting the offer for the first time on 1 February does not.
//
// It only works because the Dealer badge became live-derived on
// 25 Sep 2026 (lib/badges.ts). Before that the badge was frozen at post
// time, so granting Pro changed nothing a seller could see and the trial
// would have handed them an invoice-shaped nothing.
//
// The grant runs server-side — register_dealer_pro_free_trial() — because
// prevent_profile_privilege_escalation blocks a user writing
// dealer_pro_active on themselves, which is the whole reason gating the
// shop slug on Dealer Pro means anything. The RPC re-checks the date and
// the "has at least one listing" rule itself; neither is trusted from
// here.
//
// TO CLOSE IT EARLY: set this false. The RPC stays safe either way — it
// refuses after 31 January regardless of what the app believes.
const DEALER_PRO_FREE_TRIAL = true;
const FREE_TRIAL_ENDS = '31 January 2027';

import { useRouter } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator, Platform, ScrollView, StyleSheet,
  Text, TouchableOpacity, View,
} from 'react-native';
import { extractFunctionError } from '../../lib/paymentError';
import { supabase } from '../../lib/supabase';

const GOLD = '#B8860B';
const BLACK = '#1A1A18';
const DARK = '#2a2a2a';
const GREY = '#AAAAAA';
const GREEN = '#4fc96e';

const PRICE = 30;
const POLL_INTERVAL_MS = 2000;
const POLL_MAX_ATTEMPTS = 20;

export default function DealerProPayScreen() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [myId, setMyId] = useState('');
  const [myEmail, setMyEmail] = useState('');
  const [currentlyActive, setCurrentlyActive] = useState(false);
  const [expiresAt, setExpiresAt] = useState<string | null>(null);
  const [paying, setPaying] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [claiming, setClaiming] = useState(false);

  useEffect(() => { init(); }, []);

  async function init() {
    setLoading(true);
    const { data: { user } } = await supabase.auth.getUser();

    if (!user || user.is_anonymous) {
      router.push('/register');
      return;
    }

    setMyId(user.id);
    setMyEmail(user.email ?? '');

    const { data: profile } = await supabase
      .from('profiles')
      .select('dealer_pro_active, dealer_pro_expires_at')
      .eq('id', user.id)
      .maybeSingle();

    const isActive = !!(
      profile?.dealer_pro_active &&
      profile?.dealer_pro_expires_at &&
      new Date(profile.dealer_pro_expires_at).getTime() > Date.now()
    );
    setCurrentlyActive(isActive);
    setExpiresAt(profile?.dealer_pro_expires_at ?? null);

    setLoading(false);
  }

  // Free trial claim. Deliberately NOT routed through create-payment:
  // no intent, no amount, no transactions row. `transactions` is the
  // record of money actually taken, and it is also the table to check in
  // February to confirm Paynow works end to end — a row of zeroes in it
  // would make an untested payment path look tested.
  async function handleClaimFreeTrial() {
    if (!DEALER_PRO_FREE_TRIAL || DEALER_PRO_PAYMENT_OPEN) return;

    setError('');
    setClaiming(true);

    const { error: rpcError } = await supabase.rpc('register_dealer_pro_free_trial');

    setClaiming(false);

    if (rpcError) {
      // The RPC's messages are written to be read by a dealer, not a
      // developer ("Post a listing first — ..."), so they are shown as-is.
      setError(rpcError.message);
      return;
    }

    setSuccess(true);
    await init();
  }

  async function handlePay() {
    // Defence in depth. The button above is not rendered while payment is
    // closed, but this function is also reachable from a retry path, and
    // a payment screen is the wrong place to rely on the UI alone.
    if (!DEALER_PRO_PAYMENT_OPEN) return;

    setError('');
    setPaying(true);

    const { data, error: fnError } = await supabase.functions.invoke('create-payment', {
      body: {
        kind: 'dealer_pro_subscription',
        amount: PRICE,
        email: myEmail,
        buyer_id: myId,
      },
    });

    if (fnError || !data?.checkoutUrl) {
      setError(await extractFunctionError(fnError, data, 'Could not start payment. Please try again.'));
      setPaying(false);
      return;
    }

    const { reference, checkoutUrl } = data;

    await WebBrowser.openBrowserAsync(checkoutUrl);

    setPaying(false);
    setVerifying(true);

    const paid = await pollForPaid(reference);

    setVerifying(false);

    if (paid) {
      setSuccess(true);
      await init();
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

  if (success || currentlyActive) {
    return (
      <View style={styles.container}>
        <ScrollView contentContainerStyle={styles.content}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
            <Text style={styles.backText}><Text style={styles.backArrow}>‹</Text> Back</Text>
          </TouchableOpacity>
          <View style={styles.successCard}>
            <Text style={styles.successEmoji}>⭐</Text>
            <Text style={styles.successTitle}>Dealer Pro is active</Text>
            {expiresAt && (
              <Text style={styles.successBody}>
                {/* "Renews" is wrong for a trial — nothing renews, it
                    stops. Saying so now is cheaper than a dealer finding
                    out on 1 February. */}
                {DEALER_PRO_PAYMENT_OPEN
                  ? `Renews on ${new Date(expiresAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}`
                  : `Free until ${new Date(expiresAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}, then $${PRICE} for six months`}
              </Text>
            )}
            {/* NEW: active subscribers get the same real, tappable link
                to analytics.tsx as the feature-list row below — this
                is the screen they'd land on right after subscribing,
                so it's worth being reachable here too, not just on the
                pre-purchase feature list. */}
            <TouchableOpacity style={styles.analyticsLinkBtn} onPress={() => router.push('/analytics')}>
              <Text style={styles.analyticsLinkBtnText}>📊 View my listing analytics</Text>
            </TouchableOpacity>
            {/* The one Pro benefit that needs an action before it does
                anything. Analytics works the moment you subscribe; a
                shop link does nothing until you have claimed a name,
                so the moment right after subscribing is when to ask. */}
            <TouchableOpacity style={styles.analyticsLinkBtn} onPress={() => router.push('/shop-link')}>
              <Text style={styles.analyticsLinkBtnText}>🔗 Claim my short shop link</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.doneBtn} onPress={() => router.replace('/dealer')}>
              <Text style={styles.doneBtnText}>Back to Dashboard</Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </View>
    );
  }

  if (DEALER_PRO_HIDDEN && !currentlyActive) {
    return (
      <View style={styles.container}>
        <ScrollView contentContainerStyle={styles.content}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
            <Text style={styles.backText}><Text style={styles.backArrow}>‹</Text> Back</Text>
          </TouchableOpacity>
          <View style={styles.successCard}>
            <Text style={styles.successEmoji}>⭐</Text>
            <Text style={styles.successTitle}>Coming soon</Text>
            {/* Names a date rather than "soon". Every fee on ImbizoHub is
                free until 31 January 2027, so a dealer reading this is
                not being kept waiting for a product — they already have
                the promotion. Saying so is more honest than an open-ended
                "check back", and it sets the moment Pro starts mattering
                instead of leaving it vague. */}
            <Text style={styles.successBody}>
              Dealer Pro opens in February 2027. Until 31 January
              everything on ImbizoHub is free anyway — list as much as you
              like, and we&apos;ll tell you before anything changes.
            </Text>
            <TouchableOpacity style={styles.doneBtn} onPress={() => router.replace('/dealer')}>
              <Text style={styles.doneBtnText}>Back to Dashboard</Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Text style={styles.backText}><Text style={styles.backArrow}>‹</Text> Back</Text>
        </TouchableOpacity>

        <Text style={styles.heading}>Dealer Pro</Text>
        <Text style={styles.subheading}>Everything you need to run a serious selling operation.</Text>

        {/* CHANGED (1 Sep 2026). "Buyers message you for free — no unlock
            fee for them" was removed because it stopped being true the day
            buying on listings became free for everyone. It was Pro's
            headline benefit; now every seller has it, so charging $30 for
            it would be selling something the buyer already gets.

            Deliberately NOT replaced with free featured-listing slots,
            which is the obvious substitute and the wrong one. Pro works out
            at $5/month and featuring costs $5 for 7 days — one free slot a
            month makes Pro exactly break even while cannibalising the
            featuring revenue from the sellers most likely to buy it, and
            unlimited slots would let one dealer with sixty listings own the
            whole Home strip, which destroys what the $5 slot is worth to
            everyone else. When Pro relaunches it should carry a featuring
            DISCOUNT, not free featuring.

            What is left is what genuinely costs nothing to give and only
            matters to someone selling at volume. Pro is still paused
            (payment is still shut), so this is honesty in the
              shop window rather than a live pricing change. */}
        <View style={styles.card}>
          {/* REWRITTEN 23 Sep 2026, after auditing what Pro actually does
              in code rather than what this screen claimed.

              REMOVED: "Bulk-import your whole catalogue at once."
              whatsapp-import.tsx has NO Pro check — every user already
              has it, and it should stay that way, because bulk import is
              how inventory arrives. Selling something the buyer already
              has for free is the same mistake that killed the old
              "buyers message you free" line, and a dealer who discovers
              it trusts nothing else on this list.

              ADDED: priority placement. It is the one benefit that is
              both real and commercially worth money — explore.tsx sorts
              Pro sellers above everyone else in search results — and it
              appeared nowhere except the paused notice.

              ADDED: the short shop link. NOT the catalogue itself — the
              catalogue went live for EVERY seller on 23 Sep 2026 and
              stays free. A catalogue only Pro sellers have is a
              catalogue nobody has while nobody is subscribed, and every
              seller who shares their page puts ImbizoHub in front of
              someone who does not have it.

              What Pro sells is the readable address:
              imbizohub.com/s/kombi-spares rather than
              /seller?id=be32a5f4-... Nobody puts a UUID in a WhatsApp
              status. It costs nothing to withhold and costs no shares
              to withhold it.

              BUILT 23 Sep 2026 and tappable below — profiles.slug, the
              enforce_slug_requires_dealer_pro trigger, /s/:slug through
              Vercel to the seller-preview function, and app/shop-link.tsx
              to claim one. This line now advertises something that
              exists, which is what had to be true before
              DEALER_PRO_PAYMENT_OPEN could ever go true. */}
          <Feature text="Your items come up first when buyers search" />
          <Feature text="Dealer badge on every listing, including bulk imports" />
          <Feature
            text="Your own short shop link — imbizohub.com/s/yourname"
            onPress={() => router.push('/shop-link')}
          />
          {/* Tappable, matching what the top-of-file comment claims.
              Routes to the real, correctly-gated analytics screen. */}
          <Feature text="Full listing performance analytics" onPress={() => router.push('/analytics')} />
        </View>

        <View style={styles.priceCard}>
          <Text style={styles.priceLabel}>6 months of Dealer Pro</Text>
          <Text style={styles.priceValue}>${PRICE.toFixed(2)}</Text>
          <Text style={styles.priceNote}>One-time payment — renew any time before or after it expires.</Text>
        </View>

        {error ? (
          <View style={styles.errorBox}><Text style={styles.errorText}>⚠️ {error}</Text></View>
        ) : null}

        {/* Deliberately not a disabled-looking version of the real
            button. A greyed-out "Pay" reads as something that is broken
            or that you are not allowed to use; a plain statement of when
            it opens reads as a plan. Nothing here can reach Paynow. */}
        {DEALER_PRO_PAYMENT_OPEN ? (
          <TouchableOpacity
            style={[styles.payBtn, (paying || verifying) && { opacity: 0.6 }]}
            onPress={handlePay}
            disabled={paying || verifying}
          >
            {paying || verifying
              ? <ActivityIndicator color={BLACK} />
              : <Text style={styles.payBtnText}>Pay ${PRICE.toFixed(2)} with Paynow</Text>
            }
          </TouchableOpacity>
        ) : DEALER_PRO_FREE_TRIAL ? (
          <>
            <TouchableOpacity
              style={[styles.payBtn, claiming && { opacity: 0.6 }]}
              onPress={handleClaimFreeTrial}
              disabled={claiming}
            >
              {claiming
                ? <ActivityIndicator color={BLACK} />
                : <Text style={styles.payBtnText}>Turn it on free</Text>}
            </TouchableOpacity>
            <View style={styles.notOpenBox}>
              <Text style={styles.notOpenTitle}>Free until {FREE_TRIAL_ENDS}</Text>
              <Text style={styles.notOpenBody}>
                Use the whole thing now and see what it does for you. From
                February it&apos;s ${PRICE} for six months — we&apos;ll tell you before
                anything changes, and nothing happens to your account until you
                decide.
              </Text>
            </View>
          </>
        ) : (
          <View style={styles.notOpenBox}>
            <Text style={styles.notOpenTitle}>Opens February 2027</Text>
            <Text style={styles.notOpenBody}>
              Dealer Pro isn&apos;t taking payments yet. Everything you can do on
              ImbizoHub today — listing, importing your catalogue, chatting,
              doing deals — stays free either way.
            </Text>
          </View>
        )}
        {verifying && (
          <Text style={styles.verifyingNote}>Waiting for payment confirmation...</Text>
        )}
      </ScrollView>
    </View>
  );
}

// FIX: Feature now optionally accepts an onPress — when provided, the
// row renders as a real TouchableOpacity with a chevron affordance
// instead of plain static text, so it's visually obvious which
// features are actually clickable versus purely informational.
function Feature({ text, onPress }: { text: string; onPress?: () => void }) {
  const content = (
    <>
      <Text style={styles.featureCheck}>✓</Text>
      <Text style={[styles.featureText, onPress && styles.featureTextLink]}>{text}</Text>
      {onPress && <Text style={styles.featureArrow}>›</Text>}
    </>
  );

  if (onPress) {
    return (
      <TouchableOpacity style={styles.featureRow} onPress={onPress} activeOpacity={0.7}>
        {content}
      </TouchableOpacity>
    );
  }

  return <View style={styles.featureRow}>{content}</View>;
}

const styles = StyleSheet.create({
  notOpenBox: { backgroundColor: DARK, borderRadius: 14, padding: 18, borderWidth: 1, borderColor: '#3a3a36', marginTop: 4 },
  notOpenTitle: { color: GOLD, fontSize: 15, fontWeight: '800', marginBottom: 6 },
  notOpenBody: { color: GREY, fontSize: 13, lineHeight: 19 },
  container: { flex: 1, backgroundColor: '#111111' },
  content: { padding: 20, paddingTop: Platform.OS === 'ios' ? 56 : 40 },
  center: { flex: 1, backgroundColor: '#111', alignItems: 'center', justifyContent: 'center' },

  backBtn: { marginBottom: 16 },
  backText: { color: GREY, fontSize: 14 },
  // NEW: bigger than the label text so the '‹' glyph reads clearly — direct product decision ("back symbol too small").
  backArrow: { fontSize: 20 },
  heading: { fontSize: 26, fontWeight: '800', color: '#fff', marginBottom: 6 },
  subheading: { fontSize: 13, color: GREY, marginBottom: 24 },

  card: { backgroundColor: BLACK, borderRadius: 14, padding: 18, marginBottom: 16, borderWidth: 0.5, borderColor: '#333' },
  featureRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 12 },
  featureCheck: { color: GREEN, fontSize: 15, fontWeight: '800' },
  featureText: { color: '#fff', fontSize: 13, flex: 1 },
  featureTextLink: { color: GOLD, fontWeight: '600' },
  featureArrow: { color: GOLD, fontSize: 16 },

  priceCard: { backgroundColor: DARK, borderRadius: 14, padding: 20, alignItems: 'center', marginBottom: 20, borderWidth: 1, borderColor: GOLD },
  priceLabel: { color: GREY, fontSize: 12, marginBottom: 6 },
  priceValue: { color: GOLD, fontSize: 36, fontWeight: '800', marginBottom: 8 },
  priceNote: { color: '#888', fontSize: 11, textAlign: 'center' },

  errorBox: { backgroundColor: '#3a1a1a', borderRadius: 10, padding: 12, marginBottom: 16 },
  errorText: { color: '#ff8a8a', fontSize: 13, textAlign: 'center' },

  payBtn: { backgroundColor: GOLD, borderRadius: 14, paddingVertical: 16, alignItems: 'center' },
  payBtnText: { color: BLACK, fontSize: 15, fontWeight: '800' },
  verifyingNote: { color: GREY, fontSize: 12, textAlign: 'center', marginTop: 12 },

  successCard: { alignItems: 'center', paddingTop: 60 },
  successEmoji: { fontSize: 56, marginBottom: 16 },
  successTitle: { color: '#fff', fontSize: 20, fontWeight: '800', marginBottom: 8 },
  successBody: { color: GREY, fontSize: 13, marginBottom: 28 },
  analyticsLinkBtn: { paddingVertical: 12, paddingHorizontal: 20, marginBottom: 16 },
  analyticsLinkBtnText: { color: GOLD, fontSize: 14, fontWeight: '700' },
  doneBtn: { backgroundColor: GOLD, borderRadius: 14, paddingVertical: 14, paddingHorizontal: 32 },
  doneBtnText: { color: BLACK, fontSize: 14, fontWeight: '800' },
});
