// app/rating.tsx
// Rating screen — shown after a Meet & Pay session is confirmed
// Both buyer and seller are prompted to rate each other
// Usage: router.push(`/rating?session_id=...&reviewee_id=...&role=buyer|seller&listing_id=...`)
//
// FULL SECURITY REWRITE (found during a full-app review pass): the
// previous version wrote directly to `ratings` and `profiles` from the
// client. This meant:
//   1. profiles.rating/rating_count could be set to ANY value by ANY
//      user via a direct API call — no server-side proof a real,
//      confirmed transaction ever happened.
//   2. reviewee_id and role were trusted straight from the URL —
//      someone could rate a totally unrelated person just by editing
//      the query string.
//   3. The duplicate-submission check (added earlier today) was
//      client-side only — a real improvement for normal use, but never
//      an actual security boundary, since it could be bypassed the same
//      way as #1.
//
// Now calls a single Postgres RPC, submit_rating(), which is the ONLY
// path allowed to write a rating or touch the aggregate — direct client
// UPDATE access to profiles.rating/rating_count has been revoked at the
// database level (see rating-security-rewrite.sql). The function
// derives reviewee_id and role from the confirmed meetpay_session
// itself, never from client input, and does the duplicate check plus
// the aggregate update atomically in one transaction.
//
// reviewee_id, role, and listing_id are now ONLY used for this screen's
// own pre-submission copy ("How was the seller?" etc.) — purely
// cosmetic. Tampering with them in the URL can only change what text
// someone sees before submitting; it has zero effect on what actually
// gets written, since the RPC re-derives the real values server-side
// from the session itself regardless of what the URL says.

import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import {
  ActivityIndicator,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View
} from 'react-native';
import { supabase } from '../../lib/supabase';

const GOLD = '#B8860B';
const BLACK = '#1A1A18';
const DARK = '#2a2a2a';
const GREY = '#AAAAAA';

