// app/delivery-operator-register-pay.tsx
// Delivery operator pays a $10 one-time registration fee (renews yearly)
// before they can appear as a bookable driver or accept delivery jobs.
//
// NEW: real Operator Terms link + required checkbox before paying —
// previously "terms" were only ever mentioned in plain, non-clickable
// footer text with no actual document behind them.

import { useRouter } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator, Alert, Linking, Platform, ScrollView, StyleSheet,
  Text, TouchableOpacity, View,
} from 'react-native';
import { extractFunctionError } from '../../lib/paymentError';
import { supabase } from '../../lib/supabase';
import {
  DELIVERY_BOOKING_ENABLED,
  DELIVERY_OPERATOR_SIGNUP_PAUSED_MESSAGE,
  DELIVERY_PAUSED_TITLE,
} from '../../lib/featureFlags';

const GOLD = '#B8860B';
const BLACK = '#1A1A18';
const DARK = '#2a2a2a';
const GREY = '#AAAAAA';
const GREEN = '#4fc96e';
const REG_FEE = 10;

// NEW: launch promotion — free registration until Jan 31, 2027, to
// build momentum while payments/product mature. See
// free-operator-registration-promo.sql for the full reasoning —
// verification status is completely untouched by this; only the paid
// registration itself is free during this window, and expires
// naturally on Feb 1 via the SAME expiry check already used
// everywhere else in the app.
const FREE_PROMO_END = new Date('2027-01-31T23:59:59Z');
const isPromoActive = () => new Date() < FREE_PROMO_END;

const OPERATOR_TERMS_URL = 'https://thuthukanilusaba-svg.github.io/imbizohub-legal/operator-terms.html';

