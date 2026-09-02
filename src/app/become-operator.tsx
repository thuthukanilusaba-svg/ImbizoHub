// app/become-operator.tsx
//
// UPDATED (product decision): now reached AFTER payment, not before.
// The registration flow is: tap "Become a..." in profile.tsx → pay the
// $10 fee directly (delivery-operator-register-pay.tsx /
// operator-register-pay.tsx) → land here to fill in vehicle details.
// Previously this screen came BEFORE payment; moved to reduce friction
// on the actual "become an operator" decision — pay first, fill in the
// details once you're already committed, rather than asking for
// details before someone's even paid.
//
// Both payment screens' own success-screen buttons now route here
// (type param distinguishes which), instead of going straight to
// operator-requests.tsx / dealer.tsx.
//
// account_type still gets set here for BOTH types — even though
// transport's own payment confirmation already sets it directly (see
// confirm-payment.ts's transport_operator_registration branch), a
// redundant write of the same value here is harmless, and delivery's
// payment confirmation never touches profiles.account_type at all, so
// this is the only place that actually happens for delivery operators.
//
// FIX (real bug, confirmed by direct report): "Finish setup" always
// routed to /dealer regardless of type, even though the delivery-side
// note below explicitly promises ID verification as the immediate next
// step. The text and the actual navigation were simply disconnected —
// a user following the promised flow would land on the dashboard with
// no upload screen anywhere in sight, having to discover
// dealer.tsx's verification card on their own to ever find it. Now
// genuinely routes there for delivery operators. See handleSubmit().
//
// FIX (real data-loss bug, found during a thorough review): the
// "General area / city" field had its own state and its own real
// TextInput, but delivery_operators never had a column for it —
// confirmed against the actual schema (see
// add-delivery-area-column.sql, which adds delivery_area). Every
// delivery operator who filled this field in had that value silently
// discarded on submit — no error, form succeeded, data just vanished.
// Now actually included in the delivery_operators update below.
//
// Usage: router.push('/become-operator?type=delivery')
//     or router.push('/become-operator?type=operator')

import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView,
  StyleSheet, Text, TextInput, TouchableOpacity, View,
} from 'react-native';
import { supabase } from '../../lib/supabase';
import CityPicker from '../../components/CityPicker';
import {
  DELIVERY_BOOKING_ENABLED,
  DELIVERY_OPERATOR_SIGNUP_PAUSED_MESSAGE,
  DELIVERY_PAUSED_TITLE,
} from '../../lib/featureFlags';

const GOLD = '#B8860B';
const BLACK = '#1A1A18';
const DARK = '#2a2a2a';
const GREY = '#AAAAAA';

