// app/operator-register-pay.tsx
// Transport operator (van-hire trip bidding) pays a $10/year registration
// fee before they can browse open trip requests and submit quotes in
// operator-requests.tsx. Mirrors delivery-operator-register-pay.tsx (the
// delivery-job registration fee), but writes to `profiles` instead of
// `delivery_operators` — this is a SEPARATE registration/role from
// delivery operator. See operator-requests.tsx's checkStatus() for the
// exact gating logic this screen needs to satisfy:
//   profile.account_type === 'transport_operator'
//   && profile.operator_status === 'active'
//   && profile.registration_expires_at > now
//
// FIX: this file previously contained a duplicate of
// delivery-operator-register-pay.tsx — same header comment, same
// delivery_operators reads/writes, same 'delivery_operator_registration'
// kind. That meant a transport operator paying here would never actually
// get gated into operator-requests.tsx, since nothing here ever touched
// profiles.operator_status. Rewritten to target the correct table/kind.
//
// ASSUMPTION FLAGGED: this rewrite assumes registering as a transport
// operator (setting account_type = 'transport_operator') happens at the
// moment payment is confirmed, same as the account's operator_status and
// registration_expires_at. If account_type is actually set earlier by a
// separate "become an operator" onboarding step (before this payment
// screen is ever reached), remove the account_type write from the
// webhook branch below and confirm this screen's init() check still
// makes sense for that flow.
//
// REAL PAYNOW INTEGRATION: handlePay() calls the create-payment Edge
// Function with kind: 'transport_operator_registration', opens the real
// Paynow checkout, and polls payment_intents for confirmation — same
// pattern as unlock.tsx and delivery-operator-register-pay.tsx. The
// actual profiles update is performed by the paynow-webhook Edge
// Function once Paynow confirms payment, never by this screen directly.

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
const REG_FEE = 10;

const POLL_INTERVAL_MS = 2000;
const POLL_MAX_ATTEMPTS = 20; // ~40 seconds total — was 15 (~30s); widened
// after a real trip_deposit payment on quotes.tsx took 32s to confirm
// and got missed under the old window. Same webhook path, same fix.

