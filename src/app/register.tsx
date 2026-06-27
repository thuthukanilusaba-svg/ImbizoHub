import { useRouter } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { supabase } from '../../lib/supabase';

const GOLD = '#B8860B';
const BLACK = '#1A1A18';
const DARK = '#2a2a2a';

export default function RegisterScreen() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  async function handleRegister() {
    setLoading(true);
    setErrorMsg('');
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { full_name: name } }
    });
    if (error) {
      setErrorMsg(error.message);
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
        <Text style={styles.title}>Create account</Text>
        <Text style={styles.label}>Full name</Text>
        <TextInput style={styles.input} placeholder="Your name" placeholderTextColor="#666" value={name} onChangeText={setName} />
        <Text style={styles.label}>Email</Text>
        <TextInput style={styles.input} placeholder="you@email.com" placeholderTextColor="#666" value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" />
        <Text style={styles.label}>Password</Text>
        <TextInput style={styles.input} placeholder="Choose a password" placeholderTextColor="#666" value={password} onChangeText={setPassword} secureTextEntry />
        <TouchableOpacity style={styles.button} onPress={handleRegister} disabled={loading}>
          {loading ? <ActivityIndicator color={BLACK} /> : <Text style={styles.buttonText}>Create account</Text>}
        </TouchableOpacity>
        <TouchableOpacity onPress={() => router.push('/login')}>
          <Text style={styles.link}>Already have an account? <Text style={styles.gold}>Sign in</Text></Text>
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
  label: { color: '#aaa', fontSize: 12, marginBottom: 6, marginTop: 16 },
  input: { backgroundColor: DARK, borderRadius: 10, padding: 14, color: '#fff', fontSize: 15 },
  button: { backgroundColor: GOLD, borderRadius: 10, padding: 16, alignItems: 'center', marginTop: 24 },
  buttonText: { color: BLACK, fontSize: 16, fontWeight: '700' },
  link: { color: '#aaa', fontSize: 13, textAlign: 'center', marginTop: 20 },
});