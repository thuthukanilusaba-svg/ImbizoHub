import { useRouter } from 'expo-router';
import { useRef, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { supabase } from '../../lib/supabase';

const GOLD = '#B8860B';
const BLACK = '#1A1A18';
const DARK = '#2a2a2a';

// NOTE: 'operator' here is the internal UI/state value used for the
// Transport Operator picker card and the conditional extra-fields below
// (accountType === 'operator'). It intentionally stays 'operator' as the
// LOCAL state value — only the value actually WRITTEN to
// profiles.account_type is remapped (see handleRegister below). This
// avoids touching every other `accountType === 'operator'` check in this
// file just to rename the local state value.
//
// UPDATED (product decision revision): van-hire moves from fully HIDDEN
// to VISIBLE-BUT-PAUSED, matching the same "Coming soon" treatment
// dealer.tsx already uses for Dealer Pro — shown so people know it's
// coming, but not selectable yet. `disabled: true` below is a new field
// (only Transport Operator has it) checked in the card-rendering block
// further down: a disabled card shows a "Coming soon" badge, ignores
// taps, and never becomes the selected accountType. Nothing downstream
// (toStoredAccountType, operator-register-pay.tsx, the
// transport_operator_registration payment kind) changes — those stay
// fully functional for when this is un-paused, same as before.
// UPDATED (product decision): "Buyer" and "Seller" removed from this
// picker entirely — a full codebase check confirmed neither one ever
// gated any real functionality (post.tsx never checked account_type at
// all; the only consequence anywhere was whether the Dashboard tab
// showed by default in the bottom nav, now driven by "have you posted
// a listing" instead — see index.tsx/explore.tsx/messages.tsx). Asking
// new users to pre-declare a role that never actually restricted
// anything was a fake decision at exactly the moment (signup) where
// friction matters most. Every account can already buy, sell, and
// message regardless of what used to be picked here.
//
// What remains are the two GENUINELY optional add-ons — Delivery and
// Transport Operator — which really do gate real functionality (a paid
// registration, specific screens). These are no longer part of a
// forced single-select "I am a" grid; they're an optional toggle
// section further down the form (see the JSX below), matching their
// actual nature: something extra you can add, not a required identity
// choice.
const accountTypes = [
  { type: 'delivery', icon: '📦', label: 'Delivery Operator', desc: 'Deliver parcels locally & intercity' },
  { type: 'operator', icon: '🚐', label: 'Transport Operator', desc: 'Offer van & minibus hire' },
];

// FIX: profiles.account_type must store 'transport_operator' — that's
// the exact string operator-requests.tsx's checkStatus() checks for
// (`profile?.account_type !== 'transport_operator'`), and the same
// string the paynow-webhook Edge Function writes once a transport
// operator's registration fee is confirmed paid. The old code inserted
// the raw local `accountType` value directly, which stored 'operator'
// for this role — a string that NEVER matches 'transport_operator',
// meaning every transport operator signup was permanently blocked from
// operator-requests.tsx regardless of payment status. This maps the
// local UI value to the correct stored value; 'buyer', 'seller', and
// 'delivery' pass through unchanged, since nothing else in the app
// checks profiles.account_type === 'delivery' (delivery operator status
// is tracked entirely via the separate delivery_operators table).
function toStoredAccountType(uiValue: string): string {
  if (uiValue === 'operator') return 'transport_operator';
  return uiValue;
}

export default function RegisterScreen() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  // NEW: confirm-password field + both fields' show/hide state — see
  // the password section below for the matching-validation logic.
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [accountType, setAccountType] = useState('buyer');

  // Transport operator fields
  const [vehicleType, setVehicleType] = useState('');
  const [vehicleCapacity, setVehicleCapacity] = useState('');

  // Delivery operator fields
  const [deliveryVehicleType, setDeliveryVehicleType] = useState('');
  const [deliveryArea, setDeliveryArea] = useState('');

  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  // FIX: guards against handleRegister firing twice for a single tap/click.
  // Live testing showed EVERY genuine Transport Operator signup landed in
  // the database with account_type = 'buyer' (the useState default),
  // despite the UI correctly showing "Transport Operator Details" and
  // this same function's own redirect logic correctly branching on
  // accountType === 'operator'. Since the insert and the redirect read
  // the SAME local variable in the SAME synchronous function call, they
  // cannot disagree unless handleRegister actually ran as two separate
  // invocations: an early one (capturing a stale/default accountType
  // before the picker's state update had committed) that performed the
  // insert, and a later one (with the correct, updated accountType) that
  // performed the redirect. React Native Web's touchable components can
  // sometimes bind more than one underlying event listener for a single
  // logical tap, and the existing `disabled={loading}` guard doesn't
  // fully protect against this since React state updates are batched —
  // if a second invocation fires before the first setLoading(true) has
  // actually committed and re-rendered, the button isn't disabled yet.
  //
  // isSubmittingRef is checked and set synchronously, before any await —
  // unlike React state, a ref update is immediate and not batched, so a
  // second invocation arriving even a tick later will see it and bail
  // out, regardless of whether `loading` has visually updated yet.
  const isSubmittingRef = useRef(false);

  async function handleRegister() {
    if (isSubmittingRef.current) {
      // A second invocation arrived while the first is still in flight —
      // ignore it entirely rather than risk it reading stale state.
      return;
    }
    isSubmittingRef.current = true;

    if (!email || !password || !name) {
      setErrorMsg('Please fill in all required fields.');
      isSubmittingRef.current = false;
      return;
    }

    // NEW: confirm-password check — same validation tier as the required-
    // fields check above, checked before anything hits the network.
    if (password !== confirmPassword) {
      setErrorMsg('Passwords don\'t match. Please check both fields.');
      isSubmittingRef.current = false;
      return;
    }

    setLoading(true);
    setErrorMsg('');

    // FIX (found during a full-app review pass — a systemic gap, not
    // specific to this screen): every "upgrade from anonymous to a real
    // account" redirect built today (quotes.tsx, wanted-responses.tsx,
    // post.tsx all push to /register when the current session is
    // anonymous) used to land here and call supabase.auth.signUp()
    // unconditionally. signUp() does NOT convert the current anonymous
    // session into a permanent one — it creates a completely separate,
    // brand-new identity, silently abandoning the anonymous one. Anyone
    // who browsed anonymously, posted a want, responded to others, or
    // chatted in several conversations, then hit a payment gate and
    // registered, would get a DIFFERENT user id — every message, want,
    // and response created while anonymous became permanently orphaned,
    // invisible to their new real account, with no way to ever
    // reconnect it. This directly undermined the whole point of
    // building anonymous access in the first place.
    //
    // Fix: if the CURRENT session is anonymous, use
    // supabase.auth.updateUser() instead — this converts that SAME user
    // row into a permanent one (same id, same history), rather than
    // replacing it with signUp(). Only falls back to signUp() when there
    // is no anonymous session to convert (the normal "I've never used
    // this app before" case).
    const { data: { session: currentSession } } = await supabase.auth.getSession();
    const isConvertingAnonymous = !!currentSession?.user?.is_anonymous;

    const { data, error } = isConvertingAnonymous
      ? await supabase.auth.updateUser({
          email,
          password,
          data: { full_name: name },
        })
      : await supabase.auth.signUp({
          email,
          password,
          options: { data: { full_name: name } }
        });

    if (error) {
      setErrorMsg(error.message);
      setLoading(false);
      isSubmittingRef.current = false;
      return;
    }

    if (data.user) {
      // FIX (root cause, found by reproducing the exact failing SQL
      // directly): the previous .upsert({ id: data.user.id, ... },
      // { onConflict: 'id' }) call put `id` in the UPDATE SET clause —
      // PostgREST's upsert generates
      // `ON CONFLICT (id) DO UPDATE SET id = excluded.id, full_name =
      // excluded.full_name, ...` for every field in the payload,
      // including the conflict column itself. `id` was never part of
      // the safe-column allowlist from the profile-update lockdown
      // migration (full_name, phone, location, avatar_url, account_type,
      // vehicle_type, vehicle_capacity, licence_plate, push_token) —
      // deliberately so, since granting UPDATE on `id` table-wide would
      // let any authenticated user rewrite their own profile's primary
      // key via a raw API call. That's a real hijack/collision risk, not
      // just a technicality, so the fix is not to widen the grant.
      //
      // The on_auth_user_created Auth Hook (see handle_new_user()) always
      // creates a stub profiles row the instant signUp() succeeds — so by
      // the time this code runs, a row for this id is guaranteed to
      // already exist. That means upsert was never actually needed here:
      // a plain update() that never references `id` in its payload does
      // the exact same job — overwrite the buyer-default stub with the
      // real chosen details — without ever touching a locked column.
      const { error: profileError } = await supabase
        .from('profiles')
        .update({
          full_name: name,
          phone,
          // FIX: was `account_type: accountType` — stored the raw local
          // value ('operator') instead of the value the rest of the app
          // actually checks for ('transport_operator'). See
          // toStoredAccountType() above.
          account_type: toStoredAccountType(accountType),
          vehicle_type: accountType === 'operator' ? vehicleType :
                        accountType === 'delivery' ? deliveryVehicleType : null,
          vehicle_capacity: accountType === 'operator' ? parseInt(vehicleCapacity) || null : null,
        })
        .eq('id', data.user.id);

      if (profileError) {
        setErrorMsg('Account created, but saving your profile failed: ' + profileError.message + '. Please contact support or try signing in.');
        setLoading(false);
        isSubmittingRef.current = false;
        return;
      }

      // If delivery operator — also insert into delivery_operators table.
      // registration_paid defaults to false; they must pay the $10 fee
      // (delivery-operator-register-pay.tsx) before appearing as a bookable
      // driver or accepting jobs. status stays 'active' since that field is
      // used separately for the strike system (warning/suspended/removed),
      // not payment state.
      if (accountType === 'delivery') {
        // Unlike profiles, delivery_operators has no equivalent auto-
        // creation hook — there's no guaranteed existing row to update,
        // so this one genuinely needs upsert (insert-if-new, update-if-
        // renewing). user_id is the conflict target here rather than id,
        // and — unlike profiles.id — updating delivery_operators.user_id
        // to itself on conflict isn't a privilege-escalation path, so
        // this is safe to leave as upsert.
        const { error: deliveryError } = await supabase.from('delivery_operators').upsert({
          user_id: data.user.id,
          full_name: name,
          phone,
          vehicle_type: deliveryVehicleType,
          verification_tier: 'unverified',
          status: 'active',
        }, { onConflict: 'user_id' });
        if (deliveryError) {
          setErrorMsg('Profile created, but delivery operator setup failed: ' + deliveryError.message + '. Please contact support.');
          setLoading(false);
          isSubmittingRef.current = false;
          return;
        }
      }
    }

    setLoading(false);
    isSubmittingRef.current = false;

    // FIX: transport operators previously fell through to the plain `else`
    // branch and were sent to '/' with no prompt to pay the $10
    // registration fee — unlike delivery operators, who are taken
    // straight to their payment screen. A transport operator would only
    // discover the fee requirement by wandering into operator-requests.tsx
    // and hitting its blocked screen. Now mirrors the delivery-operator
    // flow: straight to the relevant payment screen after signup.
    if (accountType === 'delivery') {
      router.replace('/delivery-operator-register-pay');
    } else if (accountType === 'operator') {
      router.replace('/operator-register-pay');
    } else {
      router.replace('/');
    }
  }

  return (
    // FIX: the keyboard covered form fields as they were being typed
    // into, on every screen with text inputs app-wide — nothing
    // previously accounted for the keyboard at all. KeyboardAvoidingView
    // pushes the ScrollView's content up (iOS) or resizes it (Android)
    // so whichever field is focused stays visible above the keyboard.
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <ScrollView style={styles.container} contentContainerStyle={styles.content}>
        <Text style={styles.title}>Create your account</Text>
        <Text style={styles.subtitle}>Buy, sell, and message sellers — all in one account.</Text>

        <Text style={styles.label}>Full Name *</Text>
        <TextInput style={styles.input} placeholder="Enter your full name" placeholderTextColor="#888"
          value={name} onChangeText={setName} />

        <Text style={styles.label}>Email *</Text>
        <TextInput style={styles.input} placeholder="Enter your email" placeholderTextColor="#888"
          value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" />

        <Text style={styles.label}>Phone Number</Text>
        <TextInput style={styles.input} placeholder="e.g. +263 77 123 4567" placeholderTextColor="#888"
          value={phone} onChangeText={setPhone} keyboardType="phone-pad" />

        {/* NEW: show/hide toggle so a typo isn't invisible, plus a
            separate confirm-password field checked in handleRegister
            before the request ever hits the network. Both fields share
            the same show/hide pattern, kept as independent toggles so
            checking one doesn't force-reveal the other. */}
        <Text style={styles.label}>Password *</Text>
        <View style={styles.passwordRow}>
          <TextInput
            style={styles.passwordInput}
            placeholder="Create a password"
            placeholderTextColor="#888"
            value={password}
            onChangeText={setPassword}
            secureTextEntry={!showPassword}
            autoCapitalize="none"
          />
          <TouchableOpacity
            style={styles.eyeBtn}
            onPress={() => setShowPassword((prev) => !prev)}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Text style={styles.eyeIcon}>{showPassword ? '🙈' : '👁️'}</Text>
          </TouchableOpacity>
        </View>

        <Text style={styles.label}>Confirm Password *</Text>
        <View style={styles.passwordRow}>
          <TextInput
            style={styles.passwordInput}
            placeholder="Re-enter your password"
            placeholderTextColor="#888"
            value={confirmPassword}
            onChangeText={setConfirmPassword}
            secureTextEntry={!showConfirmPassword}
            autoCapitalize="none"
          />
          <TouchableOpacity
            style={styles.eyeBtn}
            onPress={() => setShowConfirmPassword((prev) => !prev)}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Text style={styles.eyeIcon}>{showConfirmPassword ? '🙈' : '👁️'}</Text>
          </TouchableOpacity>
        </View>
        {/* Inline hint the moment the two fields visibly disagree — the
            hard block still happens in handleRegister on submit, this is
            just earlier feedback so nobody has to submit first to find out. */}
        {confirmPassword.length > 0 && password !== confirmPassword ? (
          <Text style={styles.passwordMismatch}>Passwords don't match yet.</Text>
        ) : null}

        {/* NEW: optional add-on section, replacing what used to be a
            required "I am a" choice at the top of the form. Tapping an
            already-selected pill deselects it back to the plain base
            account — this is a genuine toggle now, not a forced single
            pick. Everything below (the extra-fields blocks, the
            handleRegister insert/redirect logic) is UNCHANGED from
            before; only how accountType gets set changed. */}
        <View style={styles.optionalSection}>
          <Text style={styles.optionalSectionTitle}>
            Also want to drive for ImbizoHub? <Text style={styles.optionalSectionHint}>(optional)</Text>
          </Text>
          <View style={styles.optionalToggleRow}>
            {accountTypes.map((a) => (
              <TouchableOpacity
                key={a.type}
                style={[styles.optionalToggle, accountType === a.type && styles.optionalToggleActive]}
                onPress={() => setAccountType((prev) => (prev === a.type ? 'buyer' : a.type))}
              >
                <Text style={styles.optionalToggleIcon}>{a.icon}</Text>
                <Text style={[styles.optionalToggleLabel, accountType === a.type && styles.optionalToggleLabelActive]}>
                  {a.label.replace(' Operator', '')}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {/* Transport Operator fields */}
        {accountType === 'operator' && (
          <View style={styles.extraFields}>
            <View style={styles.extraFieldsHeader}>
              <Text style={styles.extraFieldsTitle}>🚐 Transport Operator Details</Text>
            </View>
            <Text style={styles.label}>Vehicle Type</Text>
            <TextInput style={styles.input} placeholder="e.g. Van, Minibus, Bus" placeholderTextColor="#888"
              value={vehicleType} onChangeText={setVehicleType} />
            <Text style={styles.label}>Passenger Capacity</Text>
            <TextInput style={styles.input} placeholder="e.g. 8" placeholderTextColor="#888"
              value={vehicleCapacity} onChangeText={setVehicleCapacity} keyboardType="numeric" />
          </View>
        )}

        {/* Delivery Operator fields */}
        {accountType === 'delivery' && (
          <View style={styles.extraFields}>
            <View style={styles.extraFieldsHeader}>
              <Text style={styles.extraFieldsTitle}>📦 Delivery Operator Details</Text>
              <Text style={styles.extraFieldsSubtitle}>
                You can deliver anywhere in Zimbabwe — local ($5) or intercity ($10). Sellers post delivery
                requests and choose from available drivers. You earn money on routes you already travel.
              </Text>
            </View>
            <Text style={styles.label}>Vehicle Type</Text>
            <TextInput style={styles.input} placeholder="e.g. Motorbike, Car, Taxi, Bus, Bakkie"
              placeholderTextColor="#888" value={deliveryVehicleType} onChangeText={setDeliveryVehicleType} />
            <Text style={styles.label}>General area / city</Text>
            <TextInput style={styles.input} placeholder="e.g. Harare, Bulawayo, or both"
              placeholderTextColor="#888" value={deliveryArea} onChangeText={setDeliveryArea} />
            <View style={styles.verificationNote}>
              <Text style={styles.verificationNoteText}>
                💳 After registering you'll pay a one-time $10 registration fee (valid 12 months) to
                unlock delivery jobs. After that, submit your national ID to become a verified operator
                and appear higher in delivery requests.
              </Text>
            </View>
          </View>
        )}

        {errorMsg ? <Text style={styles.error}>{errorMsg}</Text> : null}

        <TouchableOpacity style={styles.button} onPress={handleRegister} disabled={loading}>
          {loading ? <ActivityIndicator color={BLACK} /> : <Text style={styles.buttonText}>Create Account</Text>}
        </TouchableOpacity>

        <TouchableOpacity onPress={() => router.replace('/login')} style={styles.loginLink}>
          <Text style={styles.loginLinkText}>
            Already have an account? <Text style={styles.loginLinkBold}>Sign in</Text>
          </Text>
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: BLACK },
  content: { padding: 24, paddingBottom: 48 },
  title: { fontSize: 28, fontWeight: 'bold', color: GOLD, marginTop: 40, marginBottom: 4 },
  subtitle: { fontSize: 16, color: '#aaa', marginBottom: 24 },
  label: { color: '#ccc', fontSize: 14, marginBottom: 6, marginTop: 12 },
  input: { backgroundColor: DARK, color: '#fff', borderRadius: 8, padding: 12, fontSize: 16, borderWidth: 1, borderColor: '#444' },

  // NEW: password row wraps the input + eye-toggle button together,
  // same visual shell (background/border/radius) as the plain `input`
  // style so it doesn't look out of place next to the other fields.
  passwordRow: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: DARK,
    borderRadius: 8, borderWidth: 1, borderColor: '#444',
  },
  passwordInput: { flex: 1, color: '#fff', padding: 12, fontSize: 16 },
  eyeBtn: { paddingHorizontal: 12, paddingVertical: 10 },
  eyeIcon: { fontSize: 18 },
  passwordMismatch: { color: '#ff6b6b', fontSize: 12, marginTop: 6 },

  // NEW: optional add-on toggle section, replacing the old required
  // account-type grid entirely (that grid's styles — accountTypeGrid,
  // accountTypeCard, comingSoonBadge, etc. — are gone; nothing
  // references them anymore, both Delivery and Transport Operator are
  // fully live, so there's no more "disabled/coming soon" card state
  // to style for).
  optionalSection: { marginTop: 20, paddingTop: 16, borderTopWidth: 0.5, borderTopColor: '#2a2a2a' },
  optionalSectionTitle: { color: '#aaa', fontSize: 12, marginBottom: 10 },
  optionalSectionHint: { color: '#666' },
  optionalToggleRow: { flexDirection: 'row', gap: 8 },
  optionalToggle: {
    flex: 1, backgroundColor: DARK, borderRadius: 10, borderWidth: 0.5, borderColor: '#3a3a3a',
    paddingVertical: 10, alignItems: 'center',
  },
  optionalToggleActive: { borderColor: GOLD, borderWidth: 1 },
  optionalToggleIcon: { fontSize: 18, marginBottom: 4 },
  optionalToggleLabel: { color: '#ccc', fontSize: 11 },
  optionalToggleLabelActive: { color: GOLD, fontWeight: '700' },

  extraFields: { backgroundColor: DARK, borderRadius: 12, padding: 16, marginTop: 16, borderWidth: 0.5, borderColor: '#444' },
  extraFieldsHeader: { marginBottom: 4 },
  extraFieldsTitle: { color: '#fff', fontSize: 14, fontWeight: '700' },
  extraFieldsSubtitle: { color: '#888', fontSize: 12, lineHeight: 17, marginTop: 6 },

  verificationNote: { backgroundColor: '#1a1a2e', borderRadius: 8, padding: 12, marginTop: 12, borderWidth: 0.5, borderColor: '#3a3a5e' },
  verificationNoteText: { color: '#8888aa', fontSize: 11, lineHeight: 16 },

  error: { color: '#ff6b6b', marginTop: 12, textAlign: 'center' },
  button: { backgroundColor: GOLD, borderRadius: 10, padding: 16, alignItems: 'center', marginTop: 24 },
  buttonText: { color: BLACK, fontWeight: 'bold', fontSize: 16 },
  loginLink: { marginTop: 20, alignItems: 'center' },
  loginLinkText: { color: '#aaa', fontSize: 14 },
  loginLinkBold: { color: GOLD, fontWeight: 'bold' },
});
