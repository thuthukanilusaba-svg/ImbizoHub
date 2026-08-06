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
// Usage: router.push(`/meetpay?type=van_hire&reference_id=${quoteId}&seller_id=${operatorId}&amount=${balance}`)

import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator, Platform,
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

  useEffect(() => { init(); }, []);

  async function init() {
    setLoading(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { router.replace('/login'); return; }
    setMyId(user.id);

    const isSeller = user.id === seller_id;
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
    } else {
      // NEW: either side can be the first to reach this screen now —
      // no more "only the buyer creates it" restriction, since there's
      // no PIN to generate that specifically needs a buyer-first order.
      await createSession(user.id, isSeller);
    }

    setLoading(false);
  }

  async function createSession(userId: string, isSeller: boolean) {
    const { data, error: createError } = await supabase
      .from('meetpay_sessions')
      .insert({
        type: type || 'van_hire',
        reference_id,
        buyer_id: isSeller ? null : userId,
        seller_id: isSeller ? userId : seller_id,
        amount: amount ? parseFloat(amount) : null,
        status: 'pending',
      })
      .select()
      .single();

    if (createError) {
      setError(createError.message);
      return;
    }
    setSession(data);
  }

  // NEW: replaces the old PIN entry/check entirely. Sets MY OWN
  // confirmation timestamp only — the database, not this client,
  // decides when both sides have confirmed (avoids a race condition
  // where two clients both think they're "the second confirmer" at
  // the same moment).
  async function handleConfirmMyself() {
    if (!session) return;
    setError('');
    setConfirming(true);

    const myColumn = role === 'buyer' ? 'buyer_confirmed_at' : 'operator_confirmed_at';
    const now = new Date().toISOString();

    const { data, error: updateError } = await supabase
      .from('meetpay_sessions')
      .update({ [myColumn]: now })
      .eq('id', session.id)
      .select()
      .single();

    if (updateError) {
      setConfirming(false);
      setError(updateError.message);
      return;
    }

    // Both sides confirmed — flip status now. Each client only ever
    // writes its OWN column, so if both tap at nearly the same moment,
    // whichever request completes second correctly sees both
    // timestamps already set and performs this final update — no race.
    if (data.buyer_confirmed_at && data.operator_confirmed_at && data.status !== 'confirmed') {
      const { data: finalData, error: confirmError } = await supabase
        .from('meetpay_sessions')
        .update({ status: 'confirmed', confirmed_at: new Date().toISOString(), confirmed_by: myId })
        .eq('id', session.id)
        .select()
        .single();

      if (!confirmError && finalData) {
        setSession(finalData);
      } else {
        setSession(data);
      }
    } else {
      setSession(data);
    }

    setConfirming(false);
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

  // ── Fully confirmed screen (both roles) ──
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

  // ── I've confirmed, waiting on the other person ──
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

  // ── Not yet confirmed by me — the main action screen ──
  return (
    <View style={styles.container}>
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
    </View>
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

  // Confirmed screen
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
