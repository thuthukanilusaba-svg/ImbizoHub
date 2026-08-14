// app/auth-callback.tsx
//
// WEB ONLY. Native never visits this screen — see lib/oauth.ts's
// top-of-file comment for why: openAuthSessionAsync() on native gets
// the redirect URL handed back directly without ever leaving the app.
// On web, signInWithOAuth() does a real full-page redirect, so this
// is the screen that receives the trip back from Google/Facebook (via
// Supabase's own callback) and does the actual code exchange — same
// PKCE pattern as reset-password.tsx, which this file otherwise
// mirrors closely.
//
// Reachable only via Linking.createURL('auth-callback') with a `code`
// query param attached, exactly like reset-password.tsx.

import * as Linking from 'expo-linking';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { supabase } from '../../lib/supabase';
import { consumePendingAnonymousMerge } from '../../lib/oauth';

const GOLD = '#B8860B';
const BLACK = '#1A1A18';

export default function AuthCallbackScreen() {
  const router = useRouter();
  const url = Linking.useURL();
  const [linkError, setLinkError] = useState('');

  useEffect(() => {
    exchangeCodeForSession();
    // Deliberately runs once only — see reset-password.tsx's identical
    // comment on its own effect for why re-running on url changes is
    // unsafe (a one-time code can't be re-exchanged).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function exchangeCodeForSession() {
    setLinkError('');

    const initialUrl = url ?? (await Linking.getInitialURL());

    if (!initialUrl) {
      setLinkError('This screen should only be reached from a Google or Facebook sign-in redirect.');
      return;
    }

    const parsed = Linking.parse(initialUrl);
    const code = parsed.queryParams?.code as string | undefined;
    const oauthError = parsed.queryParams?.error_description as string | undefined;

    if (oauthError) {
      setLinkError(String(oauthError));
      return;
    }

    if (!code) {
      setLinkError('This sign-in link looks incomplete or has already been used. Please try again.');
      return;
    }

    const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);

    if (exchangeError) {
      setLinkError('This sign-in link has expired or already been used. Please try again.');
      return;
    }

    // Best-effort — see lib/oauth.ts. Never blocks getting the user
    // into the app.
    await consumePendingAnonymousMerge();

    router.replace('/');
  }

  if (linkError) {
    return (
      <View style={styles.center}>
        <Text style={styles.errorEmoji}>⚠️</Text>
        <Text style={styles.title}>Sign-in problem</Text>
        <Text style={styles.body}>{linkError}</Text>
        <TouchableOpacity style={styles.backBtn} onPress={() => router.replace('/login')}>
          <Text style={styles.backBtnText}>Back to Sign in</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.center}>
      <ActivityIndicator size="large" color={GOLD} />
      <Text style={styles.body}>Finishing sign-in…</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, backgroundColor: BLACK, alignItems: 'center', justifyContent: 'center', padding: 24 },
  errorEmoji: { fontSize: 40, marginBottom: 12 },
  title: { color: '#fff', fontSize: 20, fontWeight: '700', marginBottom: 8, textAlign: 'center' },
  body: { color: '#aaa', fontSize: 14, textAlign: 'center', marginTop: 12, lineHeight: 20 },
  backBtn: { backgroundColor: GOLD, borderRadius: 10, paddingHorizontal: 24, paddingVertical: 14, marginTop: 24 },
  backBtnText: { color: BLACK, fontSize: 15, fontWeight: '700' },
});
