// app/account-delete.tsx
// Account deletion — the real, user-facing entry point the retention
// policy depends on. Requesting deletion immediately anonymizes
// sensitive profile fields (via request_account_deletion(), see
// account-deletion.sql) and hides the person's listings/wanted posts
// from active browsing. The underlying account is then fully purged
// after a 30-day grace period by a separate scheduled process
// (delete-expired-accounts) — this screen doesn't wait for that; it
// signs the person out immediately once the anonymization succeeds.
//
// Requires typing "DELETE" to confirm — this is genuinely
// irreversible once the grace period elapses, and even the immediate
// anonymization step (name, phone, avatar, listings) can't be undone
// by the user themselves afterward. A simple button tap isn't enough
// friction for an action this consequential.
//
// Usage: router.push('/account-delete')

import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator, Platform, ScrollView, StyleSheet,
  Text, TextInput, TouchableOpacity, View,
} from 'react-native';
import { supabase } from '../../lib/supabase';

const GOLD = '#B8860B';
const BLACK = '#1A1A18';
const DARK = '#2a2a2a';
const GREY = '#AAAAAA';
const RED = '#ff8a8a';

export default function AccountDeleteScreen() {
  const router = useRouter();
  // NEW: unlike every other screen touched today, this one had no
  // auth check at all — it rendered the delete form unconditionally.
  // A fully logged-out user would hit the RPC's own server-side
  // "auth.uid() is null" guard and see a raw, untranslated Postgres
  // error rather than a graceful redirect. An anonymous session is
  // the more interesting case — anonymous users DO have a real
  // auth.uid(), so they'd sail past that server-side check entirely
  // and could "delete" their own anonymous session. Not a security
  // bug (the RPC only ever touches the caller's own row, so no
  // cross-user harm is possible), but a confusing dead-end for
  // someone who never had a real account to delete. Checking on
  // mount and redirecting both cases away, rather than letting them
  // reach the form at all.
  const [checkingAuth, setCheckingAuth] = useState(true);
  const [confirmText, setConfirmText] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);

  useEffect(() => { checkAuth(); }, []);

  async function checkAuth() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user || user.is_anonymous) {
      router.replace('/');
      return;
    }
    setCheckingAuth(false);
  }

  const canConfirm = confirmText.trim().toUpperCase() === 'DELETE';

  async function handleDelete() {
    if (!canConfirm) return;
    setError('');
    setDeleting(true);

    const { error: rpcError } = await supabase.rpc('request_account_deletion');

    if (rpcError) {
      setDeleting(false);
      setError(rpcError.message);
      return;
    }

    await supabase.auth.signOut();
    setDeleting(false);
    setDone(true);
  }

  if (checkingAuth) {
    return (
      <View style={[styles.container, { alignItems: 'center', justifyContent: 'center' }]}>
        <ActivityIndicator size="large" color={GOLD} />
      </View>
    );
  }

  if (done) {
    return (
      <View style={styles.container}>
        <View style={styles.doneCard}>
          <Text style={styles.doneEmoji}>✅</Text>
          <Text style={styles.doneTitle}>Account deletion requested</Text>
          <Text style={styles.doneBody}>
            Your personal details have been removed and your listings are no longer visible. Your account
            will be fully deleted within 30 days.
          </Text>
          <TouchableOpacity style={styles.doneBtn} onPress={() => router.replace('/')}>
            <Text style={styles.doneBtnText}>Back to home</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
        <Text style={styles.backText}>← Back</Text>
      </TouchableOpacity>

      <Text style={styles.heading}>Delete your account</Text>
      <Text style={styles.subheading}>This action is permanent and can't be undone.</Text>

      <View style={styles.warningCard}>
        <Text style={styles.warningTitle}>⚠️ What happens immediately</Text>
        <Text style={styles.warningItem}>• Your name, phone number, and photo are removed</Text>
        <Text style={styles.warningItem}>• Your active listings and wanted posts are taken down</Text>
        <Text style={styles.warningItem}>• You'll be signed out and can't log back in</Text>
      </View>

      <View style={styles.warningCard}>
        <Text style={styles.warningTitle}>🕐 What happens within 30 days</Text>
        <Text style={styles.warningItem}>• Your account is fully and permanently deleted</Text>
        <Text style={styles.warningItem}>
          • Ratings you've left stay visible (shown as "Deleted user"), and payment records are kept as
          required by law
        </Text>
      </View>

      <Text style={styles.label}>Type DELETE to confirm</Text>
      <TextInput
        style={styles.input}
        placeholder="DELETE"
        placeholderTextColor="#555"
        value={confirmText}
        onChangeText={setConfirmText}
        autoCapitalize="characters"
      />

      {error ? (
        <View style={styles.errorBox}><Text style={styles.errorText}>⚠️ {error}</Text></View>
      ) : null}

      <TouchableOpacity
        style={[styles.deleteBtn, (!canConfirm || deleting) && { opacity: 0.5 }]}
        onPress={handleDelete}
        disabled={!canConfirm || deleting}
      >
        {deleting
          ? <ActivityIndicator color="#fff" />
          : <Text style={styles.deleteBtnText}>Permanently delete my account</Text>
        }
      </TouchableOpacity>

      <TouchableOpacity style={styles.cancelLink} onPress={() => router.back()}>
        <Text style={styles.cancelLinkText}>Cancel, keep my account</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#111111' },
  content: { padding: 20, paddingTop: Platform.OS === 'ios' ? 56 : 40, paddingBottom: 48 },

  backBtn: { marginBottom: 16 },
  backText: { color: GREY, fontSize: 14 },

  heading: { fontSize: 24, fontWeight: '800', color: '#fff', marginBottom: 6 },
  subheading: { fontSize: 13, color: RED, marginBottom: 24, fontWeight: '600' },

  warningCard: { backgroundColor: BLACK, borderRadius: 14, padding: 16, marginBottom: 16, borderWidth: 0.5, borderColor: '#333' },
  warningTitle: { fontSize: 13, fontWeight: '700', color: '#fff', marginBottom: 10 },
  warningItem: { fontSize: 12, color: GREY, lineHeight: 19, marginBottom: 2 },

  label: { fontSize: 13, fontWeight: '700', color: '#fff', marginBottom: 8, marginTop: 8 },
  input: {
    backgroundColor: DARK, borderRadius: 10, paddingHorizontal: 14,
    paddingVertical: Platform.OS === 'ios' ? 13 : 10, fontSize: 16, color: '#fff',
    borderWidth: 0.5, borderColor: '#333', marginBottom: 20, letterSpacing: 2,
  },

  errorBox: { backgroundColor: '#3a1a1a', borderRadius: 10, padding: 12, marginBottom: 16 },
  errorText: { color: RED, fontSize: 13 },

  deleteBtn: { backgroundColor: '#8a2a2a', borderRadius: 14, paddingVertical: 16, alignItems: 'center' },
  deleteBtnText: { color: '#fff', fontSize: 15, fontWeight: '800' },

  cancelLink: { alignItems: 'center', paddingVertical: 16, marginTop: 4 },
  cancelLinkText: { color: GOLD, fontSize: 14, fontWeight: '600' },

  doneCard: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  doneEmoji: { fontSize: 56, marginBottom: 16 },
  doneTitle: { color: '#fff', fontSize: 20, fontWeight: '800', marginBottom: 12, textAlign: 'center' },
  doneBody: { color: GREY, fontSize: 13, textAlign: 'center', lineHeight: 20, marginBottom: 28 },
  doneBtn: { backgroundColor: GOLD, borderRadius: 14, paddingVertical: 14, paddingHorizontal: 32 },
  doneBtnText: { color: BLACK, fontSize: 14, fontWeight: '800' },
});
