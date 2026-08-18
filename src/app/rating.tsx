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
//
// EXTENDED (delivery rating fix): delivery-track.tsx and
// buyer-deliveries.tsx's "Rate this delivery" button used to link here
// with a delivery_bookings id passed as session_id — but submit_rating()
// only ever recognizes meetpay_sessions ids, so it always threw
// "Transaction not found" for a real delivery. There was also no rating
// path anywhere for the delivery DRIVER — delivery_operators.rating/
// rating_count exist and are shown in the UI, but nothing ever wrote to
// them. Both are now handled by a second RPC, submit_delivery_rating(),
// reached via ?source=delivery&booking_id=...&target=seller|driver
// (see the two call sites above). Same security model: server-derives
// and verifies everything from the confirmed delivery_bookings row,
// client params here are cosmetic only. After rating the seller, if the
// booking has an assigned driver, the success screen offers a chained
// "Rate the driver" step — see currentTarget/startDriverRating below —
// rather than navigating to a second URL, so state resets cleanly
// without relying on this screen remounting.

import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import {
  ActivityIndicator,
  Platform,
  ScrollView,
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
  const { session_id, role, source, booking_id, target, has_driver } = useLocalSearchParams<{
    session_id: string;
    reviewee_id: string;
    role: string;
    listing_id: string;
    source: string;
    booking_id: string;
    target: string;
    has_driver: string;
  }>();
  // reviewee_id and listing_id are intentionally not destructured for
  // use beyond display — see file header. role is kept only to pick the
  // right pre-submission copy below.

  const isDelivery = source === 'delivery';

  const [stars, setStars] = useState(0);
  const [review, setReview] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState('');
  // Only meaningful when isDelivery — which of the two possible targets
  // (seller, then optionally driver) this screen is currently rating.
  // Starts from the target param (always 'seller' from the two call
  // sites today, but kept flexible), and flips to 'driver' via
  // startDriverRating() below after the seller step succeeds.
  const [currentTarget, setCurrentTarget] = useState<'seller' | 'driver'>(
    target === 'driver' ? 'driver' : 'seller'
  );

  async function handleSubmit() {
    if (stars === 0) {
      setError('Please select a star rating before submitting.');
      return;
    }

    setError('');
    setSubmitting(true);

    // The ONLY write path now — everything else (auth check, session/
    // booking validity, participant verification, duplicate check,
    // atomic aggregate update) happens server-side inside these RPCs.
    const { data, error: rpcError } = isDelivery
      ? await supabase.rpc('submit_delivery_rating', {
          p_booking_id: booking_id,
          p_target: currentTarget,
          p_stars: stars,
          p_review: review.trim() || null,
        })
      : await supabase.rpc('submit_rating', {
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

  // Chains straight into rating the driver after the seller step,
  // without navigating to a second URL — a router.push to this same
  // route wouldn't reliably remount the screen (or reset this state),
  // so the reset happens explicitly here instead.
  function startDriverRating() {
    setCurrentTarget('driver');
    setStars(0);
    setReview('');
    setError('');
    setSubmitted(false);
  }

  if (submitted) {
    const offerDriverStep = isDelivery && currentTarget === 'seller' && has_driver === '1';
    return (
      <View style={styles.container}>
        <View style={styles.successCard}>
          <Text style={styles.successIcon}>⭐</Text>
          <Text style={styles.successTitle}>Rating submitted!</Text>
          <Text style={styles.successBody}>
            Thank you for your feedback. It helps build trust on ImbizoHub.
          </Text>
          {offerDriverStep && (
            <TouchableOpacity style={styles.doneBtn} onPress={startDriverRating}>
              <Text style={styles.doneBtnText}>⭐ Rate the driver →</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity
            style={offerDriverStep ? styles.skipBtn : styles.doneBtn}
            onPress={() => router.replace('/')}
          >
            <Text style={offerDriverStep ? styles.skipText : styles.doneBtnText}>
              {offerDriverStep ? 'Skip — back to home' : 'Back to home'}
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  const isSeller = role === 'seller';

  return (
    // FIX (clean-sweep bug): same missing-ScrollView pattern found and
    // fixed elsewhere this pass — the star selector, review box, and
    // submit button could overflow a shorter viewport with no way to
    // reach the submit button.
    <ScrollView contentContainerStyle={styles.container}>
      <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
        <Text style={styles.backText}><Text style={styles.backArrow}>‹</Text> Skip for now</Text>
      </TouchableOpacity>

      <Text style={styles.heading}>Rate your experience</Text>
      <Text style={styles.subheading}>
        {isDelivery
          ? (currentTarget === 'driver'
              ? 'How was the driver? Your rating helps other buyers know who to trust for delivery.'
              : 'How was the seller? Your rating helps other buyers make safe decisions.')
          : (isSeller
              ? 'How was the buyer? Your rating helps other sellers know who to trust.'
              : 'How was the seller? Your rating helps other buyers make safe decisions.')}
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
        placeholder={isDelivery
          ? (currentTarget === 'driver'
              ? 'e.g. Driver was on time and handled the item carefully.'
              : 'e.g. Item was exactly as described, seller was friendly.')
          : (isSeller
              ? 'e.g. Buyer was on time and payment went smoothly.'
              : 'e.g. Item was exactly as described, seller was friendly.')}
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
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1, backgroundColor: '#111111',
    padding: 20, paddingTop: Platform.OS === 'ios' ? 56 : 40,
  },
  backBtn: { marginBottom: 8 },
  backText: { color: GREY, fontSize: 13 },
  // NEW: bigger than the label text so the '‹' glyph reads clearly — direct product decision ("back symbol too small").
  backArrow: { fontSize: 20 },

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
