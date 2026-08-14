// app/meetpay.tsx
// Trip completion confirmation for van-hire — NOT PIN-based.
//
// UPDATED (product decision): previously used the same PIN mechanism
// as listing handovers (buyer generates, seller enters). Removed for
// van-hire specifically — both people are already together for the
// entire ride, so a PIN's original purpose (proving a brief,
// disputable handover moment actually happened) doesn't really apply
// the way it does for a physical item changing hands. Replaced with
// mutual confirmation: BOTH the customer and the driver independently
// tap "Confirm Trip Complete" — status only flips to 'confirmed' once
// BOTH have, so it still requires real agreement from both sides, just
// without exchanging a code.
//
// This still gates ratings exactly the way the PIN used to — nothing
// about that changed, only the mechanism for reaching "confirmed."
//
// FIX (real bug, found during a thorough review): the "waiting for the
// other person" screen had no way to detect when they actually
// confirmed — no realtime subscription, no polling, nothing. session
// state was set once and never refreshed, so confirming first meant
// seeing "Waiting..." forever until manually leaving and returning.
// This is the exact same gap already found and fixed for
// meetpay_sessions in chat.tsx earlier — it just never got applied to
// this dedicated van-hire confirmation screen. Same fix here: a
// realtime subscription that updates session state automatically the
// moment the other party's confirmation comes in.
//
// FIX (real data bug, found in the same pass): createSession() sets
// buyer_id: null when the OPERATOR reaches this screen before the
// customer does (there's no buyer_id URL param to fall back on the way
// seller_id has one). Nothing ever filled that in afterward —
// handleConfirmMyself() only ever touched the confirmation timestamp
// columns. Consequence: if the operator confirms and later tries to
// rate the customer, session.buyer_id was still null, silently
// breaking the rating link in exactly that ordering. Now sets buyer_id
// alongside the buyer's own confirmation timestamp, closing the gap
// regardless of who reached the screen first.
//
// ⚠️ SECURITY FIX (found during a full-codebase sweep, serious finding):
// init() used to derive role purely from `user.id === seller_id`, where
// seller_id comes straight from the URL — with NO check that the
// current user was an actual participant in this trip at all. Anyone
// authenticated (or anonymous, since there wasn't even an is_anonymous
// check) who knew or guessed a reference_id + seller_id pair could open
// this screen and be treated as "the buyer":
//   - If no session existed yet, they could create one with THEIR OWN
//     id as buyer_id for a trip that isn't theirs.
//   - If a real session already existed, handleConfirmMyself()'s
//     `buyer_id: myId` write would silently OVERWRITE the real buyer's
//     id with the impostor's — hijacking an in-progress confirmation,
//     potentially tricking the operator into thinking the real customer
//     confirmed, and letting the impostor become eligible to rate the
//     operator via rating.tsx.
// Same class of bug as delivery-track.tsx's PIN exposure earlier in
// this sweep: trusting a URL param as an identity claim instead of
// verifying it against the real record. Now cross-checks reference_id
// (a quotes.id) against quotes.operator_id and, via quotes.request_id,
// requests.user_id — the current user must genuinely match one of
// those two to proceed at all.
//
// Usage: router.push(`/meetpay?type=van_hire&reference_id=${quoteId}&seller_id=${operatorId}&amount=${balance}`)

import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator, Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { supabase } from '../../lib/supabase';

const GOLD = '#B8860B';
const BLACK = '#1A1A18';
const DARK = '#2a2a2a';
const GREY = '#AAAAAA';
const GREEN = '#4CAF50';

