import { useRouter } from 'expo-router';
import { useRef, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Linking, Platform, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { supabase } from '../../lib/supabase';

const GOLD = '#B8860B';
const BLACK = '#1A1A18';
const DARK = '#2a2a2a';

// NEW: real Terms of Service link + required checkbox — previously
// "terms" were only ever mentioned in plain, non-clickable footer text
// on the operator payment screens, with no actual document behind
// them and nothing requiring agreement anywhere in the app. This is
// the first, most foundational point that needs one, since it applies
// to every account regardless of role.
const TERMS_URL = 'https://thuthukanilusaba-svg.github.io/imbizohub-legal/terms-of-service.html';

// NOTE: 'operator' here is the internal UI/state value used for the
// Transport Operator picker card and the conditional extra-fields below
// (accountType === 'operator'). It intentionally stays 'operator' as the
// LOCAL state value — only the value actually WRITTEN to
// profiles.account_type is remapped (see handleRegister below). This
// avoids touching every other `accountType === 'operator'` check in this
// file just to rename the local state value.
//
// UPDATED (product decision): "Buyer" and "Seller" removed from this
// picker entirely — a full codebase check confirmed neither one ever
// gated any real functionality. Every account can already buy, sell,
// and message regardless of what used to be picked here.
//
// What remains are the two GENUINELY optional add-ons — Delivery and
// Transport Operator — which really do gate real functionality (a paid
// registration, specific screens). These are an optional toggle
// section further down the form, matching their actual nature.
const accountTypes = [
  { type: 'delivery', icon: '📦', label: 'Delivery Operator', desc: 'Deliver parcels locally & intercity' },
  { type: 'operator', icon: '🚐', label: 'Transport Operator', desc: 'Offer van & minibus hire' },
];

// FIX: profiles.account_type must store 'transport_operator' — that's
// the exact string operator-requests.tsx's checkStatus() checks for.
// The old code inserted the raw local `accountType` value directly,
// which stored 'operator' for this role — a string that NEVER matches
// 'transport_operator'. This maps the local UI value to the correct
// stored value; 'buyer' and 'delivery' pass through unchanged.
function toStoredAccountType(uiValue: string): string {
  if (uiValue === 'operator') return 'transport_operator';
  return uiValue;
}

export default function RegisterScreen() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
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

  // NEW: real, required Terms acceptance — see TERMS_URL above.
  const [agreedToTerms, setAgreedToTerms] = useState(false);

  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  const isSubmittingRef = useRef(false);

  async function handleRegister() {
    if (isSubmittingRef.current) return;
    isSubmittingRef.current = true;

    if (!email || !password || !name) {
      setErrorMsg('Please fill in all required fields.');
      isSubmittingRef.current = false;
      return;
    }

    if (password !== confirmPassword) {
      setErrorMsg('Passwords don\'t match. Please check both fields.');
      isSubmittingRef.current = false;
      return;
    }

    // NEW: genuinely blocks submission — not just a visual checkbox
    // that does nothing. Same validation tier as the other required
    // fields above, checked before anything hits the network.
    if (!agreedToTerms) {
      setErrorMsg('Please agree to the Terms of Service to continue.');
      isSubmittingRef.current = false;
      return;
    }

    setLoading(true);
    setErrorMsg('');

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
      const { error: profileError } = await supabase
        .from('profiles')
        .update({
          full_name: name,
          phone,
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

      if (accountType === 'delivery') {
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

    if (accountType === 'delivery') {
      router.replace('/delivery-operator-register-pay');
    } else if (accountType === 'operator') {
      router.replace('/operator-register-pay');
    } else {
      router.replace('/');
    }
  }

  return (
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
        {confirmPassword.length > 0 && password !== confirmPassword ? (
          <Text style={styles.passwordMismatch}>Passwords don't match yet.</Text>
        ) : null}

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

        {/* NEW: real Terms acceptance — a visible link to the actual
            document, plus a checkbox that genuinely blocks submission
            (see handleRegister's check above) rather than decorative
            text. Placed right before the submit button, same
            convention most apps use. */}
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
            <Text style={styles.termsLink} onPress={() => Linking.openURL(TERMS_URL)}>
              Terms of Service
            </Text>
          </Text>
        </TouchableOpacity>

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

  passwordRow: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: DARK,
    borderRadius: 8, borderWidth: 1, borderColor: '#444',
  },
  passwordInput: { flex: 1, color: '#fff', padding: 12, fontSize: 16 },
  eyeBtn: { paddingHorizontal: 12, paddingVertical: 10 },
  eyeIcon: { fontSize: 18 },
  passwordMismatch: { color: '#ff6b6b', fontSize: 12, marginTop: 6 },

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

  // NEW: terms checkbox row styles
  termsRow: { flexDirection: 'row', alignItems: 'center', marginTop: 20, gap: 10 },
  checkbox: {
    width: 20, height: 20, borderRadius: 5, borderWidth: 1.5, borderColor: '#666',
    alignItems: 'center', justifyContent: 'center',
  },
  checkboxChecked: { backgroundColor: GOLD, borderColor: GOLD },
  checkmark: { color: BLACK, fontSize: 13, fontWeight: '900' },
  termsText: { color: '#ccc', fontSize: 13, flex: 1 },
  termsLink: { color: GOLD, textDecorationLine: 'underline' },

  error: { color: '#ff6b6b', marginTop: 12, textAlign: 'center' },
  button: { backgroundColor: GOLD, borderRadius: 10, padding: 16, alignItems: 'center', marginTop: 24 },
  buttonText: { color: BLACK, fontWeight: 'bold', fontSize: 16 },
  loginLink: { marginTop: 20, alignItems: 'center' },
  loginLinkText: { color: '#aaa', fontSize: 14 },
  loginLinkBold: { color: GOLD, fontWeight: 'bold' },
});
