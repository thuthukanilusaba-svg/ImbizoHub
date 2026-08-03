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
    setLoading(true);
    setError('');
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      setError(error.message);
    } else {
      router.replace('/');
    }
    setLoading(false);
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

        {/* NEW: previously there was no password recovery path at all
            anywhere in the app — see forgot-password.tsx for the full
            reasoning and known caveats. */}
        <TouchableOpacity onPress={() => router.push('/forgot-password')} style={styles.forgotLink}>
          <Text style={styles.forgotLinkText}>Forgot your password?</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.button} onPress={handleLogin} disabled={loading}>
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