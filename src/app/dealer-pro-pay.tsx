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
// DEALER_PRO_PAUSED stays true until "Priority placement" specifically
// is genuinely built — that's the one remaining real gap. Same guard
// mechanism as before (checked in both handlePay() and the render
// branch below), so this is a clean toggle back to false once that
// feature exists, not a rewrite. Already-active subscribers are
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

const DEALER_PRO_PAUSED = true;

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

  async function handlePay() {
    if (DEALER_PRO_PAUSED && !currentlyActive) return;

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
            <Text style={styles.backText}>← Back</Text>
          </TouchableOpacity>
          <View style={styles.successCard}>
            <Text style={styles.successEmoji}>⭐</Text>
            <Text style={styles.successTitle}>Dealer Pro is active</Text>
            {expiresAt && (
              <Text style={styles.successBody}>
                Renews on {new Date(expiresAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}
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
            <TouchableOpacity style={styles.doneBtn} onPress={() => router.replace('/dealer')}>
              <Text style={styles.doneBtnText}>Back to Dashboard</Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </View>
    );
  }

  if (DEALER_PRO_PAUSED && !currentlyActive) {
    return (
      <View style={styles.container}>
        <ScrollView contentContainerStyle={styles.content}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
            <Text style={styles.backText}>← Back</Text>
          </TouchableOpacity>
          <View style={styles.successCard}>
            <Text style={styles.successEmoji}>⭐</Text>
            <Text style={styles.successTitle}>Coming soon</Text>
            <Text style={styles.successBody}>
              Dealer Pro is on its way — priority placement in search
              results is still being built. Check back soon.
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
          <Text style={styles.backText}>← Back</Text>
        </TouchableOpacity>

        <Text style={styles.heading}>Dealer Pro</Text>
        <Text style={styles.subheading}>Everything you need to run a serious selling operation.</Text>

        <View style={styles.card}>
          <Feature text="Dealer badge on all your listings" />
          <Feature text="Buyers message you for free — no unlock fee for them" />
          {/* FIX: now genuinely tappable, matching what the top-of-file
              comment already claimed. Routes straight to the real,
              correctly-gated analytics.tsx screen. */}
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
  container: { flex: 1, backgroundColor: '#111111' },
  content: { padding: 20, paddingTop: Platform.OS === 'ios' ? 56 : 40 },
  center: { flex: 1, backgroundColor: '#111', alignItems: 'center', justifyContent: 'center' },

  backBtn: { marginBottom: 16 },
  backText: { color: GREY, fontSize: 14 },
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
