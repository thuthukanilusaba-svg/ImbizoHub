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
// already proven correct for delivery/transport operator registrations
// — UPDATED AGAIN: was 30 days for $30, then 1 year for $30; product
// decision to keep the price but shorten to a 6-month period instead
// (see confirm-payment.ts's dealer_pro_subscription branch —
// setMonth(+6) instead of setFullYear(+1)), effectively doubling the
// annualized price without changing what's shown at checkout. Still a
// one-time checkout via Paynow's API, not automatic recurring billing —
// renewal is just buying another 6-month period.
//
// NEW: closes a real gap found while adding the same guard to
// hirevan.tsx — this screen previously had NO internal pause check at
// all. dealer.tsx's card correctly hides the "Pay" path from new
// subscribers when paused, but anyone reaching this screen by any
// OTHER route (a bookmark, a stale deep link, anything bypassing that
// card) could still complete a real purchase regardless of the
// supposedly-paused state. DEALER_PRO_PAUSED now guards this screen
// directly, the same way VAN_HIRE_PAUSED guards hirevan.tsx — checked
// both in handlePay() and in the render below. Already-active
// subscribers are unaffected either way (see the `success ||
// currentlyActive` branch below, unchanged) — this only blocks NEW
// purchases while paused, never blocks managing/renewing an existing
// one.
//
// Usage: router.push('/dealer-pro-pay')

const DEALER_PRO_PAUSED = false;

import { useRouter } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator, Platform, ScrollView, StyleSheet,
  Text, TouchableOpacity, View,
} from 'react-native';
import { supabase } from '../../lib/supabase';

const GOLD = '#B8860B';
const BLACK = '#1A1A18';
const DARK = '#2a2a2a';
const GREY = '#AAAAAA';
const GREEN = '#4fc96e';

const PRICE = 30;
const POLL_INTERVAL_MS = 2000;
const POLL_MAX_ATTEMPTS = 20; // ~40 seconds total — was 15 (~30s); widened
// after a real trip_deposit payment on quotes.tsx took 32s to confirm
// and got missed under the old window. Same webhook path, same fix.

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

    // Same principle applied throughout the app today: this is a real
    // payment, so it requires a real account — anonymous sessions are
    // redirected to register rather than silently failing later.
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
    // Guard lives here, not just in the render branch below — same
    // defense-in-depth reasoning as hirevan.tsx's handleSubmit().
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
      setError(fnError?.message || data?.error || 'Could not start payment. Please try again.');
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
      await init(); // pick up the server-confirmed subscription state
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
              Dealer Pro is on its way — priority placement, real
              dashboard stats, and full listing analytics. Check back
              soon.
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
          {/* REMOVED: "Unlimited active listings" — there's no listing
              cap for anyone on the app right now, free or Pro, so this
              was an empty promise (nothing to be exempt FROM). Product
              decision: leave listings uncapped for everyone rather than
              introduce a cap just to make this claim meaningful, and
              drop the claim itself. Replaced with the Dealer badge
              benefit, which IS real — see post.tsx's badge assignment. */}
          <Feature text="Dealer badge on all your listings" />
          <Feature text="Priority placement in search results" />
          <Feature text="Full listing performance analytics" />
          <Feature text="A dedicated Dashboard with monthly stats" />
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

function Feature({ text }: { text: string }) {
  return (
    <View style={styles.featureRow}>
      <Text style={styles.featureCheck}>✓</Text>
      <Text style={styles.featureText}>{text}</Text>
    </View>
  );
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
  doneBtn: { backgroundColor: GOLD, borderRadius: 14, paddingVertical: 14, paddingHorizontal: 32 },
  doneBtnText: { color: BLACK, fontSize: 14, fontWeight: '800' },
});
