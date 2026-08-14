// app/forgot-password.tsx
//
// NEW FEATURE: previously there was no password recovery path anywhere
// in the app at all — a user who forgot their password had no way to
// regain access. This is step 1 of 2: collect the email, ask Supabase
// to send a reset link.
//
// Uses Linking.createURL('reset-password') rather than a hardcoded
// scheme string — this resolves correctly regardless of whether it's
// running in a dev build, Expo Go, or a standalone production build,
// which matters since the exact deep-link format differs between them.
//
// IMPORTANT — Supabase dashboard configuration required, can't be done
// from this file: the exact redirect URL this generates must be added
// to Authentication -> URL Configuration -> Redirect URLs in the
// Supabase dashboard, or Supabase will reject the redirect and the
// email link won't work. Log the generated URL once (see the
// console.log below) and copy that exact value in.
//
// KNOWN ROUGH EDGE: password-reset deep linking is a genuinely
// inconsistent area across the Supabase + Expo/React Native ecosystem
// right now — several open community reports describe "Auth session
// missing" errors or the reset link not reliably reopening the app,
// especially on Android. This implementation follows current
// documented best practice (PKCE flow via exchangeCodeForSession, see
// reset-password.tsx), but real-device testing and possible iteration
// should be expected before this is fully reliable — this is a known
// rough edge in the underlying tools, not necessarily a bug in this
// specific code.
//
// FIX (real bug, found during a thorough review): the previous version
// treated ANY error other than rate-limiting as a fake success, on the
// stated reasoning of not revealing whether an email is registered.
// That reasoning is already handled by Supabase itself — its own
// resetPasswordForEmail() doesn't return a distinguishing error for
// "no such user" by design. This extra swallowing wasn't protecting
// against anything Supabase wasn't already handling; it was just
// hiding genuine errors — network failures, Supabase outages, and
// especially malformed email input, which had no format validation at
// all beyond "not empty." A simple typo'd email would show the same
// false "check your email" message and leave someone waiting
// indefinitely for something that was never sendable. Now only
// specially handles rate-limiting with a friendlier message; every
// other real error is shown honestly. Also added a basic email-format
// check before submission, to catch the most common typo case with an
// immediate, specific message instead of relying on Supabase's own
// response to catch it.
//
// Usage: router.push('/forgot-password')

import * as Linking from 'expo-linking';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import {
  ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView, StyleSheet,
  Text, TextInput, TouchableOpacity, View,
} from 'react-native';
import { supabase } from '../../lib/supabase';

const GOLD = '#B8860B';
const BLACK = '#1A1A18';
const DARK = '#2a2a2a';
const GREY = '#AAAAAA';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function ForgotPasswordScreen() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit() {
    if (!email.trim()) {
      setError('Please enter your email.');
      return;
    }

    // NEW: basic format check before submission — catches the most
    // common typo case (missing @, missing domain, etc.) with an
    // immediate, specific message, rather than relying on Supabase's
    // own response and risking it being masked by the fix below.
    if (!EMAIL_PATTERN.test(email.trim())) {
      setError('That doesn\'t look like a valid email address.');
      return;
    }

    setError('');
    setLoading(true);

    const redirectTo = Linking.createURL('reset-password');
    console.log('Password reset redirectTo:', redirectTo);

    const { error: resetError } = await supabase.auth.resetPasswordForEmail(
      email.trim(),
      { redirectTo }
    );

    setLoading(false);

    // FIX: was swallowing every non-rate-limit error as a fake
    // success — see top-of-file comment for why that was wrong.
    // Supabase already doesn't reveal whether an email is registered
    // on its own; this code doesn't need to add extra protection for
    // that case, and doing so was hiding real errors instead. Only
    // rate-limiting gets a special, friendlier message now; everything
    // else is shown honestly.
    if (resetError) {
      if (resetError.message.toLowerCase().includes('rate limit')) {
        setError('Too many attempts — please wait a few minutes and try again.');
      } else {
        setError(resetError.message);
      }
      return;
    }

    setSent(true);
  }

  if (sent) {
    return (
      <View style={styles.container}>
        <View style={styles.successCard}>
          <Text style={styles.successEmoji}>📧</Text>
          <Text style={styles.successTitle}>Check your email</Text>
          <Text style={styles.successBody}>
            If an account exists for {email.trim()}, we've sent a link to
            reset your password. Tap the link in that email to continue.
          </Text>
          <TouchableOpacity style={styles.doneBtn} onPress={() => router.replace('/login')}>
            <Text style={styles.doneBtnText}>Back to Sign in</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      {/* FIX (clean-sweep bug): same missing-ScrollView pattern found and
         fixed elsewhere this pass — the submit button could sit below the
         fold on a shorter viewport with no way to scroll down to it. */}
      <ScrollView contentContainerStyle={styles.content}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Text style={styles.backText}>← Back</Text>
        </TouchableOpacity>

        <Text style={styles.heading}>Forgot your password?</Text>
        <Text style={styles.subheading}>
          Enter the email on your account and we'll send you a link to reset it.
        </Text>

        <Text style={styles.label}>Email</Text>
        <TextInput
          style={styles.input}
          value={email}
          onChangeText={setEmail}
          placeholder="you@email.com"
          placeholderTextColor="#555"
          autoCapitalize="none"
          keyboardType="email-address"
          autoComplete="email"
        />

        {error ? <Text style={styles.errorText}>⚠️ {error}</Text> : null}

        <TouchableOpacity
          style={[styles.submitBtn, (loading || !email.trim()) && { opacity: 0.5 }]}
          onPress={handleSubmit}
          disabled={loading || !email.trim()}
        >
          {loading
            ? <ActivityIndicator color={BLACK} />
            : <Text style={styles.submitBtnText}>Send reset link</Text>
          }
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#111111' },
  content: { padding: 20, paddingTop: Platform.OS === 'ios' ? 56 : 40 },
  backBtn: { marginBottom: 16 },
  backText: { color: GREY, fontSize: 14 },
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
  successCard: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32 },
  successEmoji: { fontSize: 56, marginBottom: 20 },
  successTitle: { fontSize: 20, fontWeight: '800', color: '#fff', marginBottom: 10 },
  successBody: { fontSize: 13, color: GREY, textAlign: 'center', lineHeight: 20, marginBottom: 30 },
  doneBtn: { backgroundColor: GOLD, borderRadius: 14, paddingVertical: 14, paddingHorizontal: 36 },
  doneBtnText: { color: BLACK, fontSize: 14, fontWeight: '800' },
});