export default function OperatorRegisterPayScreen() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [paying, setPaying] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState('');
  const [myId, setMyId] = useState('');
  const [myEmail, setMyEmail] = useState('');
  const [profileRow, setProfileRow] = useState<any>(null);

  useEffect(() => { init(); }, []);

  async function init() {
    setLoading(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { router.replace('/login'); return; }
    setMyId(user.id);
    setMyEmail(user.email ?? '');

    const { data: profile, error: fetchError } = await supabase
      .from('profiles')
      .select('operator_status, account_type, registration_expires_at')
      .eq('id', user.id)
      .maybeSingle();

    if (fetchError) { setError(fetchError.message); setLoading(false); return; }

    // Already active and not expired — skip straight to trip requests.
    // Same gating logic as operator-requests.tsx's checkStatus().
    const isActive = profile?.account_type === 'transport_operator' &&
      profile?.operator_status === 'active' &&
      profile?.registration_expires_at &&
      new Date(profile.registration_expires_at).getTime() > Date.now();

    if (isActive) {
      router.replace('/operator-requests');
      return;
    }

    setProfileRow(profile);
    setLoading(false);
  }

  async function handlePay() {
    setPaying(true);
    setError('');

    const { data, error: fnError } = await supabase.functions.invoke('create-payment', {
      body: {
        kind: 'transport_operator_registration',
        amount: REG_FEE,
        email: myEmail,
        operator_user_id: myId,
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
      setDone(true);
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

  if (done) {
    return (
      <View style={styles.successScreen}>
        <Text style={styles.successEmoji}>🚐</Text>
        <Text style={styles.successTitle}>You're registered!</Text>
        <Text style={styles.successBody}>
          Your transport operator account is now active. You can start bidding on open trip requests immediately.
        </Text>
        <View style={styles.successCard}>
          <Text style={styles.successCardTitle}>What happens next</Text>
          <Step n="1" text="Browse open trip requests from customers" />
          <Step n="2" text="Submit a quote with your price and vehicle" />
          <Step n="3" text="If accepted, the customer's commitment fee (7%, capped at $30) reveals your contact details" />
          <Step n="4" text="Agree on how the remaining balance gets paid" />
          {/* UPDATED (pricing model simplified, and this line was never
              accurate to begin with — the 3% was only ever tracked as
              a debt on profiles.commission_owed, nothing was ever
              actually "deducted automatically"). The separate 3%
              commission no longer exists at all — operators keep their
              full quoted price, ImbizoHub's entire take is the
              customer's commitment fee (7%, capped at $30). */}
          <Step n="5" text="You keep 100% of your quoted fare — no additional commission" />
        </View>
        <TouchableOpacity style={styles.startBtn} onPress={() => router.replace('/operator-requests')}>
          <Text style={styles.startBtnText}>View open trip requests →</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const alreadyExpired = profileRow?.operator_status === 'active' && profileRow?.registration_expires_at &&
    new Date(profileRow.registration_expires_at).getTime() <= Date.now();

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
        <Text style={styles.backText}>← Back</Text>
      </TouchableOpacity>

      <Text style={styles.heading}>Transport operator registration</Text>
      <Text style={styles.subheading}>
        {alreadyExpired
          ? 'Your registration has expired. Renew to keep bidding on trip requests.'
          : 'Pay once to unlock trip bidding for 12 months.'}
      </Text>

      {error ? (
        <View style={styles.errorBox}><Text style={styles.errorText}>⚠️ {error}</Text></View>
      ) : null}

      {/* What you get */}
      <View style={styles.benefitsCard}>
        <Text style={styles.benefitsTitle}>What you get</Text>
        <Benefit icon="🔓" text="Instant access to all open trip requests" />
        <Benefit icon="🚐" text="Submit unlimited quotes to customers" />
        <Benefit icon="💵" text="Keep 97% of every completed job" />
        <Benefit icon="⭐" text="Build your rating and reputation on ImbizoHub" />
      </View>

      {/* Pricing */}
      <View style={styles.pricingCard}>
        <View style={styles.pricingRow}>
          <View>
            <Text style={styles.pricingLabel}>Registration fee</Text>
            <Text style={styles.pricingNote}>Renews yearly</Text>
          </View>
          <Text style={styles.pricingAmount}>${REG_FEE}</Text>
        </View>
        <View style={styles.divider} />
        <View style={styles.pricingRow}>
          <View>
            <Text style={styles.pricingLabel}>Commission per job</Text>
            <Text style={styles.pricingNote}>Deducted from your fare automatically</Text>
          </View>
          <Text style={[styles.pricingAmount, { color: GREEN }]}>3%</Text>
        </View>
      </View>

      <TouchableOpacity
        style={[styles.payBtn, (paying || verifying) && { opacity: 0.6 }]}
        onPress={handlePay}
        disabled={paying || verifying}
        activeOpacity={0.85}
      >
        {paying ? (
          <ActivityIndicator color={BLACK} />
        ) : verifying ? (
          <>
            <ActivityIndicator color={BLACK} />
            <Text style={styles.payBtnSub}>Confirming your payment…</Text>
          </>
        ) : (
          <>
            <Text style={styles.payBtnText}>Pay ${REG_FEE} and start bidding</Text>
            <Text style={styles.payBtnSub}>Valid for 12 months</Text>
          </>
        )}
      </TouchableOpacity>

      <Text style={styles.footerNote}>
        By paying you agree to ImbizoHub's transport operator terms. Your registration is valid for 12 months from today.
      </Text>
    </ScrollView>
  );
}

function Benefit({ icon, text }: { icon: string; text: string }) {
  return (
    <View style={styles.benefitRow}>
      <Text style={styles.benefitIcon}>{icon}</Text>
      <Text style={styles.benefitText}>{text}</Text>
    </View>
  );
}

function Step({ n, text }: { n: string; text: string }) {
  return (
    <View style={styles.stepRow}>
      <View style={styles.stepNum}>
        <Text style={styles.stepNumText}>{n}</Text>
      </View>
      <Text style={styles.stepText}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#111111' },
  content: { padding: 20, paddingTop: Platform.OS === 'ios' ? 56 : 40, paddingBottom: 48 },
  center: { flex: 1, backgroundColor: '#111', alignItems: 'center', justifyContent: 'center' },

  backBtn: { marginBottom: 16 },
  backText: { color: GREY, fontSize: 14 },
  heading: { fontSize: 24, fontWeight: '800', color: '#fff', marginBottom: 8 },
  subheading: { fontSize: 13, color: GREY, lineHeight: 19, marginBottom: 24 },

  errorBox: { backgroundColor: '#3a1a1a', borderRadius: 10, padding: 12, marginBottom: 16 },
  errorText: { color: '#ff8a8a', fontSize: 13 },

  benefitsCard: { backgroundColor: BLACK, borderRadius: 14, padding: 18, marginBottom: 14, borderWidth: 0.5, borderColor: '#333' },
  benefitsTitle: { fontSize: 14, fontWeight: '700', color: '#fff', marginBottom: 14 },
  benefitRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, marginBottom: 10 },
  benefitIcon: { fontSize: 18, width: 24 },
  benefitText: { fontSize: 13, color: '#ccc', flex: 1, lineHeight: 18 },

  pricingCard: { backgroundColor: BLACK, borderRadius: 14, padding: 18, marginBottom: 20, borderWidth: 0.5, borderColor: '#333' },
  pricingRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 4 },
  pricingLabel: { fontSize: 14, fontWeight: '600', color: '#fff' },
  pricingNote: { fontSize: 11, color: GREY, marginTop: 2 },
  pricingAmount: { fontSize: 20, fontWeight: '800', color: '#fff' },
  divider: { height: 0.5, backgroundColor: '#2a2a2a', marginVertical: 12 },

  payBtn: { backgroundColor: GOLD, borderRadius: 14, paddingVertical: 18, alignItems: 'center', marginBottom: 16, flexDirection: 'row', justifyContent: 'center', gap: 10 },
  payBtnText: { color: BLACK, fontSize: 16, fontWeight: '800' },
  payBtnSub: { color: '#5a4400', fontSize: 12, marginTop: 4 },

  footerNote: { fontSize: 11, color: '#666', textAlign: 'center', lineHeight: 16 },

  successScreen: { flex: 1, backgroundColor: '#111', padding: 28, paddingTop: 60 },
  successEmoji: { fontSize: 56, marginBottom: 16 },
  successTitle: { fontSize: 26, fontWeight: '800', color: '#fff', marginBottom: 8 },
  successBody: { fontSize: 15, color: GREY, lineHeight: 22, marginBottom: 24 },
  successCard: { backgroundColor: BLACK, borderRadius: 14, padding: 18, marginBottom: 24, borderWidth: 0.5, borderColor: '#333' },
  successCardTitle: { fontSize: 14, fontWeight: '700', color: '#fff', marginBottom: 14 },
  stepRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, marginBottom: 12 },
  stepNum: { width: 24, height: 24, borderRadius: 12, backgroundColor: GOLD, alignItems: 'center', justifyContent: 'center' },
  stepNumText: { color: BLACK, fontSize: 12, fontWeight: '700' },
  stepText: { fontSize: 13, color: '#ccc', flex: 1, lineHeight: 18 },
  startBtn: { backgroundColor: GOLD, borderRadius: 14, paddingVertical: 16, alignItems: 'center' },
  startBtnText: { color: BLACK, fontSize: 16, fontWeight: '800' },
});