export default function MeetPayScreen() {
  const router = useRouter();
  const { type, reference_id, seller_id, amount } = useLocalSearchParams<{
    type: string; reference_id: string; seller_id: string; amount?: string;
  }>();

  const [myId, setMyId] = useState('');
  const [role, setRole] = useState<'buyer' | 'seller' | null>(null);
  const [session, setSession] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [confirming, setConfirming] = useState(false);
  const channelRef = useRef<any>(null);

  useEffect(() => {
    init();
    return () => {
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current);
        channelRef.current = null;
      }
    };
  }, []);

  async function init() {
    setLoading(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user || user.is_anonymous) { router.replace('/register'); return; }
    setMyId(user.id);

    // FIX: verify the current user is a genuine participant in this
    // trip before doing anything else — see top-of-file comment. Only
    // van_hire is ever routed here (from quotes.tsx), so reference_id is
    // always a quotes.id; cross-check it against quotes.operator_id and,
    // via quotes.request_id, requests.user_id (the real buyer).
    const { data: quote } = await supabase
      .from('quotes')
      .select('operator_id, request_id')
      .eq('id', reference_id)
      .maybeSingle();

    if (!quote) {
      setLoading(false);
      setError('This trip could not be found.');
      return;
    }

    const isSeller = user.id === quote.operator_id;
    let isRealBuyer = false;

    if (!isSeller) {
      const { data: req } = await supabase
        .from('requests')
        .select('user_id')
        .eq('id', quote.request_id)
        .maybeSingle();
      isRealBuyer = !!req && req.user_id === user.id;
    }

    if (!isSeller && !isRealBuyer) {
      setLoading(false);
      setError('This isn\'t your trip.');
      return;
    }

    setRole(isSeller ? 'seller' : 'buyer');

    const { data: existing } = await supabase
      .from('meetpay_sessions')
      .select('*')
      .eq('reference_id', reference_id)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (existing) {
      setSession(existing);
      subscribeToSession(existing.id);
    } else {
      // FIX: pass the DB-verified quote.operator_id, not the raw
      // seller_id URL param — see top-of-file comment. Without this, a
      // real buyer with a tampered seller_id in the URL could create a
      // session pointing at an unrelated operator instead of the actual
      // one from the quote.
      await createSession(user.id, isSeller, quote.operator_id);
    }

    setLoading(false);
  }

  // NEW: realtime sync — see top-of-file comment. Catches the other
  // party's confirmation (or the session first being created, if this
  // side got here before a session existed at all) without needing a
  // manual reload.
  function subscribeToSession(sessionId: string) {
    if (channelRef.current) {
      supabase.removeChannel(channelRef.current);
      channelRef.current = null;
    }

    const channel = supabase
      .channel(`meetpay-session-${sessionId}`)
      .on('postgres_changes', {
        event: 'UPDATE', schema: 'public', table: 'meetpay_sessions',
        filter: `id=eq.${sessionId}`,
      }, (payload) => {
        if (payload.new) setSession(payload.new);
      })
      .subscribe();

    channelRef.current = channel;
  }

  async function createSession(userId: string, isSeller: boolean, verifiedOperatorId: string) {
    // FIX (part of the delivery_bookings/meetpay_sessions RPC redesign):
    // this used to insert directly, and had the buyer_id:null gap
    // documented at the top of this file when the operator reached the
    // screen first. create_meetpay_session() derives buyer_id/seller_id
    // itself server-side from quotes/requests (the exact same cross-check
    // this screen's own init() already performs), so there's no ordering
    // gap and no null buyer_id regardless of who calls it first — the
    // isSeller/verifiedOperatorId params here are no longer needed since
    // the RPC re-derives everything, but init() still does its own
    // participant check up front for the friendly error screen.
    const { data, error: createError } = await supabase.rpc('create_meetpay_session', {
      p_type: type || 'van_hire',
      p_reference_id: reference_id,
      p_amount: amount ? parseFloat(amount) : null,
    });

    if (createError) {
      setError(createError.message);
      return;
    }
    setSession(data);
    subscribeToSession(data.id);
  }

  async function handleConfirmMyself() {
    if (!session) return;
    setError('');
    setConfirming(true);

    // FIX (part of the delivery_bookings/meetpay_sessions RPC redesign):
    // this used to be two separate client-driven updates — one to set
    // this caller's own confirmation timestamp, and (if the local `data`
    // showed both sides now confirmed) a second update to flip
    // status='confirmed'. That gap between reading and re-writing was a
    // real race: both parties confirming at nearly the same moment could
    // each read the other's confirmation as not-yet-set and never issue
    // the finalizing update. It also still carried the buyer_id:null gap
    // (a client update payload, only fixed reactively per confirming
    // party, not derived from real trip data). confirm_meetpay_trip()
    // sets the caller's own confirmation timestamp AND finalizes to
    // 'confirmed' atomically in the same server-side call whenever both
    // sides are now in, closing the race entirely.
    const { data, error: updateError } = await supabase.rpc('confirm_meetpay_trip', {
      p_session_id: session.id,
    });

    if (updateError) {
      setConfirming(false);
      setError(updateError.message);
      return;
    }

    setSession(data);
    setConfirming(false);
  }

  // FIX: previously any early setError() (e.g. "not your trip") left
  // role null forever, which fell into the loading spinner branch below
  // and showed an infinite spinner instead of the actual error. Now
  // shows the error explicitly once loading has finished.
  if (!loading && !role && error) {
    return (
      <View style={styles.container}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Text style={styles.backText}>← Back</Text>
        </TouchableOpacity>
        <View style={styles.errorBox}><Text style={styles.errorText}>⚠️ {error}</Text></View>
      </View>
    );
  }

  if (loading || !role) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={GOLD} />
      </View>
    );
  }

  const myConfirmedAt = role === 'buyer' ? session?.buyer_confirmed_at : session?.operator_confirmed_at;
  const otherConfirmedAt = role === 'buyer' ? session?.operator_confirmed_at : session?.buyer_confirmed_at;
  const otherRoleLabel = role === 'buyer' ? 'your driver' : 'your customer';
  const isFullyConfirmed = session?.status === 'confirmed';

  if (isFullyConfirmed) {
    return (
      <View style={styles.confirmedScreen}>
        <Text style={styles.confirmedEmoji}>✅</Text>
        <Text style={styles.confirmedTitle}>Trip confirmed!</Text>
        <Text style={styles.confirmedBody}>
          Both you and {otherRoleLabel} confirmed the trip is complete. Thank you for using ImbizoHub safely.
        </Text>
        {session?.amount ? (
          <View style={styles.confirmedAmountBox}>
            <Text style={styles.confirmedAmountLabel}>Amount</Text>
            <Text style={styles.confirmedAmountValue}>${session.amount}</Text>
          </View>
        ) : null}
        <TouchableOpacity
          style={styles.doneBtn}
          onPress={() => router.push(
            `/rating?session_id=${session.id}&reviewee_id=${role === 'buyer' ? session.seller_id : session.buyer_id}&role=${role}`
          )}
        >
          <Text style={styles.doneBtnText}>⭐ Rate this trip</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.skipLink} onPress={() => router.replace('/')}>
          <Text style={styles.skipLinkText}>Skip for now</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (myConfirmedAt && !otherConfirmedAt) {
    return (
      <View style={styles.container}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Text style={styles.backText}>← Back</Text>
        </TouchableOpacity>

        <Text style={styles.heading}>Confirm Trip Complete</Text>

        <View style={styles.waitingBox}>
          <Text style={styles.waitingEmoji}>✅</Text>
          <Text style={styles.waitingTitle}>You confirmed</Text>
          <ActivityIndicator color={GOLD} style={{ marginVertical: 12 }} />
          <Text style={styles.waitingText}>Waiting for {otherRoleLabel} to confirm too...</Text>
        </View>
      </View>
    );
  }

  return (
    // FIX (clean-sweep bug): same missing-ScrollView pattern found and
    // fixed elsewhere this pass — the confirm button and instructions
    // box below it could sit below the fold on a shorter viewport with
    // no way to scroll down to them.
    <ScrollView contentContainerStyle={styles.container}>
      <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
        <Text style={styles.backText}>← Back</Text>
      </TouchableOpacity>

      <Text style={styles.heading}>Confirm Trip Complete</Text>
      <Text style={styles.subheading}>
        Once your trip is actually finished, both you and {otherRoleLabel} need to confirm — tap below once you're ready.
      </Text>

      {error ? (
        <View style={styles.errorBox}><Text style={styles.errorText}>⚠️ {error}</Text></View>
      ) : null}

      {otherConfirmedAt && (
        <View style={styles.otherConfirmedBox}>
          <Text style={styles.otherConfirmedText}>
            ✅ {otherRoleLabel === 'your driver' ? 'Your driver has' : 'Your customer has'} already confirmed — you're the last step.
          </Text>
        </View>
      )}

      {session?.amount ? (
        <Text style={styles.amountHint}>Trip amount: ${session.amount}</Text>
      ) : null}

      <TouchableOpacity
        style={[styles.confirmBtn, confirming && { opacity: 0.6 }]}
        onPress={handleConfirmMyself}
        disabled={confirming}
      >
        {confirming ? <ActivityIndicator color={BLACK} /> : <Text style={styles.confirmBtnText}>Confirm Trip Complete</Text>}
      </TouchableOpacity>

      <View style={styles.instructionsBox}>
        <Text style={styles.instructionsTitle}>Important</Text>
        <Text style={styles.instructionsNote}>
          Only confirm once your trip has actually finished. This action can't be undone, and the trip is only
          marked complete once both you and {otherRoleLabel} have confirmed.
        </Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#111111', padding: 20, paddingTop: Platform.OS === 'ios' ? 56 : 40 },
  center: { flex: 1, backgroundColor: '#111', alignItems: 'center', justifyContent: 'center' },

  backBtn: { marginBottom: 16 },
  backText: { color: GREY, fontSize: 14 },
  heading: { fontSize: 24, fontWeight: '800', color: '#fff', marginBottom: 8 },
  subheading: { fontSize: 13, color: GREY, lineHeight: 19, marginBottom: 24 },

  errorBox: { backgroundColor: '#3a1a1a', borderRadius: 10, padding: 12, marginBottom: 16 },
  errorText: { color: '#ff8a8a', fontSize: 13 },

  otherConfirmedBox: { backgroundColor: '#1a3a1a', borderRadius: 10, padding: 14, marginBottom: 16, borderWidth: 0.5, borderColor: '#2a5a2a' },
  otherConfirmedText: { color: GREEN, fontSize: 13, lineHeight: 18 },

  amountHint: { fontSize: 13, color: GREY, textAlign: 'center', marginBottom: 20 },

  confirmBtn: { backgroundColor: GOLD, borderRadius: 14, paddingVertical: 18, alignItems: 'center', marginBottom: 24 },
  confirmBtnText: { color: BLACK, fontSize: 16, fontWeight: '800' },

  instructionsBox: { backgroundColor: BLACK, borderRadius: 14, padding: 18, borderWidth: 0.5, borderColor: '#333' },
  instructionsTitle: { fontSize: 13, fontWeight: '700', color: '#fff', marginBottom: 10 },
  instructionsNote: { fontSize: 13, color: GREY, lineHeight: 20 },

  waitingBox: { backgroundColor: BLACK, borderRadius: 18, padding: 36, alignItems: 'center', borderWidth: 0.5, borderColor: '#333' },
  waitingEmoji: { fontSize: 40, marginBottom: 8 },
  waitingTitle: { fontSize: 16, fontWeight: '700', color: '#fff', marginBottom: 4 },
  waitingText: { fontSize: 13, color: GREY, textAlign: 'center' },

  confirmedScreen: { flex: 1, backgroundColor: '#111', alignItems: 'center', justifyContent: 'center', padding: 32 },
  confirmedEmoji: { fontSize: 64, marginBottom: 20 },
  confirmedTitle: { fontSize: 24, fontWeight: '800', color: '#fff', marginBottom: 10, textAlign: 'center' },
  confirmedBody: { fontSize: 14, color: GREY, textAlign: 'center', lineHeight: 20, marginBottom: 24 },
  confirmedAmountBox: { backgroundColor: BLACK, borderRadius: 14, padding: 18, alignItems: 'center', marginBottom: 28, borderWidth: 0.5, borderColor: '#333', minWidth: 160 },
  confirmedAmountLabel: { fontSize: 11, color: GREY, marginBottom: 4 },
  confirmedAmountValue: { fontSize: 28, fontWeight: '800', color: GREEN },
  doneBtn: { backgroundColor: GOLD, borderRadius: 14, paddingVertical: 16, paddingHorizontal: 32 },
  doneBtnText: { color: BLACK, fontSize: 16, fontWeight: '800' },
  skipLink: { marginTop: 16 },
  skipLinkText: { color: GREY, fontSize: 13 },
});
