// app/login.tsx
//
// FIX (found during a thorough review): handleLogin() submitted
// directly to Supabase with no check for empty email/password —
// tapping "Sign in" on an empty form wasted a real network round-trip
// for something that should be caught instantly, client-side. The
// button was also only disabled while loading, never tied to whether
// the fields were actually filled — every other form reviewed today
// (forgot-password.tsx, for instance) disables on empty input too.
// Both fixed for consistency with that established pattern.
//
// FIX (built as a follow-up, not folded into the pass above): if
// someone had been browsing anonymously — posted a want, had
// conversations, everything confirmed reachable anonymously across
// today's review — logging into a DIFFERENT, existing real account
// here meant Supabase's signInWithPassword() swapped them onto a
// completely different user id. That anonymous activity didn't merge
// or transfer; it just became invisible, still sitting in the
// database under an id they could no longer access. Now captures the
// anonymous session's id right before signing in, then calls
// merge_anonymous_session() (see merge-anonymous-session.sql)
// afterward to re-assign that activity onto the real, now-
// authenticated account. Best-effort: if the merge itself fails for
// any reason, the login still succeeds rather than blocking someone
// from signing in over a secondary step — the anonymous data would
// just remain orphaned in that unlikely case, same as before this fix
// existed.

import { useRouter } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { supabase } from '../../lib/supabase';

const GOLD = '#B8860B';
const BLACK = '#1A1A18';
const DARK = '#2a2a2a';

export default function LoginScreen() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function handleLogin() {
    if (!email.trim() || !password) {
      setError('Please enter your email and password.');
      return;
    }

    setLoading(true);
    setError('');

    // NEW: capture the current anonymous session's id (if any) BEFORE
    // signing in — signInWithPassword replaces the session entirely,
    // so this is the only chance to know what to merge afterward.
    const { data: { user: previousUser } } = await supabase.auth.getUser();
    const previousAnonymousId = previousUser?.is_anonymous ? previousUser.id : null;

    const { error: signInError } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });

    if (signInError) {
      setError(signInError.message);
      setLoading(false);
      return;
    }

    // NEW: merge any anonymous activity into the now-authenticated
    // real account. Best-effort — see top-of-file comment.
    if (previousAnonymousId) {
      const { error: mergeError } = await supabase.rpc('merge_anonymous_session', {
        p_anonymous_id: previousAnonymousId,
      });
      if (mergeError) {
        console.log('Anonymous session merge failed (non-fatal):', mergeError.message);
      }
    }

    setLoading(false);
    router.replace('/');
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.logo}>Imbizo<Text style={styles.gold}>Hub</Text></Text>
        <Text style={styles.tagline}>Gather. Trade. Trust.</Text>
      </View>

      <View style={styles.form}>
        <Text style={styles.title}>Sign in</Text>

        {error ? <Text style={styles.error}>{error}</Text> : null}

        <Text style={styles.label}>Email</Text>
        <TextInput
          style={styles.input}
          placeholder="you@email.com"
          placeholderTextColor="#666"
          value={email}
          onChangeText={setEmail}
          keyboardType="email-address"
          autoCapitalize="none"
        />

        <Text style={styles.label}>Password</Text>
        <TextInput
          style={styles.input}
          placeholder="Your password"
          placeholderTextColor="#666"
          value={password}
          onChangeText={setPassword}
          secureTextEntry
        />

        <TouchableOpacity onPress={() => router.push('/forgot-password')} style={styles.forgotLink}>
          <Text style={styles.forgotLinkText}>Forgot your password?</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.button, (loading || !email.trim() || !password) && { opacity: 0.6 }]}
          onPress={handleLogin}
          disabled={loading || !email.trim() || !password}
        >
          {loading ? <ActivityIndicator color={BLACK} /> : <Text style={styles.buttonText}>Sign in</Text>}
        </TouchableOpacity>

        <TouchableOpacity onPress={() => router.push('/register')}>
          <Text style={styles.link}>Don't have an account? <Text style={styles.gold}>Register</Text></Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: BLACK },
  header: { alignItems: 'center', paddingTop: 80, paddingBottom: 40 },
  logo: { fontSize: 36, fontWeight: '700', color: '#fff' },
  gold: { color: GOLD },
  tagline: { color: '#666', fontSize: 13, marginTop: 4 },
  form: { paddingHorizontal: 24 },
  title: { color: '#fff', fontSize: 22, fontWeight: '700', marginBottom: 24 },
  error: { color: '#ff4444', fontSize: 13, marginBottom: 16, backgroundColor: '#2a1a1a', padding: 10, borderRadius: 8 },
  label: { color: '#aaa', fontSize: 12, marginBottom: 6, marginTop: 16 },
  input: { backgroundColor: DARK, borderRadius: 10, padding: 14, color: '#fff', fontSize: 15 },
  button: { backgroundColor: GOLD, borderRadius: 10, padding: 16, alignItems: 'center', marginTop: 24 },
  forgotLink: { alignSelf: 'flex-end', marginTop: 8 },
  forgotLinkText: { color: GOLD, fontSize: 12 },
  buttonText: { color: BLACK, fontSize: 16, fontWeight: '700' },
  link: { color: '#aaa', fontSize: 13, textAlign: 'center', marginTop: 20 },
});
