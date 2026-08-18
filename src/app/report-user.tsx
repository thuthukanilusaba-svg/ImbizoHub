// app/report-user.tsx
// Report a seller/buyer — the real, honestly-scoped version of
// "report-a-seller / automated scammer detection" from the original
// project plan. Automated detection is a genuinely large, separate
// research project; this is the achievable part: a real report, stored
// against a real reporter and a real reported user. There is no
// in-app moderation queue anywhere in this app yet — reports are
// reviewed manually via the Supabase dashboard.
//
// Anonymous-friendly, same reasoning as chat: someone who was just
// scammed anonymously shouldn't be blocked from reporting it by a
// registration wall. Every report is still traceable to a specific
// reporter_id (real or anonymous session) via reports.reporter_id.
//
// Usage: router.push(`/report-user?user_id=${id}&name=${name}&context=listing&context_id=${listingId}`)

import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import {
    ActivityIndicator, Platform, ScrollView, StyleSheet,
    Text, TextInput, TouchableOpacity, View,
} from 'react-native';
import { supabase } from '../../lib/supabase';

const GOLD = '#B8860B';
const BLACK = '#1A1A18';
const DARK = '#2a2a2a';
const GREY = '#AAAAAA';

const REASONS = [
  'Scam or fraud',
  'Fake or misleading listing',
  'Inappropriate behavior',
  'No-show / wasted my time',
  'Other',
];

export default function ReportUserScreen() {
  const router = useRouter();
  const { user_id, name, context, context_id } = useLocalSearchParams<{
    user_id: string; name?: string; context?: string; context_id?: string;
  }>();

  const [reason, setReason] = useState('');
  const [details, setDetails] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit() {
    if (!reason) { setError('Please select a reason.'); return; }
    if (!user_id) { setError('No user specified.'); return; }

    setError('');
    setSubmitting(true);

    let { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      const { data, error: signInError } = await supabase.auth.signInAnonymously();
      if (signInError) {
        setSubmitting(false);
        setError('Couldn\'t submit — please check your connection and try again.');
        return;
      }
      user = data.user;
    }
    if (!user) { setSubmitting(false); setError('Something went wrong. Please try again.'); return; }

    if (user.id === user_id) {
      setSubmitting(false);
      setError('You can\'t report yourself.');
      return;
    }

    const { error: insertError } = await supabase.from('reports').insert({
      reporter_id: user.id,
      reported_user_id: user_id,
      listing_id: context === 'listing' && context_id ? parseInt(context_id) : null,
      context: context || 'other',
      reason,
      details: details.trim() || null,
    });

    setSubmitting(false);

    if (insertError) {
      setError(insertError.message);
      return;
    }

    setSubmitted(true);
  }

  if (submitted) {
    return (
      <View style={styles.container}>
        <View style={styles.successCard}>
          <Text style={styles.successEmoji}>✅</Text>
          <Text style={styles.successTitle}>Report submitted</Text>
          <Text style={styles.successBody}>
            Thanks for letting us know. Our team will look into it. If you're in immediate danger or have lost money, please also contact your local authorities.
          </Text>
          <TouchableOpacity style={styles.doneBtn} onPress={() => router.replace('/')}>
            <Text style={styles.doneBtnText}>Back to home</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Text style={styles.backText}>‹ Cancel</Text>
        </TouchableOpacity>

        <Text style={styles.heading}>Report {name || 'this user'}</Text>
        <Text style={styles.subheading}>
          Tell us what happened. Reports are reviewed by the ImbizoHub team.
        </Text>

        <Text style={styles.label}>What's the issue? *</Text>
        <View style={styles.reasonList}>
          {REASONS.map((r) => (
            <TouchableOpacity
              key={r}
              style={[styles.reasonChip, reason === r && styles.reasonChipActive]}
              onPress={() => setReason(r)}
            >
              <Text style={[styles.reasonChipText, reason === r && styles.reasonChipTextActive]}>{r}</Text>
            </TouchableOpacity>
          ))}
        </View>

        <Text style={styles.label}>Details (optional)</Text>
        <TextInput
          style={styles.textArea}
          value={details}
          onChangeText={setDetails}
          placeholder="Anything else we should know..."
          placeholderTextColor="#555"
          multiline
          numberOfLines={4}
          maxLength={500}
        />

        {error ? <Text style={styles.errorText}>⚠️ {error}</Text> : null}

        <TouchableOpacity
          style={[styles.submitBtn, (submitting || !reason) && { opacity: 0.5 }]}
          onPress={handleSubmit}
          disabled={submitting || !reason}
        >
          {submitting
            ? <ActivityIndicator color={BLACK} />
            : <Text style={styles.submitBtnText}>Submit report</Text>
          }
        </TouchableOpacity>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#111111' },
  content: { padding: 20, paddingTop: Platform.OS === 'ios' ? 56 : 40 },

  backBtn: { marginBottom: 16 },
  backText: { color: GREY, fontSize: 14 },
  heading: { fontSize: 22, fontWeight: '800', color: '#fff', marginBottom: 8 },
  subheading: { fontSize: 13, color: GREY, lineHeight: 19, marginBottom: 24 },

  label: { fontSize: 13, fontWeight: '700', color: '#fff', marginBottom: 10 },
  reasonList: { marginBottom: 20 },
  reasonChip: {
    backgroundColor: DARK, borderRadius: 12, paddingVertical: 13, paddingHorizontal: 16,
    marginBottom: 8, borderWidth: 1, borderColor: '#333',
  },
  reasonChipActive: { borderColor: '#ff8a8a', backgroundColor: '#2a1a1a' },
  reasonChipText: { color: GREY, fontSize: 13, fontWeight: '600' },
  reasonChipTextActive: { color: '#ff8a8a', fontWeight: '700' },

  textArea: {
    backgroundColor: DARK, borderRadius: 12, padding: 14,
    color: '#fff', fontSize: 13, lineHeight: 19,
    borderWidth: 0.5, borderColor: '#333',
    textAlignVertical: 'top', minHeight: 90, marginBottom: 20,
  },

  errorText: { color: '#ff8a8a', fontSize: 13, marginBottom: 16, textAlign: 'center' },

  submitBtn: { backgroundColor: '#c62828', borderRadius: 14, paddingVertical: 16, alignItems: 'center' },
  submitBtnText: { color: '#fff', fontSize: 15, fontWeight: '800' },

  successCard: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32 },
  successEmoji: { fontSize: 56, marginBottom: 20 },
  successTitle: { fontSize: 20, fontWeight: '800', color: '#fff', marginBottom: 10 },
  successBody: { fontSize: 13, color: GREY, textAlign: 'center', lineHeight: 20, marginBottom: 30 },
  doneBtn: { backgroundColor: GOLD, borderRadius: 14, paddingVertical: 14, paddingHorizontal: 36 },
  doneBtnText: { color: BLACK, fontSize: 14, fontWeight: '800' },
});
