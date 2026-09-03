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
import { useEffect, useState } from 'react';
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

  // TAPPED FEEDBACK, because typed feedback was not arriving.
  //
  // All 16 ratings in this app were 5 stars and 14 had no text at all; the
  // two that did read "Awesome" and "5 star". A free text box with no
  // prompt gets one word. A chip gets tapped — people will tap "Late" when
  // they would never compose a sentence saying so — and unlike free text,
  // chips aggregate into something a profile can show.
  //
  // Every tag names something the other person could have done
  // differently. Nothing here is a mood: no "friendly", no "professional".
  // Which set is offered follows the stars, so nobody is asked to explain
  // a problem they did not report.
  const [tags, setTags] = useState<string[]>([]);
  const POSITIVE_TAGS: [string, string][] = [
    ['as_described', 'As described'],
    ['on_time', 'On time'],
    ['easy_to_deal_with', 'Easy to deal with'],
    ['fair_price', 'Fair price'],
  ];
  const NEGATIVE_TAGS: [string, string][] = [
    ['not_as_described', 'Not as described'],
    ['late', 'Late'],
    ['hard_to_reach', 'Hard to reach'],
    ['pushed_off_app', 'Pushed me off the app'],
  ];
  // 4 stars and up reads as "this went well"; 3 and below as "it did not".
  const tagOptions = stars >= 4 ? POSITIVE_TAGS : NEGATIVE_TAGS;

  function toggleTag(value: string) {
    setTags((current) =>
      current.includes(value)
        ? current.filter((t) => t !== value)
        // Capped at 4 to match the ratings_tags_known constraint, and
        // because a rating that ticks everything says nothing.
        : current.length >= 4 ? current : [...current, value]
    );
  }
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

  // NEW (found by a tester: "it still asks for rating, I'm afraid one
  // would rate many times"). Their reputation was never actually at
  // risk — submit_rating()/submit_delivery_rating() both refuse a second
  // rating, and there are unique constraints behind both — but this
  // screen treated the refusal as a success. Someone could give 5 stars,
  // come back a week later, give 1 star and a bad review, and be told
  // "Rating submitted! Thank you for your feedback." Nothing was
  // written. The app lied to them about their own opinion.
  //
  // So: find out BEFORE showing an empty star picker. ratings is
  // publicly readable ("Anyone can view ratings"), so this needs no new
  // RPC — and it is the same row the RPC would have found.
  const [checkingExisting, setCheckingExisting] = useState(true);
  const [existing, setExisting] = useState<{
    stars: number; review: string | null; created_at: string;
  } | null>(null);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      setCheckingExisting(true);
      try {
        const { data: auth } = await supabase.auth.getUser();
        const uid = auth?.user?.id;
        // chat.tsx builds this URL with `session_id=${session?.id}`, so a
        // missing session arrives here as the literal string "undefined"
        // rather than as absent. Treat it as absent.
        const validSession = session_id && session_id !== 'undefined' ? session_id : null;
        const validBooking = booking_id && booking_id !== 'undefined' ? booking_id : null;

        if (!uid || (isDelivery ? !validBooking : !validSession)) {
          if (!cancelled) { setExisting(null); setCheckingExisting(false); }
          return;
        }

        let query = supabase
          .from('ratings')
          .select('stars, review, created_at')
          .eq('reviewer_id', uid);

        query = isDelivery
          ? query.eq('delivery_booking_id', validBooking).eq('target', currentTarget)
          : query.eq('meetpay_session_id', validSession);

        const { data } = await query.maybeSingle();
        if (!cancelled) setExisting(data ?? null);
      } catch {
        // A failed lookup must not block someone from rating. Worst case
        // they submit, the RPC says already_rated, and handleSubmit()
        // below shows them the same screen this would have.
        if (!cancelled) setExisting(null);
      } finally {
        if (!cancelled) setCheckingExisting(false);
      }
    })();

    return () => { cancelled = true; };
    // currentTarget is in here on purpose: the chained "rate the driver"
    // step re-runs this for the driver row without remounting.
  }, [isDelivery, session_id, booking_id, currentTarget]);

  function formatRatedOn(iso: string) {
    try {
      return new Date(iso).toLocaleDateString(undefined, {
        day: 'numeric', month: 'short', year: 'numeric',
      });
    } catch {
      return '';
    }
  }

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
          p_tags: tags.length ? tags : null,
        });

    setSubmitting(false);

    if (rpcError) {
      setError(rpcError.message);
      return;
    }

    // CHANGED: 'already_rated' used to be shown as a success. It is not
    // one — nothing was written, and the stars and review this person
    // just typed were discarded. It is not an ERROR either (they did
    // nothing wrong), so it gets its own screen: their existing rating,
    // shown back to them, so they can see what they actually said.
    if ((data as any)?.status === 'already_rated') {
      const { data: row } = await (isDelivery
        ? supabase.from('ratings').select('stars, review, created_at')
            .eq('id', (data as any).rating_id).maybeSingle()
        : supabase.from('ratings').select('stars, review, created_at')
            .eq('id', (data as any).rating_id).maybeSingle());
      setExisting(row ?? { stars: 0, review: null, created_at: '' });
      return;
    }

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
    // Clear rather than leave the seller's row on screen while the
    // effect re-runs for the driver — otherwise the first frame of the
    // driver step shows the rating they gave the seller.
    setExisting(null);
    setCheckingExisting(true);
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

  // NEW: don't show a star picker until we know whether it would do
  // anything. A brief spinner is honest; an empty form that silently
  // discards what you type is not.
  if (checkingExisting) {
    return (
      <View style={styles.container}>
        <View style={styles.successCard}>
          <ActivityIndicator color={GOLD} />
        </View>
      </View>
    );
  }

  // NEW: they already rated this. Show them what they said instead of
  // inviting them to say it again.
  if (existing) {
    const offerDriverStep = isDelivery && currentTarget === 'seller' && has_driver === '1';
    const ratedWhom = isDelivery
      ? (currentTarget === 'driver' ? 'the driver' : 'the seller')
      : (isSeller ? 'the buyer' : 'the seller');
    return (
      <View style={styles.container}>
        <View style={styles.successCard}>
          <Text style={styles.successIcon}>✅</Text>
          <Text style={styles.successTitle}>You already rated {ratedWhom}</Text>

          <View style={styles.existingCard}>
            <Text style={styles.existingStars}>
              {'★'.repeat(Math.max(0, Math.min(5, existing.stars)))}
              <Text style={styles.existingStarsDim}>
                {'★'.repeat(Math.max(0, 5 - existing.stars))}
              </Text>
            </Text>
            {existing.review ? (
              <Text style={styles.existingReview}>“{existing.review}”</Text>
            ) : null}
            {existing.created_at ? (
              <Text style={styles.existingDate}>{formatRatedOn(existing.created_at)}</Text>
            ) : null}
          </View>

          <Text style={styles.successBody}>
            A rating can only be given once per transaction — that is what keeps
            ratings on ImbizoHub worth trusting.
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

      {/* Tapped feedback, offered BEFORE the text box. The order matters:
          most people will stop after the chips, and that is fine — the
          chips are the part that carries information. Only shown once
          stars are chosen, so the question matches the verdict. */}
      {stars > 0 && !isDelivery ? (
        <>
          <Text style={styles.reviewLabel}>
            {stars >= 4 ? 'What went well?' : 'What went wrong?'}
          </Text>
          <View style={styles.tagRow}>
            {tagOptions.map(([value, label]) => {
              const on = tags.includes(value);
              return (
                <TouchableOpacity
                  key={value}
                  style={[styles.tagChip, on && (stars >= 4 ? styles.tagChipOn : styles.tagChipBad)]}
                  onPress={() => toggleTag(value)}
                  activeOpacity={0.85}
                >
                  <Text style={[styles.tagChipText, on && (stars >= 4 ? styles.tagChipTextOn : styles.tagChipTextBad)]}>
                    {label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </>
      ) : null}

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

      {/* CHANGED (1 Sep 2026): was always router.replace('/'), which threw
          anyone who declined to rate out to the home feed regardless of
          where they came from. Skipping a rating should put you back where
          you were — most importantly on the van-hire confirmation screen,
          which shows that the trip completed. Falls back to home only when
          there is genuinely nothing to go back to (a deep link straight
          into this screen). */}
      <TouchableOpacity
        style={styles.skipBtn}
        onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))}
      >
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

  // Negative chips get their own colour when selected. A red "Late" is
  // harder to tap by accident than a gold one, and it reads back to the
  // person as a real statement rather than a preference.
  tagRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 18 },
  tagChip: {
    backgroundColor: '#222220', borderWidth: 1, borderColor: '#3a3a35',
    borderRadius: 999, paddingVertical: 9, paddingHorizontal: 14,
  },
  tagChipOn: { backgroundColor: '#2A2416', borderColor: '#5a4a1c' },
  tagChipBad: { backgroundColor: '#3a1a1a', borderColor: '#7a2f2f' },
  tagChipText: { color: '#AAAAAA', fontSize: 13 },
  tagChipTextOn: { color: GOLD, fontWeight: '700' },
  tagChipTextBad: { color: '#ff8a8a', fontWeight: '700' },
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

  // NEW: the read-only card showing a rating already given.
  existingCard: {
    backgroundColor: DARK, borderRadius: 14, paddingVertical: 18,
    paddingHorizontal: 20, alignItems: 'center', alignSelf: 'stretch',
    borderWidth: 0.5, borderColor: '#333', marginBottom: 24,
  },
  existingStars: { fontSize: 28, color: GOLD, letterSpacing: 2 },
  existingStarsDim: { color: '#3a3a3a' },
  existingReview: {
    color: '#ddd', fontSize: 13, lineHeight: 20, fontStyle: 'italic',
    textAlign: 'center', marginTop: 12,
  },
  existingDate: { color: '#666', fontSize: 11, marginTop: 12 },
});