export default function RatingScreen() {
  const router = useRouter();
  const { session_id, role } = useLocalSearchParams<{
    session_id: string;
    reviewee_id: string;
    role: string;
    listing_id: string;
  }>();
  // reviewee_id and listing_id are intentionally not destructured for
  // use beyond display — see file header. role is kept only to pick the
  // right pre-submission copy below.

  const [stars, setStars] = useState(0);
  const [review, setReview] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit() {
    if (stars === 0) {
      setError('Please select a star rating before submitting.');
      return;
    }

    setError('');
    setSubmitting(true);

    // The ONLY write path now — everything else (auth check, session
    // validity, participant verification, duplicate check, atomic
    // aggregate update) happens server-side inside this one function.
    const { data, error: rpcError } = await supabase.rpc('submit_rating', {
      p_session_id: session_id,
      p_stars: stars,
      p_review: review.trim() || null,
    });

    setSubmitting(false);

    if (rpcError) {
      setError(rpcError.message);
      return;
    }

    // data.status is either 'submitted' or 'already_rated' — both are
    // shown as success from the user's point of view (see
    // submit_rating()'s own comment on why 'already_rated' isn't an
    // error).
    setSubmitted(true);
  }

  if (submitted) {
    return (
      <View style={styles.container}>
        <View style={styles.successCard}>
          <Text style={styles.successIcon}>⭐</Text>
          <Text style={styles.successTitle}>Rating submitted!</Text>
          <Text style={styles.successBody}>
            Thank you for your feedback. It helps build trust on ImbizoHub.
          </Text>
          <TouchableOpacity style={styles.doneBtn} onPress={() => router.replace('/')}>
            <Text style={styles.doneBtnText}>Back to home</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  const isSeller = role === 'seller';

  return (
    <View style={styles.container}>
      <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
        <Text style={styles.backText}>← Skip for now</Text>
      </TouchableOpacity>

      <Text style={styles.heading}>Rate your experience</Text>
      <Text style={styles.subheading}>
        {isSeller
          ? 'How was the buyer? Your rating helps other sellers know who to trust.'
          : 'How was the seller? Your rating helps other buyers make safe decisions.'}
      </Text>

      {/* Star selector */}
      <View style={styles.starsRow}>
        {[1, 2, 3, 4, 5].map((s) => (
          <TouchableOpacity key={s} onPress={() => setStars(s)} style={styles.starBtn}>
            <Text style={[styles.star, s <= stars && styles.starActive]}>★</Text>
          </TouchableOpacity>
        ))}
      </View>

      {stars > 0 && (
        <Text style={styles.starLabel}>
          {stars === 1 ? 'Poor' : stars === 2 ? 'Fair' : stars === 3 ? 'Good' : stars === 4 ? 'Very good' : 'Excellent'}
        </Text>
      )}

      {/* Optional review text */}
      <Text style={styles.reviewLabel}>Add a comment (optional)</Text>
      <TextInput
        style={styles.reviewInput}
        value={review}
        onChangeText={setReview}
        placeholder={isSeller
          ? 'e.g. Buyer was on time and payment went smoothly.'
          : 'e.g. Item was exactly as described, seller was friendly.'}
        placeholderTextColor="#555"
        multiline
        numberOfLines={3}
        maxLength={200}
      />
      <Text style={styles.charCount}>{review.length}/200</Text>

      {error ? <Text style={styles.errorText}>⚠️ {error}</Text> : null}

      <TouchableOpacity
        style={[styles.submitBtn, (submitting || stars === 0) && { opacity: 0.5 }]}
        onPress={handleSubmit}
        disabled={submitting || stars === 0}
      >
        {submitting
          ? <ActivityIndicator color={BLACK} />
          : <Text style={styles.submitBtnText}>Submit rating</Text>
        }
      </TouchableOpacity>

      <TouchableOpacity style={styles.skipBtn} onPress={() => router.replace('/')}>
        <Text style={styles.skipText}>Skip — rate later</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1, backgroundColor: '#111111',
    padding: 20, paddingTop: Platform.OS === 'ios' ? 56 : 40,
  },
  backBtn: { marginBottom: 8 },
  backText: { color: GREY, fontSize: 13 },

  heading: { fontSize: 24, fontWeight: '800', color: '#fff', marginBottom: 8, marginTop: 8 },
  subheading: { fontSize: 13, color: GREY, lineHeight: 19, marginBottom: 32 },

  starsRow: { flexDirection: 'row', justifyContent: 'center', gap: 8, marginBottom: 12 },
  starBtn: { padding: 6 },
  star: { fontSize: 44, color: '#333' },
  starActive: { color: GOLD },
  starLabel: { textAlign: 'center', color: GOLD, fontSize: 14, fontWeight: '700', marginBottom: 24 },

  reviewLabel: { fontSize: 13, fontWeight: '700', color: '#fff', marginBottom: 8 },
  reviewInput: {
    backgroundColor: DARK, borderRadius: 12, padding: 14,
    color: '#fff', fontSize: 13, lineHeight: 20,
    borderWidth: 0.5, borderColor: '#333',
    textAlignVertical: 'top', minHeight: 80,
  },
  charCount: { color: '#555', fontSize: 11, textAlign: 'right', marginTop: 4, marginBottom: 20 },

  errorText: { color: '#ff8a8a', fontSize: 13, marginBottom: 12, textAlign: 'center' },

  submitBtn: {
    backgroundColor: GOLD, borderRadius: 14,
    paddingVertical: 16, alignItems: 'center', marginBottom: 12,
  },
  submitBtnText: { color: BLACK, fontSize: 15, fontWeight: '800' },

  skipBtn: { alignItems: 'center', paddingVertical: 10 },
  skipText: { color: GREY, fontSize: 13 },

  successCard: {
    flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 30,
  },
  successIcon: { fontSize: 64, marginBottom: 20 },
  successTitle: { fontSize: 22, fontWeight: '800', color: '#fff', marginBottom: 8, textAlign: 'center' },
  successBody: { fontSize: 14, color: GREY, textAlign: 'center', lineHeight: 21, marginBottom: 32 },
  doneBtn: {
    backgroundColor: GOLD, borderRadius: 14,
    paddingVertical: 16, paddingHorizontal: 40, alignItems: 'center',
  },
  doneBtnText: { color: BLACK, fontSize: 15, fontWeight: '800' },
});