export default function BecomeOperatorScreen() {
  const router = useRouter();
  const { type } = useLocalSearchParams<{ type: 'delivery' | 'operator' }>();
  const isDelivery = type === 'delivery';

  // REQUIRED, and the most consequential field on this screen.
  //
  // Why it was added: quotes.tsx's confirmation screen tells the
  // customer "Platform fee paid. Here are your operator's contact
  // details." and then renders `operator_phone || 'Not provided'`.
  // Three of the four registered transport operators had no phone at
  // all, so that screen was showing "Not provided" — the customer
  // completed the transaction and received nothing for it. That is the
  // single point where this product asks someone to act on trust, so it
  // is the last place it can afford to come up empty.
  //
  // How the gap happened: register.tsx collects a phone, but anyone who
  // signed up with Google never sees that form, and this screen — the
  // one that actually turns a user into an operator — never asked. So
  // an operator could register, pay, win a quote and still be
  // uncontactable.
  //
  // Pre-filled from the existing profile when there is one, so the
  // common case is a glance and a tap, not retyping.
  const [phone, setPhone] = useState('');
  const [vehicleType, setVehicleType] = useState('');
  const [vehicleCapacity, setVehicleCapacity] = useState('');
  // What this operator can actually take. Before these existed the form
  // asked only for a free-text vehicle type and a "Passenger Capacity", so
  // a truck owner had no way to say they carry goods, and the customer's
  // form had no way to know a truck existed at all. hirevan.tsx derives its
  // size options from these two columns across every active operator, so
  // answering them here is literally what puts "A truck load" in front of
  // customers. Defaults describe the operators already registered: a van
  // that will take either.
  const [carries, setCarries] = useState<'people' | 'goods' | 'both'>('both');
  const [maxLoadSize, setMaxLoadSize] = useState<'boot' | 'van' | 'truck'>('van');
  // Picked from a fixed list, not typed. It does two jobs: it decides
  // which trips this operator is shown (see lib/cities.ts) and it is
  // what customers see on the quote card.
  //
  // It REPLACED a free-text 'Where are you based?' field that let an
  // operator write 'Harare, Bulawayo, or both'. That was worse than
  // redundant: matching is on pickup city alone, so an operator could
  // advertise coverage the app would never actually give them.
  const [baseCity, setBaseCity] = useState('');
  const [deliveryVehicleType, setDeliveryVehicleType] = useState('');
  const [deliveryArea, setDeliveryArea] = useState('');

  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  // PAUSED: new delivery-operator signups are closed — see
  // lib/featureFlags.ts. This screen needs its own gate because it is
  // reachable by URL: since the web app moved to /app, anyone can open
  // https://imbizohub.com/app/become-operator?type=delivery directly,
  // bypassing every button we hid.
  //
  // But this is NOT a blanket block, and the difference matters. There
  // is already one operator who has PAID and not yet filled in their
  // vehicle details (verified against delivery_operators, not assumed).
  // Refusing them here would take their $10 and then lock them out of
  // the screen that completes what they paid for. The flag's stated
  // rule everywhere else in the app is "block new signups, leave
  // existing registrations alone", so this checks which of the two you
  // are: a paid, unexpired registration may finish; anyone else cannot
  // start one.
  //
  // 'checking' is the initial state on purpose — rendering the form
  // first and yanking it away after the query returns would let someone
  // start typing into a screen they aren't allowed to use.
  const [deliveryGate, setDeliveryGate] =
    useState<'checking' | 'allowed' | 'blocked'>(
      isDelivery && !DELIVERY_BOOKING_ENABLED ? 'checking' : 'allowed'
    );

  useEffect(() => {
    if (deliveryGate !== 'checking') return;

    let cancelled = false;

    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user || user.is_anonymous) {
        if (!cancelled) setDeliveryGate('blocked');
        return;
      }

      const { data, error } = await supabase
        .from('delivery_operators')
        .select('registration_paid, registration_expires_at')
        .eq('user_id', user.id)
        .maybeSingle();

      if (cancelled) return;

      // Fail closed. If the lookup errors we cannot prove this is an
      // existing paid registration, and wrongly allowing a new one is
      // worse than wrongly asking a paid operator to contact support.
      if (error || !data) {
        setDeliveryGate('blocked');
        return;
      }

      const stillValid =
        !!data.registration_paid &&
        !!data.registration_expires_at &&
        new Date(data.registration_expires_at).getTime() > Date.now();

      setDeliveryGate(stillValid ? 'allowed' : 'blocked');
    })();

    return () => { cancelled = true; };
  }, [deliveryGate]);

  // Pre-fill the phone from the existing profile. Runs once; if the
  // profile has none (the Google-signup case this field exists for)
  // the input simply stays empty and the operator types one.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user || cancelled) return;
      const { data } = await supabase
        .from('profiles')
        .select('phone, base_city')
        .eq('id', user.id)
        .maybeSingle();
      if (cancelled) return;
      if (data?.phone) setPhone(data.phone);
      if (data?.base_city) setBaseCity(data.base_city);
    })();
    return () => { cancelled = true; };
  }, []);

  async function handleSubmit() {
    setErrorMsg('');

    // Checked before vehicle type: without a number the operator cannot
    // be reached at all, which makes everything else on this form
    // pointless. Deliberately permissive on format — Zimbabwean numbers
    // get written +263…, 07…, with spaces, dashes or brackets, and
    // rejecting a real number is worse than accepting an odd-looking
    // one. This only catches "clearly not a phone number".
    // Required for transport operators — it is what decides which
    // trips they are shown. Delivery has its own area field and is
    // paused anyway, so it is not asked there.
    if (!isDelivery && !baseCity) {
      setErrorMsg('Please select the city you are based in.');
      return;
    }

    const digits = phone.replace(/[^0-9]/g, '');
    if (digits.length < 9) {
      setErrorMsg('Please enter a phone number customers can reach you on.');
      return;
    }

    if (isDelivery && !deliveryVehicleType.trim()) {
      setErrorMsg('Please enter your vehicle type.');
      return;
    }
    if (!isDelivery && !vehicleType.trim()) {
      setErrorMsg('Please enter your vehicle type.');
      return;
    }

    setLoading(true);

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      setErrorMsg('You need to be signed in to do this.');
      setLoading(false);
      return;
    }

    const storedType = isDelivery ? 'delivery' : 'transport_operator';

    const { error: profileError } = await supabase
      .from('profiles')
      .update({
        account_type: storedType,
        // The reason this screen now asks for a phone — see the state
        // declaration. quotes.tsx reads profiles.phone to reveal the
        // operator's contact details after the fee is paid.
        phone: phone.trim(),
        vehicle_type: isDelivery ? deliveryVehicleType : vehicleType,
        vehicle_capacity: isDelivery ? null : (parseInt(vehicleCapacity) || null),
        carries: isDelivery ? null : carries,
        max_load_size: isDelivery ? null : maxLoadSize,
        // Informational only — shown on the quote card so buyers can see
        // roughly where an operator is based before accepting. Not used
        // as a filter anywhere; trip requests stay nationwide by design.
        base_city: isDelivery ? null : (baseCity || null),
      })
      .eq('id', user.id);

    if (profileError) {
      setErrorMsg('Something went wrong: ' + profileError.message);
      setLoading(false);
      return;
    }

    if (isDelivery) {
      const { error: deliveryError } = await supabase
        .from('delivery_operators')
        .update({
          // Kept in step with profiles.phone above — delivery_operators
          // carries its own phone column and the delivery screens read
          // that one, so writing only the profile would leave this row
          // with the same empty-contact problem.
          phone: phone.trim(),
          vehicle_type: deliveryVehicleType,
          // FIX: was missing entirely — see top-of-file comment. This
          // is the only line needed once the column actually exists.
          delivery_area: deliveryArea.trim() || null,
        })
        .eq('user_id', user.id);

      if (deliveryError) {
        setErrorMsg('Something went wrong saving your vehicle details: ' + deliveryError.message);
        setLoading(false);
        return;
      }
    }

    setLoading(false);

    if (isDelivery) {
      router.replace('/operator-id-verify?type=delivery_operator');
    } else {
      router.replace('/dealer');
    }
  }

  if (deliveryGate === 'checking') {
    return (
      <View style={styles.gateCenter}>
        <ActivityIndicator size="large" color={GOLD} />
      </View>
    );
  }

  if (deliveryGate === 'blocked') {
    return (
      <View style={styles.gateCenter}>
        <Text style={styles.gateTitle}>{DELIVERY_PAUSED_TITLE}</Text>
        {DELIVERY_OPERATOR_SIGNUP_PAUSED_MESSAGE ? (
          <Text style={styles.gateBody}>{DELIVERY_OPERATOR_SIGNUP_PAUSED_MESSAGE}</Text>
        ) : null}
        <TouchableOpacity style={styles.gateBtn} onPress={() => router.replace('/')}>
          <Text style={styles.gateBtnText}>Back to ImbizoHub</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <ScrollView contentContainerStyle={styles.content}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Text style={styles.backText}><Text style={styles.backArrow}>‹</Text> Back</Text>
        </TouchableOpacity>

        <Text style={styles.title}>
          {isDelivery ? '📦 You\'re registered! Last step' : '🚐 You\'re registered! Last step'}
        </Text>
        <Text style={styles.subtitle}>
          {isDelivery
            ? 'Payment received — just add your vehicle details and you\'re ready to start accepting deliveries.'
            : 'Payment received — just add your vehicle details and you\'re ready to start bidding on trips.'}
        </Text>

        {/* Outside the isDelivery branch on purpose: both kinds of
            operator are contacted by phone, and this is the field the
            whole paid contact-reveal depends on. Placed first because
            it is the only required one here. */}
        <Text style={styles.label}>Phone number</Text>
        <TextInput
          style={styles.input}
          placeholder="e.g. 0771 234 567"
          placeholderTextColor="#888"
          value={phone}
          onChangeText={setPhone}
          keyboardType="phone-pad"
          autoComplete="tel"
        />
        <Text style={styles.hint}>
          {isDelivery
            ? 'Shown to sellers once they book you for a delivery.'
            : 'Shown to the customer once they accept your quote — this is how they reach you.'}
        </Text>

        {isDelivery ? (
          <>
            <Text style={styles.label}>Vehicle Type</Text>
            <TextInput style={styles.input} placeholder="e.g. Motorbike, Car, Taxi, Bus, Bakkie"
              placeholderTextColor="#888" value={deliveryVehicleType} onChangeText={setDeliveryVehicleType} />
            <Text style={styles.label}>General area / city</Text>
            <TextInput style={styles.input} placeholder="e.g. Harare, Bulawayo, or both"
              placeholderTextColor="#888" value={deliveryArea} onChangeText={setDeliveryArea} />
            <View style={styles.note}>
              <Text style={styles.noteText}>
                🪪 Next, submit your national ID to become a verified operator and appear higher in delivery requests.
              </Text>
            </View>
          </>
        ) : (
          <>
            <Text style={styles.label}>Vehicle Type</Text>
            {/* Placeholder now names a truck and a bakkie. It said
                "Van, Minibus, Bus" — three people-carriers — which told
                every truck owner this app was not for them. */}
            <TextInput style={styles.input} placeholder="e.g. Van, Minibus, Bakkie, 3-tonne truck" placeholderTextColor="#888"
              value={vehicleType} onChangeText={setVehicleType} />

            <Text style={styles.label}>What do you carry? *</Text>
            <View style={styles.capRow}>
              {([
                ['both', 'Both'],
                ['goods', 'Goods only'],
                ['people', 'People only'],
              ] as const).map(([value, label]) => (
                <TouchableOpacity
                  key={value}
                  style={[styles.capChip, carries === value && styles.capChipOn]}
                  onPress={() => setCarries(value)}
                  activeOpacity={0.85}
                >
                  <Text style={[styles.capChipText, carries === value && styles.capChipTextOn]}>{label}</Text>
                </TouchableOpacity>
              ))}
            </View>

            <Text style={styles.label}>Biggest load you can take *</Text>
            <View style={styles.capRow}>
              {([
                ['boot', 'Car boot'],
                ['van', 'A van load'],
                ['truck', 'A truck load'],
              ] as const).map(([value, label]) => (
                <TouchableOpacity
                  key={value}
                  style={[styles.capChip, maxLoadSize === value && styles.capChipOn]}
                  onPress={() => setMaxLoadSize(value)}
                  activeOpacity={0.85}
                >
                  <Text style={[styles.capChipText, maxLoadSize === value && styles.capChipTextOn]}>{label}</Text>
                </TouchableOpacity>
              ))}
            </View>
            <Text style={styles.hint}>
              You&apos;ll only be shown trips you can actually take — and picking
              &quot;a truck load&quot; is what lets customers post one.
            </Text>

            {carries !== 'goods' ? (
              <>
                <Text style={styles.label}>Passenger seats</Text>
                <TextInput style={styles.input} placeholder="e.g. 8" placeholderTextColor="#888"
                  value={vehicleCapacity} onChangeText={setVehicleCapacity} keyboardType="numeric" />
              </>
            ) : null}
            <Text style={styles.label}>Your base city *</Text>
            <CityPicker value={baseCity} onChange={setBaseCity} placeholder="Select your city" />
            <Text style={styles.hint}>
              You&apos;ll see trips starting in this city, and customers see it on your quote.
            </Text>

          </>
        )}

        {errorMsg ? <Text style={styles.error}>{errorMsg}</Text> : null}

        <TouchableOpacity style={styles.button} onPress={handleSubmit} disabled={loading}>
          {loading ? <ActivityIndicator color={BLACK} /> : <Text style={styles.buttonText}>Finish setup</Text>}
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: BLACK },
  gateCenter: { flex: 1, backgroundColor: BLACK, alignItems: 'center', justifyContent: 'center', padding: 24 },
  gateTitle: { color: '#fff', fontSize: 20, fontWeight: '700', marginBottom: 12, textAlign: 'center' },
  gateBody: { color: GREY, fontSize: 15, lineHeight: 22, textAlign: 'center' },
  gateBtn: { backgroundColor: GOLD, borderRadius: 10, paddingHorizontal: 24, paddingVertical: 14, marginTop: 24 },
  gateBtnText: { color: BLACK, fontSize: 15, fontWeight: '700' },
  content: { padding: 24, paddingBottom: 48 },
  backBtn: { marginBottom: 16 },
  backText: { color: GREY, fontSize: 14 },
  // NEW: bigger than the label text so the '‹' glyph reads clearly — direct product decision ("back symbol too small").
  backArrow: { fontSize: 20 },
  title: { fontSize: 20, fontWeight: '800', color: '#fff', marginBottom: 8 },
  subtitle: { fontSize: 13, color: GREY, lineHeight: 19, marginBottom: 24 },
  label: { color: '#ccc', fontSize: 14, marginBottom: 6, marginTop: 12 },
  input: { backgroundColor: DARK, color: '#fff', borderRadius: 8, padding: 12, fontSize: 16, borderWidth: 1, borderColor: '#444' },
  hint: { color: '#888', fontSize: 12, marginTop: 6 },

  // Capability chips. Same shape as hirevan.tsx's load chips on purpose —
  // an operator answering "biggest load you can take" and a customer
  // answering "roughly how much" are two halves of the same question, and
  // they should look like it.
  capRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  capChip: {
    backgroundColor: '#222220',
    borderWidth: 1,
    borderColor: '#444',
    borderRadius: 999,
    paddingVertical: 9,
    paddingHorizontal: 14,
  },
  capChipOn: { backgroundColor: '#2A2416', borderColor: '#5a4a1c' },
  capChipText: { color: '#AAAAAA', fontSize: 13 },
  capChipTextOn: { color: GOLD, fontWeight: '700' },
  note: { backgroundColor: '#1a1a2e', borderRadius: 8, padding: 12, marginTop: 16, borderWidth: 0.5, borderColor: '#3a3a5e' },
  noteText: { color: '#8888aa', fontSize: 11, lineHeight: 16 },
  error: { color: '#ff6b6b', marginTop: 16, textAlign: 'center' },
  button: { backgroundColor: GOLD, borderRadius: 10, padding: 16, alignItems: 'center', marginTop: 24 },
  buttonText: { color: BLACK, fontWeight: 'bold', fontSize: 16 },
});
