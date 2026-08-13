// app/reset-password.tsx
//
// Step 2 of 2 — see forgot-password.tsx for step 1 and the important
// caveats about deep-link reliability in this area.
//
// Uses the PKCE flow: Supabase's reset link redirects here with a
// `code` query parameter, which must be exchanged for a real session
// via exchangeCodeForSession() BEFORE updateUser({ password }) will
// work — this app has detectSessionInUrl: false set in lib/supabase.ts
// (deliberately, for an unrelated earlier fix), so nothing does this
// exchange automatically; it has to happen explicitly here.
//
// Usage: never navigated to directly — only ever reached via the link
// in the password-reset email, which Supabase redirects to
// Linking.createURL('reset-password') with a code attached.

import * as Linking from 'expo-linking';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import {
    ActivityIndicator, KeyboardAvoidingView, Platform, StyleSheet,
    Text, TextInput, TouchableOpacity, View,
} from 'react-native';
import { supabase } from '../../lib/supabase';

const GOLD = '#B8860B';
const BLACK = '#1A1A18';
const DARK = '#2a2a2a';
const GREY = '#AAAAAA';

export default function ResetPasswordScreen() {
  const router = useRouter();
  const url = Linking.useURL();

  const [exchanging, setExchanging] = useState(true);
  const [sessionReady, setSessionReady] = useState(false);
  const [linkError, setLinkError] = useState('');

  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);

  useEffect(() => {
    exchangeCodeForSession();
    // Deliberately does not depend on [url] and only runs once — the
    // link that opened this screen is the one and only code we should
    // ever try to exchange; re-running on every url change (which can
    // fire for unrelated reasons) risks trying to reuse an already-
    // consumed one-time code, which Supabase will correctly reject.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function exchangeCodeForSession() {
    setExchanging(true);
    setLinkError('');

    // Linking.useURL() only reflects the URL that's ALREADY available
    // at render time on some platforms/timings — getInitialURL() is
    // the more reliable source specifically for "what link actually
    // launched the app," which matters here since this screen only
    // ever exists because of that exact link.
    const initialUrl = url ?? (await Linking.getInitialURL());

    if (!initialUrl) {
      setLinkError('This screen should only be reached from a password reset email link.');
      setExchanging(false);
      return;
    }

    const parsed = Linking.parse(initialUrl);
    const code = parsed.queryParams?.code as string | undefined;

    if (!code) {
      setLinkError(
        'This reset link looks incomplete or has already been used. Request a new one from the Forgot Password screen.'
      );
      setExchanging(false);
      return;
    }

    const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);

    setExchanging(false);

    if (exchangeError) {
      setLinkError(
        'This link has expired or already been used. Request a new one from the Forgot Password screen.'
      );
      return;
    }

    setSessionReady(true);
  }

  async function handleSubmit() {
    if (password.length < 6) {
      setError('Password must be at least 6 characters.');
      return;
    }
    if (password !== confirmPassword) {
      setError('Passwords don\'t match.');
      return;
    }

    setError('');
    setSubmitting(true);

    const { error: updateError } = await supabase.auth.updateUser({ password });

    setSubmitting(false);

    if (updateError) {
      setError(updateError.message);
      return;
    }

    setDone(true);
  }

  if (exchanging) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={GOLD} />
      </View>
    );
  }

  if (linkError) {
    return (
      <View style={styles.center}>
        <Text style={styles.errorEmoji}>⚠️</Text>
        <Text style={styles.deniedTitle}>Link problem</Text>
        <Text style={styles.deniedBody}>{linkError}</Text>
        <TouchableOpacity
          style={styles.backBtnCentered}
          onPress={() => router.replace('/forgot-password')}
        >
          <Text style={styles.backBtnCenteredText}>Request a new link</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (done) {
    return (
      <View style={styles.center}>
        <Text style={styles.successEmoji}>✅</Text>
        <Text style={styles.deniedTitle}>Password updated</Text>
        <Text style={styles.deniedBody}>You can now sign in with your new password.</Text>
        <TouchableOpacity style={styles.backBtnCentered} onPress={() => router.replace('/login')}>
          <Text style={styles.backBtnCenteredText}>Go to Sign in</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (!sessionReady) {
    // Shouldn't normally be reachable — exchangeCodeForSession() either
    // sets sessionReady or linkError, never leaves both false. Kept as
    // a safe fallback rather than rendering a broken form.
    return (
      <View style={styles.center}>
        <Text style={styles.deniedBody}>Something went wrong. Please try again.</Text>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <View style={styles.content}>
        <Text style={styles.heading}>Set a new password</Text>
        <Text style={styles.subheading}>Choose a new password for your account.</Text>

        <Text style={styles.label}>New password</Text>
        <TextInput
          style={styles.input}
          value={password}
          onChangeText={setPassword}
          placeholder="At least 6 characters"
          placeholderTextColor="#555"
          secureTextEntry
        />

        <Text style={styles.label}>Confirm new password</Text>
        <TextInput
          style={styles.input}
          value={confirmPassword}
          onChangeText={setConfirmPassword}
          placeholder="Re-enter your new password"
          placeholderTextColor="#555"
          secureTextEntry
        />

        {error ? <Text style={styles.errorText}>⚠️ {error}</Text> : null}

        <TouchableOpacity
          style={[styles.submitBtn, submitting && { opacity: 0.5 }]}
          onPress={handleSubmit}
          disabled={submitting}
        >
          {submitting
            ? <ActivityIndicator color={BLACK} />
            : <Text style={styles.submitBtnText}>Update password</Text>
          }
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#111111' },
  center: { flex: 1, backgroundColor: '#111', alignItems: 'center', justifyContent: 'center', padding: 30 },
  content: { padding: 20, paddingTop: Platform.OS === 'ios' ? 56 : 40 },
  heading: { fontSize: 22, fontWeight: '800', color: '#fff', marginBottom: 8 },
  subheading: { fontSize: 13, color: GREY, lineHeight: 19, marginBottom: 24 },
  label: { fontSize: 13, fontWeight: '700', color: '#fff', marginBottom: 8 },
  input: {
    backgroundColor: DARK, borderRadius: 12, padding: 14, color: '#fff', fontSize: 14,
    borderWidth: 0.5, borderColor: '#333', marginBottom: 16,
  },
  errorText: { color: '#ff8a8a', fontSize: 13, marginBottom: 16, textAlign: 'center' },
  submitBtn: { backgroundColor: GOLD, borderRadius: 14, paddingVertical: 16, alignItems: 'center' },
  submitBtnText: { color: BLACK, fontSize: 15, fontWeight: '800' },
  errorEmoji: { fontSize: 48, marginBottom: 16 },
  successEmoji: { fontSize: 56, marginBottom: 16 },
  deniedTitle: { color: '#fff', fontSize: 20, fontWeight: '800', marginBottom: 10 },
  deniedBody: { color: GREY, fontSize: 13, textAlign: 'center', marginBottom: 24, lineHeight: 19 },
  backBtnCentered: { backgroundColor: GOLD, borderRadius: 12, paddingVertical: 14, paddingHorizontal: 28 },
  backBtnCenteredText: { color: BLACK, fontSize: 14, fontWeight: '800' },
});
