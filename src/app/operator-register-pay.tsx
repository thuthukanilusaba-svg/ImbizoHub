// app/operator-register-pay.tsx
// Transport operator (van-hire trip bidding) pays a $10/year registration
// fee before they can browse open trip requests and submit quotes.
//
// NEW: real Operator Terms link + required checkbox before paying —
// previously "terms" were only ever mentioned in plain, non-clickable
// footer text with no actual document behind them.

import { useRouter } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator, Linking, Platform, ScrollView, StyleSheet,
  Text, TouchableOpacity, View,
} from 'react-native';
import { extractFunctionError } from '../../lib/paymentError';
import { supabase } from '../../lib/supabase';

const GOLD = '#B8860B';
const BLACK = '#1A1A18';
const DARK = '#2a2a2a';
const GREY = '#AAAAAA';
const GREEN = '#4fc96e';
const REG_FEE = 10;

// NEW: launch promotion — same free-until-Jan-31-2027 treatment as
// delivery-operator-register-pay.tsx. See free-operator-registration-promo.sql.
const FREE_PROMO_END = new Date('2027-01-31T23:59:59Z');
const isPromoActive = () => new Date() < FREE_PROMO_END;

const OPERATOR_TERMS_URL = 'https://thuthukanilusaba-svg.github.io/imbizohub-legal/operator-terms.html';

const POLL_INTERVAL_MS = 2000;
const POLL_MAX_ATTEMPTS = 20;

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
  // NEW: real, required Operator Terms acceptance.
  const [agreedToTerms, setAgreedToTerms] = useState(false);

  useEffect(() => { init(); }, []);

  async function init() {
    setLoading(true);
    const { data: { user } } = await supabase.auth.getUser();
    // FIX: same bug as delivery-operator-register-pay.tsx, its exact
    // twin file — was `if (!user)`, missing user.is_anonymous. Same
    // reasoning applies here too: this is the only real gate on
    // registering as a transport operator, someone real customers
    // trust with their trip and contact details.
    if (!user || user.is_anonymous) { router.replace('/register'); return; }
    setMyId(user.id);
    setMyEmail(user.email ?? '');

    const { data: profile, error: fetchError } = await supabase
      .from('profiles')
      .select('operator_status, account_type, registration_expires_at')
      .eq('id', user.id)
      .maybeSingle();

    if (fetchError) { setError(fetchError.message); setLoading(false); return; }

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

  // NEW: free-promo registration path — see delivery-operator-register-pay.tsx
  // for the full reasoning behind keeping this as a fully separate
  // function from handlePay() rather than branching inside it.
  async function handleFreeRegister() {
    if (!agreedToTerms) {
      setError('Please agree to the Operator Terms to continue.');
      return;
    }

    setPaying(true);
    setError('');

    const { error: rpcError } = await supabase.rpc('register_operator_free_promo', {
      p_operator_type: 'transport_operator',
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
    // other required check, shown as an inline error rather than
    // silently doing nothing.
    if (!agreedToTerms) {
      setError('Please agree to the Operator Terms to continue.');
      return;
    }

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
          <Step n="3" text="If accepted, the customer's platform fee (7%, capped at $15) reveals your contact details" />
          <Step n="4" text="Agree on how the remaining balance gets paid" />
          <Step n="5" text="You keep 100% of your quoted fare — no additional commission" />
        </View>
        <TouchableOpacity style={styles.startBtn} onPress={() => router.replace('/become-operator?type=operator')}>
          <Text style={styles.startBtnText}>Add your vehicle details →</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const alreadyExpired = profileRow?.operator_status === 'active' && profileRow?.registration_expires_at &&
    new Date(profileRow.registration_expires_at).getTime() <= Date.now();

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <TouchableOpacity onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))} style={styles.backBtn}>
        {/* CHANGED (app-wide, direct product decision): back indicator
            swapped from "‹" to "‹" — matching the ‹ / › chevron pair
            already used elsewhere in the app (listing.tsx's posting nav,
            every vanBannerArrow "›"). The nested-Text vertical nudge
            below was specifically tuned for the arrow glyph's own font
            metrics (see the old FIX comment this replaced); "‹" is
            ordinary typographic punctuation that centers correctly on
            its own in a plain Text node, so the workaround is dropped
            along with the glyph it was compensating for. Worth a quick
            visual check on a device regardless. */}
        <Text style={styles.backText}><Text style={styles.backArrow}>‹</Text> Back</Text>
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

      <View style={styles.benefitsCard}>
        <Text style={styles.benefitsTitle}>What you get</Text>
        <Benefit icon="🔓" text="Instant access to all open trip requests" />
        <Benefit icon="🚐" text="Submit unlimited quotes to customers" />
        <Benefit icon="💵" text="Keep 100% of every completed job" />
        <Benefit icon="⭐" text="Build your rating and reputation on ImbizoHub" />
      </View>

      <View style={styles.pricingCard}>
        {/* FIX (preventative, same root cause found and fixed in the
            twin file delivery-operator-register-pay.tsx — screenshotted
            there with its "Negotiate" text pushed off-screen on web):
            pricingRow is a plain space-between flex row with no shrink
            constraint on its left column, so a long enough note here
            would do the same thing to the amount text. This row's note
            is short today, but pricingLeft (flex: 1, minWidth: 0) below
            closes the gap before it ever becomes visible. */}
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
      </View>

      {/* NEW: real Operator Terms acceptance — visible link to the
          actual document, checkbox genuinely blocks payment (see
          handlePay's check above). */}
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
            <Text style={styles.payBtnText}>Register free and start bidding</Text>
            <Text style={styles.payBtnSub}>Free until January 31, 2027</Text>
          </>
        ) : (
          <>
            <Text style={styles.payBtnText}>Pay ${REG_FEE} and start bidding</Text>
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
  pricingLeft: { flex: 1, minWidth: 0, paddingRight: 12 },
  pricingLabel: { fontSize: 14, fontWeight: '600', color: '#fff' },
  pricingNote: { fontSize: 11, color: GREY, marginTop: 2 },
  pricingAmount: { fontSize: 20, fontWeight: '800', color: '#fff', flexShrink: 0 },

  // NEW: terms checkbox row styles, matching register.tsx's pattern
  termsRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 16, gap: 10 },
  checkbox: {
    width: 20, height: 20, borderRadius: 5, borderWidth: 1.5, borderColor: '#666',
    alignItems: 'center', justifyContent: 'center',
  },
  checkboxChecked: { backgroundColor: GOLD, borderColor: GOLD },
  checkmark: { color: BLACK, fontSize: 13, fontWeight: '900' },
  termsText: { color: '#ccc', fontSize: 13, flex: 1 },
  termsLink: { color: GOLD, textDecorationLine: 'underline' },

  // FIX (real bug, reported: "the letters are not aligned" — visible as
  // the button label and "Free until..."/"Valid for..." caption
  // overlapping/clipping on a real phone): this was `flexDirection:
  // 'row'`, which lays payBtnText and payBtnSub SIDE BY SIDE. That's
  // fine for the verifying state (a small spinner next to one short
  // line), but the static states render a full-length label plus a
  // full-length caption — two long strings that don't fit side by side
  // on a phone-width button, so they overflowed and clipped. Removed
  // (the RN default is column), so the label stacks above the caption
  // like payBtnSub's own `marginTop: 4` was clearly designed for.
  // FIX: hardened further — see delivery-operator-register-pay.tsx's
  // payBtn comment (its twin file) for the full reasoning: added
  // paddingHorizontal plus explicit textAlign: 'center' so a wrapped
  // two-line label can't drift left-aligned inside its own auto-shrunk
  // text box.
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