const POLL_INTERVAL_MS = 2000;
const POLL_MAX_ATTEMPTS = 20;

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
  // FIX (real bug, root cause of a raw Postgres error reaching the
  // screen): init() below already set an error message when no
  // delivery_operators row exists for this user, but nothing actually
  // stopped the full pricing/payment form from rendering underneath
  // that message — the form and its pay button stayed fully
  // interactive, so tapping it called register_operator_free_promo()
  // against a user with no row, which hit that RPC's own missing-row
  // fallback and leaked a raw "null value in column full_name..."
  // constraint error onto the screen. This flag gates the form so a
  // missing profile shows ONLY the explanatory error and a way back,
  // the same pattern operator-id-verify.tsx already uses for its own
  // "invalid link" case.
  const [noProfileFound, setNoProfileFound] = useState(false);
  // NEW: real, required Operator Terms acceptance.
  const [agreedToTerms, setAgreedToTerms] = useState(false);

  useEffect(() => { init(); }, []);

  async function init() {
    setLoading(true);

    // PAUSED: new delivery-operator signups are closed — see
    // lib/featureFlags.ts. Checked first, before auth or any DB read,
    // so nothing is created and no checkout can start.
    //
    // This screen matters more than the other entry points because it
    // is where money changes hands: without this guard, anyone who
    // reaches it — a stale link, a back-button return, a bookmarked
    // web URL — could pay $10 for a registration that grants access to
    // a product that isn't running.
    if (!DELIVERY_BOOKING_ENABLED) {
      Alert.alert(DELIVERY_PAUSED_TITLE, DELIVERY_OPERATOR_SIGNUP_PAUSED_MESSAGE || undefined);
      router.replace('/');
      return;
    }

    const { data: { user } } = await supabase.auth.getUser();
    // FIX (real bug, found during a final pre-submission review): was
    // `if (!user)`, missing the same `user.is_anonymous` check found
    // wrong or missing in unlock.tsx, quotes.tsx, and
    // wanted-responses.tsx today. Arguably the most consequential
    // instance of this pattern — this screen lets someone register as
    // a DELIVERY OPERATOR, someone real users trust with their
    // physical parcels and contact details. An anonymous session
    // slipping through here creates a delivery_operators row for
    // someone with zero recoverable identity. This is the only real
    // gate this screen has (neither handleFreeRegister() nor
    // handlePay() has its own separate check), so fixing it here is
    // sufficient — a user who fails this redirects to /register before
    // ever seeing the form. Redirects to /register now, not /login,
    // matching the correct pattern used everywhere else.
    if (!user || user.is_anonymous) { router.replace('/register'); return; }
    setMyId(user.id);
    setMyEmail(user.email ?? '');

    const { data, error: fetchError } = await supabase
      .from('delivery_operators')
      .select('*')
      .eq('user_id', user.id)
      .maybeSingle();

    if (fetchError) { setError(fetchError.message); setLoading(false); return; }

    if (!data) {
      setError('No delivery operator profile found. Please register as a delivery operator first.');
      setNoProfileFound(true);
      setLoading(false);
      return;
    }

    const isActive = data.registration_paid &&
      data.registration_expires_at &&
      new Date(data.registration_expires_at).getTime() > Date.now() &&
      !!data.vehicle_type;

    if (isActive) {
      router.replace('/dealer');
      return;
    }

    const paidButIncomplete = data.registration_paid &&
      data.registration_expires_at &&
      new Date(data.registration_expires_at).getTime() > Date.now() &&
      !data.vehicle_type;

    if (paidButIncomplete) {
      router.replace('/become-operator?type=delivery');
      return;
    }

    setOperatorRow(data);
    setLoading(false);
  }

  // NEW: free-promo registration path — calls register_operator_free_promo()
  // directly, no Paynow checkout at all, since no real money changes
  // hands during the promo window. Kept as a fully separate function
  // from handlePay() (the real payment path) rather than branching
  // deep inside it — these are genuinely different flows (RPC call vs.
  // checkout+poll), and keeping them separate makes it obvious exactly
  // what changes when the promo ends: this whole function simply stops
  // being called, handlePay() below is completely untouched and ready
  // to take over immediately on Feb 1.
  async function handleFreeRegister() {
    if (!agreedToTerms) {
      setError('Please agree to the Operator Terms to continue.');
      return;
    }

    setPaying(true);
    setError('');

    const { error: rpcError } = await supabase.rpc('register_operator_free_promo', {
      p_operator_type: 'delivery',
    });

    setPaying(false);

    if (rpcError) {
      setError(rpcError.message);
      return;
    }

    setDone(true);
  }

  async function handlePay() {
    // NEW: genuinely blocks payment — same validation tier as any
    // other required check.
    if (!agreedToTerms) {
      setError('Please agree to the Operator Terms to continue.');
      return;
    }

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

  if (noProfileFound) {
    return (
      <View style={styles.successScreen}>
        {/* CHANGED (app-wide, direct product decision): "‹" swapped for
            "‹" — see operator-register-pay.tsx's matching comment for
            the full reasoning; the vertical-nudge nested-Text workaround
            this and the twin back button below used to need is dropped
            along with the arrow glyph it was compensating for. */}
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Text style={styles.backText}><Text style={styles.backArrow}>‹</Text> Back</Text>
        </TouchableOpacity>
        <Text style={styles.successEmoji}>⚠️</Text>
        <Text style={styles.successTitle}>No operator profile yet</Text>
        <Text style={styles.successBody}>
          {error || 'We couldn\'t find a delivery operator profile for your account. Start from your profile page to set one up first.'}
        </Text>
        <TouchableOpacity style={styles.startBtn} onPress={() => router.replace('/profile')}>
          <Text style={styles.startBtnText}>Back to profile</Text>
        </TouchableOpacity>
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
          <Step n="5" text="You keep the full delivery fee ($8 local / $12 intercity for small items, negotiated directly for large items)" />
        </View>
        <TouchableOpacity style={styles.startBtn} onPress={() => router.replace('/become-operator?type=delivery')}>
          <Text style={styles.startBtnText}>Add your vehicle details →</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const alreadyExpired = operatorRow?.registration_paid && operatorRow?.registration_expires_at &&
    new Date(operatorRow.registration_expires_at).getTime() <= Date.now();

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
        <Text style={styles.backText}><Text style={styles.backArrow}>‹</Text> Back</Text>
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

      <View style={styles.benefitsCard}>
        <Text style={styles.benefitsTitle}>What you get</Text>
        <Benefit icon="🔓" text="Instant access to all open delivery requests" />
        <Benefit icon="🚗" text="Appear in the driver list buyers choose from" />
        <Benefit icon="💵" text="Keep 100% of the delivery fee — paid cash on collection" />
        <Benefit icon="⭐" text="Build your rating and reputation on ImbizoHub" />
      </View>

      <View style={styles.pricingCard}>
        <View style={styles.pricingRow}>
          <View style={styles.pricingLeft}>
            <Text style={styles.pricingLabel}>Registration fee</Text>
            <Text style={styles.pricingNote}>
              {isPromoActive()
                ? 'Free until Jan 31, 2027 \u2014 then $10/year'
                : 'Renews yearly'}
            </Text>
          </View>
          {isPromoActive() ? (
            <Text style={[styles.pricingAmount, { color: GREEN }]}>FREE</Text>
          ) : (
            <Text style={styles.pricingAmount}>${REG_FEE}</Text>
          )}
        </View>
        <View style={styles.divider} />
        <View style={styles.pricingRow}>
          <View style={styles.pricingLeft}>
            <Text style={styles.pricingLabel}>Small item, local</Text>
            <Text style={styles.pricingNote}>Fits in a car — you keep the full amount</Text>
          </View>
          <Text style={[styles.pricingAmount, { color: GREEN }]}>$8</Text>
        </View>
        <View style={styles.divider} />
        <View style={styles.pricingRow}>
          <View style={styles.pricingLeft}>
            <Text style={styles.pricingLabel}>Small item, intercity</Text>
            <Text style={styles.pricingNote}>You keep the full amount</Text>
          </View>
          <Text style={[styles.pricingAmount, { color: GREEN }]}>$12</Text>
        </View>
        <View style={styles.divider} />
        {/* FIX (real bug, screenshotted on web: "Negotiate" clipped off
            the right edge of the screen): pricingRow is a plain
            space-between flex row with no shrink/wrap constraint on its
            left column, so this row's long note text ("Needs a
            van/truck, local only — negotiate directly, you keep the
            full amount") pushed the whole row wider than its card,
            shoving the amount text right off screen — same root cause
            as chat.tsx's header pill overflow fixed earlier. pricingLeft
            below (flex: 1, minWidth: 0) lets this column actually
            shrink/wrap instead, applied to all four rows in this card
            for consistency even though only this one's note was long
            enough to visibly break. */}
        <View style={styles.pricingRow}>
          <View style={styles.pricingLeft}>
            <Text style={styles.pricingLabel}>Large item</Text>
            {/* UPDATED (pricing decision): large items are no longer a
                flat $15 — sizes vary too much for one rate, so the price
                is negotiated directly between driver and customer. You
                keep 100% of whatever you agree, same as every other
                tier. */}
            <Text style={styles.pricingNote}>Needs a van/truck, local only — negotiate directly, you keep the full amount</Text>
          </View>
          <Text style={[styles.pricingAmount, { color: GREEN, fontSize: 14 }]}>Negotiate</Text>
        </View>
      </View>

      {/* NEW: real Operator Terms acceptance */}
      <TouchableOpacity
        style={styles.termsRow}
        onPress={() => setAgreedToTerms((prev) => !prev)}
        activeOpacity={0.7}
      >
        <View style={[styles.checkbox, agreedToTerms && styles.checkboxChecked]}>
          {agreedToTerms && <Text style={styles.checkmark}>✓</Text>}
        </View>
        <Text style={styles.termsText}>
          I agree to ImbizoHub's{' '}
          <Text style={styles.termsLink} onPress={() => Linking.openURL(OPERATOR_TERMS_URL)}>
            Operator Terms
          </Text>
        </Text>
      </TouchableOpacity>

      <TouchableOpacity
        style={[styles.payBtn, (paying || verifying) && { opacity: 0.6 }]}
        onPress={isPromoActive() ? handleFreeRegister : handlePay}
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
        ) : isPromoActive() ? (
          <>
            <Text style={styles.payBtnText}>Register free and start delivering</Text>
            <Text style={styles.payBtnSub}>Free until January 31, 2027</Text>
          </>
        ) : (
          <>
            <Text style={styles.payBtnText}>Pay ${REG_FEE} and start delivering</Text>
            <Text style={styles.payBtnSub}>Valid for 12 months</Text>
          </>
        )}
      </TouchableOpacity>
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
  // NEW: bigger than the label text so the '‹' glyph reads clearly — direct product decision ("back symbol too small").
  backArrow: { fontSize: 20 },
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
  // NEW: lets this column shrink/wrap instead of pushing pricingAmount
  // off-screen when its note text is long — see the FIX comment above
  // where this is used.
  pricingLeft: { flex: 1, minWidth: 0, paddingRight: 12 },
  pricingLabel: { fontSize: 14, fontWeight: '600', color: '#fff' },
  pricingNote: { fontSize: 11, color: GREY, marginTop: 2 },
  pricingAmount: { fontSize: 20, fontWeight: '800', color: '#fff', flexShrink: 0 },
  divider: { height: 0.5, backgroundColor: '#2a2a2a', marginVertical: 12 },

  // NEW: terms checkbox row styles
  termsRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 16, gap: 10 },
  checkbox: {
    width: 20, height: 20, borderRadius: 5, borderWidth: 1.5, borderColor: '#666',
    alignItems: 'center', justifyContent: 'center',
  },
  checkboxChecked: { backgroundColor: GOLD, borderColor: GOLD },
  checkmark: { color: BLACK, fontSize: 13, fontWeight: '900' },
  termsText: { color: '#ccc', fontSize: 13, flex: 1 },
  termsLink: { color: GOLD, textDecorationLine: 'underline' },

  // FIX: same button-text-overlap fix as its twin file,
  // operator-register-pay.tsx — see the comment there. Also hardened
  // further here (reported again, "tabs are not aligned" on the bottom
  // button): added paddingHorizontal so the label never touches the
  // button's rounded edges, plus explicit textAlign: 'center' on both
  // lines. Without it, a long label like "Register free and start
  // delivering" that wraps to two lines on a narrower phone left-aligns
  // each line within its own auto-shrunk text box by default — which
  // reads as "Register" sitting hard against the left edge while the
  // rest trails off-center, exactly what was reported.
  payBtn: { backgroundColor: GOLD, borderRadius: 14, paddingVertical: 18, paddingHorizontal: 16, alignItems: 'center', marginBottom: 16, justifyContent: 'center' },
  payBtnText: { color: BLACK, fontSize: 16, fontWeight: '800', textAlign: 'center' },
  payBtnSub: { color: '#5a4400', fontSize: 12, marginTop: 4, textAlign: 'center' },

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
