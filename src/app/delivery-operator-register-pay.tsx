// app/delivery-operator-register-pay.tsx
// Delivery operator pays a $10 one-time registration fee (renews yearly)
// before they can appear as a bookable driver or accept delivery jobs.
// Mirrors operator-register-pay.tsx (transport operator trip-bidding fee),
// but writes to delivery_operators instead of profiles.
//
// REAL PAYNOW INTEGRATION (replaces the old instant registration_paid=true
// update): handlePay() now calls the create-payment Edge Function, opens
// the real Paynow checkout, and polls payment_intents for confirmation —
// same pattern as unlock.tsx. The actual delivery_operators update is
// performed by the paynow-webhook Edge Function once Paynow confirms
// payment, never by this screen directly.

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

export default function DeliveryOperatorRegisterPayScreen() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [paying, setPaying] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState('');
  const [myId, setMyId] = useState('');
  const [myEmail, setMyEmail] = useState('');
  const [operatorRow, setOperatorRow] = useState<any>(null);

  useEffect(() => { init(); }, []);

  async function init() {
    setLoading(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { router.replace('/login'); return; }
    setMyId(user.id);
    setMyEmail(user.email ?? '');

    const { data, error: fetchError } = await supabase
      .from('delivery_operators')
      .select('*')
      .eq('user_id', user.id)
      .maybeSingle();

    if (fetchError) { setError(fetchError.message); setLoading(false); return; }

    if (!data) {
      // No delivery_operators row at all — they need to register first.
      setError('No delivery operator profile found. Please register as a delivery operator first.');
      setLoading(false);
      return;
    }

    // Already paid and not expired — skip straight to the dashboard.
    const isActive = data.registration_paid &&
      data.registration_expires_at &&
      new Date(data.registration_expires_at).getTime() > Date.now();

    if (isActive) {
      router.replace('/dealer');
      return;
    }

    setOperatorRow(data);
    setLoading(false);
  }

  async function handlePay() {
    setPaying(true);
    setError('');

    const { data, error: fnError } = await supabase.functions.invoke('create-payment', {
      body: {
        kind: 'delivery_operator_registration',
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
        <Text style={styles.successEmoji}>📦</Text>
        <Text style={styles.successTitle}>You're registered!</Text>
        <Text style={styles.successBody}>
          Your delivery operator account is now active. You can start accepting delivery jobs immediately.
        </Text>
        <View style={styles.successCard}>
          <Text style={styles.successCardTitle}>What happens next</Text>
          <Step n="1" text="Appear in the driver list when buyers book delivery" />
          <Step n="2" text="Accept open delivery requests from your dashboard" />
          <Step n="3" text="Collect the parcel and mark it dispatched, then delivered" />
          <Step n="4" text="Buyer confirms with their PIN — job complete" />
          <Step n="5" text="You keep the full delivery fee ($5 local / $10 intercity) — ImbizoHub's $2 booking fee is collected separately" />
        </View>
        <TouchableOpacity style={styles.startBtn} onPress={() => router.replace('/dealer')}>
          <Text style={styles.startBtnText}>Go to my dashboard →</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const alreadyExpired = operatorRow?.registration_paid && operatorRow?.registration_expires_at &&
    new Date(operatorRow.registration_expires_at).getTime() <= Date.now();

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
        <Text style={styles.backText}>← Back</Text>
      </TouchableOpacity>

      <Text style={styles.heading}>Delivery operator registration</Text>
      <Text style={styles.subheading}>
        {alreadyExpired
          ? 'Your registration has expired. Renew to keep accepting delivery jobs.'
          : 'Pay once to unlock delivery jobs for 12 months.'}
      </Text>

      {error ? (
        <View style={styles.errorBox}><Text style={styles.errorText}>⚠️ {error}</Text></View>
      ) : null}

      {/* What you get */}
      <View style={styles.benefitsCard}>
        <Text style={styles.benefitsTitle}>What you get</Text>
        <Benefit icon="🔓" text="Instant access to all open delivery requests" />
        <Benefit icon="🚗" text="Appear in the driver list buyers choose from" />
        <Benefit icon="💵" text="Keep 100% of the delivery fee — paid cash on collection" />
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
            <Text style={styles.pricingLabel}>Local delivery</Text>
            <Text style={styles.pricingNote}>You keep the full amount</Text>
          </View>
          <Text style={[styles.pricingAmount, { color: GREEN }]}>$5</Text>
        </View>
        <View style={styles.divider} />
        <View style={styles.pricingRow}>
          <View>
            <Text style={styles.pricingLabel}>Intercity delivery</Text>
            <Text style={styles.pricingNote}>You keep the full amount</Text>
          </View>
          <Text style={[styles.pricingAmount, { color: GREEN }]}>$10</Text>
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
            <Text style={styles.payBtnText}>Pay ${REG_FEE} and start delivering</Text>
            <Text style={styles.payBtnSub}>Valid for 12 months</Text>
          </>
        )}
      </TouchableOpacity>

      <Text style={styles.footerNote}>
        By paying you agree to ImbizoHub's delivery operator terms. Your registration is valid for 12 months from today.
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
