// app/meetpay.tsx
// Meet & Pay PIN confirmation system
// Buyer generates a 4-digit PIN → shows it to seller in person → seller enters it to confirm
// Works for both marketplace listings and Van Hire trips
//
// Usage: router.push(`/meetpay?type=listing&reference_id=${listingId}&seller_id=${sellerId}&amount=${price}`)
//     or router.push(`/meetpay?type=van_hire&reference_id=${quoteId}&seller_id=${operatorId}&amount=${balance}`)

import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator, Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { supabase } from '../../lib/supabase';

const GOLD = '#B8860B';
const BLACK = '#1A1A18';
const DARK = '#2a2a2a';
const GREY = '#AAAAAA';
const GREEN = '#4CAF50';

function generatePin(): string {
  return Math.floor(1000 + Math.random() * 9000).toString();
}

// FIX: same bug already found and fixed in chat.tsx — Postgres's
// default text rendering for timestamptz is "2026-07-29 19:59:01.885+00"
// (a space instead of 'T', a 2-digit offset instead of "+00:00").
// JavaScript's native Date constructor is only guaranteed to parse
// strict ISO 8601; this variant is technically non-standard and gets
// parsed inconsistently across engines — sometimes silently returning
// an Invalid Date (NaN), which makes every remaining-time comparison
// false and shows "Expired" regardless of the real time. This never
// surfaced here specifically because van-hire has never been tested
// through to an actual Meet & Pay confirmation yet — fixing it now
// before it does.
function parsePgTimestamp(value: string): number {
  const normalized = value
    .replace(' ', 'T')
    .replace(/([+-]\d{2})$/, '$1:00');
  return new Date(normalized).getTime();
}

export default function MeetPayScreen() {
  const router = useRouter();
  const { type, reference_id, seller_id, amount } = useLocalSearchParams<{
    type: string; reference_id: string; seller_id: string; amount?: string;
  }>();

  const [myId, setMyId] = useState('');
  const [role, setRole] = useState<'buyer' | 'seller' | null>(null);
  const [session, setSession] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [enteredPin, setEnteredPin] = useState('');
  const [error, setError] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState(0);

  useEffect(() => { init(); }, []);

  useEffect(() => {
    if (!session?.pin_expires_at || session.status !== 'pending') return;
    const interval = setInterval(() => {
      const remaining = Math.max(0, Math.floor((parsePgTimestamp(session.pin_expires_at) - Date.now()) / 1000));
      setSecondsLeft(remaining);
      if (remaining === 0) clearInterval(interval);
    }, 1000);
    return () => clearInterval(interval);
  }, [session]);

  async function init() {
    setLoading(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { router.replace('/login'); return; }
    setMyId(user.id);

    const isSeller = user.id === seller_id;
    setRole(isSeller ? 'seller' : 'buyer');

    // Check if a session already exists for this reference
    const { data: existing } = await supabase
      .from('meetpay_sessions')
      .select('*')
      .eq('reference_id', reference_id)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (existing && existing.status === 'pending') {
      setSession(existing);
    } else if (existing && existing.status === 'confirmed') {
      setSession(existing);
      setConfirmed(true);
    } else if (!isSeller) {
      // Buyer creates a new session
      await createSession(user.id);
    }

    setLoading(false);
  }

  async function createSession(buyerId: string) {
    const pin = generatePin();
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15 min expiry

    const { data, error: createError } = await supabase
      .from('meetpay_sessions')
      .insert({
        type: type || 'listing',
        reference_id,
        buyer_id: buyerId,
        seller_id,
        pin,
        pin_expires_at: expiresAt.toISOString(),
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

  async function regeneratePin() {
    if (!session) return;
    const pin = generatePin();
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000);

    const { data, error: updateError } = await supabase
      .from('meetpay_sessions')
      .update({ pin, pin_generated_at: new Date().toISOString(), pin_expires_at: expiresAt.toISOString() })
      .eq('id', session.id)
      .select()
      .single();

    if (updateError) { setError(updateError.message); return; }
    setSession(data);
  }

  async function handleConfirm() {
    setError('');
    if (enteredPin.length !== 4) {
      setError('Enter the 4-digit PIN.');
      return;
    }
    if (!session) {
      setError('No active session found.');
      return;
    }
    if (secondsLeft === 0) {
      setError('This PIN has expired. Ask the buyer to refresh and generate a new one.');
      return;
    }
    if (enteredPin !== session.pin) {
      setError('Incorrect PIN. Please check with the buyer and try again.');
      return;
    }

    setConfirming(true);
    const { error: updateError } = await supabase
      .from('meetpay_sessions')
      .update({
        status: 'confirmed',
        confirmed_at: new Date().toISOString(),
        confirmed_by: myId,
      })
      .eq('id', session.id);

    setConfirming(false);
    if (updateError) { setError(updateError.message); return; }
    setConfirmed(true);
  }

  function formatTime(s: number) {
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${m}:${sec.toString().padStart(2, '0')}`;
  }

  if (loading || !role) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={GOLD} />
      </View>
    );
  }

  // ── Confirmed screen (both roles) ──
  if (confirmed) {
    return (
      <View style={styles.confirmedScreen}>
        <Text style={styles.confirmedEmoji}>✅</Text>
        <Text style={styles.confirmedTitle}>Transaction confirmed!</Text>
        <Text style={styles.confirmedBody}>
          {role === 'buyer'
            ? 'The seller has confirmed receipt. Thank you for using ImbizoHub safely.'
            : 'You have confirmed this transaction with the buyer.'}
        </Text>
        {session?.amount ? (
          <View style={styles.confirmedAmountBox}>
            <Text style={styles.confirmedAmountLabel}>Amount</Text>
            <Text style={styles.confirmedAmountValue}>${session.amount}</Text>
          </View>
        ) : null}
        <TouchableOpacity style={styles.doneBtn} onPress={() => router.replace('/')}>
          <Text style={styles.doneBtnText}>Back to home</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // ── Buyer view: show PIN to seller ──
  if (role === 'buyer') {
    return (
      <View style={styles.container}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Text style={styles.backText}>← Back</Text>
        </TouchableOpacity>

        <Text style={styles.heading}>Meet & Pay</Text>
        <Text style={styles.subheading}>
          Show this PIN to the seller once you've inspected the item and you're ready to complete the deal.
        </Text>

        {error ? (
          <View style={styles.errorBox}><Text style={styles.errorText}>⚠️ {error}</Text></View>
        ) : null}

        {session && (
          <>
            <View style={styles.pinCard}>
              <Text style={styles.pinLabel}>Your PIN</Text>
              <Text style={styles.pinDisplay}>{session.pin}</Text>
              <Text style={[styles.pinTimer, secondsLeft < 60 && { color: '#ff8a8a' }]}>
                {secondsLeft > 0 ? `Expires in ${formatTime(secondsLeft)}` : 'Expired'}
              </Text>
            </View>

            {secondsLeft === 0 && (
              <TouchableOpacity style={styles.regenBtn} onPress={regeneratePin}>
                <Text style={styles.regenBtnText}>Generate new PIN</Text>
              </TouchableOpacity>
            )}

            <View style={styles.instructionsBox}>
              <Text style={styles.instructionsTitle}>How it works</Text>
              <InstructionStep n="1" text="Meet the seller and inspect the item or confirm the trip is complete" />
              <InstructionStep n="2" text="Once you're satisfied, show them this 4-digit PIN" />
              <InstructionStep n="3" text="They enter it on their phone to confirm the deal is done" />
              <InstructionStep n="4" text="Never share this PIN before you've inspected the item" />
            </View>
          </>
        )}
      </View>
    );
  }

  // ── Seller view: enter PIN ──
  return (
    <View style={styles.container}>
      <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
        <Text style={styles.backText}>← Back</Text>
      </TouchableOpacity>

      <Text style={styles.heading}>Meet & Pay</Text>
      <Text style={styles.subheading}>
        Ask the buyer for their 4-digit PIN to confirm this transaction is complete.
      </Text>

      {error ? (
        <View style={styles.errorBox}><Text style={styles.errorText}>⚠️ {error}</Text></View>
      ) : null}

      {!session ? (
        <View style={styles.waitingBox}>
          <ActivityIndicator color={GOLD} style={{ marginBottom: 12 }} />
          <Text style={styles.waitingText}>Waiting for buyer to generate a PIN...</Text>
        </View>
      ) : (
        <>
          <View style={styles.enterPinCard}>
            <Text style={styles.label}>Enter buyer's PIN</Text>
            <TextInput
              style={styles.pinInput}
              value={enteredPin}
              onChangeText={(t) => setEnteredPin(t.replace(/[^0-9]/g, '').slice(0, 4))}
              placeholder="0000"
              placeholderTextColor="#555"
              keyboardType="number-pad"
              maxLength={4}
            />
            {session.amount ? (
              <Text style={styles.amountHint}>Transaction amount: ${session.amount}</Text>
            ) : null}
          </View>

          <TouchableOpacity
            style={[styles.confirmBtn, (confirming || enteredPin.length !== 4) && { opacity: 0.5 }]}
            onPress={handleConfirm}
            disabled={confirming || enteredPin.length !== 4}
          >
            {confirming ? <ActivityIndicator color={BLACK} /> : <Text style={styles.confirmBtnText}>Confirm transaction</Text>}
          </TouchableOpacity>

          <View style={styles.instructionsBox}>
            <Text style={styles.instructionsTitle}>Important</Text>
            <Text style={styles.instructionsNote}>
              Only enter this PIN once you've handed over the item or completed the trip and the buyer has confirmed they're satisfied. This action cannot be undone.
            </Text>
          </View>
        </>
      )}
    </View>
  );
}

function InstructionStep({ n, text }: { n: string; text: string }) {
  return (
    <View style={styles.stepRow}>
      <View style={styles.stepNum}><Text style={styles.stepNumText}>{n}</Text></View>
      <Text style={styles.stepText}>{text}</Text>
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

  pinCard: { backgroundColor: BLACK, borderRadius: 18, padding: 28, alignItems: 'center', marginBottom: 16, borderWidth: 1, borderColor: GOLD },
  pinLabel: { fontSize: 12, color: GREY, marginBottom: 10, letterSpacing: 1 },
  pinDisplay: { fontSize: 56, fontWeight: '800', color: GOLD, letterSpacing: 12 },
  pinTimer: { fontSize: 12, color: GREY, marginTop: 12 },

  regenBtn: { backgroundColor: DARK, borderRadius: 12, paddingVertical: 14, alignItems: 'center', marginBottom: 16 },
  regenBtnText: { color: GOLD, fontWeight: '700', fontSize: 14 },

  instructionsBox: { backgroundColor: BLACK, borderRadius: 14, padding: 18, borderWidth: 0.5, borderColor: '#333' },
  instructionsTitle: { fontSize: 13, fontWeight: '700', color: '#fff', marginBottom: 14 },
  instructionsNote: { fontSize: 13, color: GREY, lineHeight: 20 },
  stepRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, marginBottom: 12 },
  stepNum: { width: 22, height: 22, borderRadius: 11, backgroundColor: GOLD, alignItems: 'center', justifyContent: 'center' },
  stepNumText: { color: BLACK, fontSize: 11, fontWeight: '800' },
  stepText: { fontSize: 13, color: '#ccc', flex: 1, lineHeight: 18 },

  waitingBox: { backgroundColor: BLACK, borderRadius: 14, padding: 32, alignItems: 'center', borderWidth: 0.5, borderColor: '#333' },
  waitingText: { fontSize: 13, color: GREY, textAlign: 'center' },

  enterPinCard: { backgroundColor: BLACK, borderRadius: 18, padding: 24, marginBottom: 16, borderWidth: 0.5, borderColor: '#333' },
  label: { fontSize: 13, fontWeight: '600', color: '#fff', marginBottom: 12 },
  pinInput: {
    backgroundColor: DARK, borderRadius: 12, fontSize: 36, fontWeight: '800',
    color: '#fff', textAlign: 'center', letterSpacing: 16, paddingVertical: 18,
    borderWidth: 1, borderColor: '#444',
  },
  amountHint: { fontSize: 12, color: GREY, textAlign: 'center', marginTop: 14 },

  confirmBtn: { backgroundColor: GOLD, borderRadius: 14, paddingVertical: 16, alignItems: 'center', marginBottom: 20 },
  confirmBtnText: { color: BLACK, fontSize: 16, fontWeight: '800' },

  // Confirmed screen
  confirmedScreen: { flex: 1, backgroundColor: '#111', alignItems: 'center', justifyContent: 'center', padding: 32 },
  confirmedEmoji: { fontSize: 64, marginBottom: 20 },
  confirmedTitle: { fontSize: 24, fontWeight: '800', color: '#fff', marginBottom: 10, textAlign: 'center' },
  confirmedBody: { fontSize: 14, color: GREY, textAlign: 'center', lineHeight: 20, marginBottom: 24 },
  confirmedAmountBox: { backgroundColor: BLACK, borderRadius: 14, padding: 18, alignItems: 'center', marginBottom: 28, borderWidth: 0.5, borderColor: '#333', minWidth: 160 },
  confirmedAmountLabel: { fontSize: 11, color: GREY, marginBottom: 4 },
  confirmedAmountValue: { fontSize: 28, fontWeight: '800', color: GREEN },
  doneBtn: { backgroundColor: GOLD, borderRadius: 14, paddingVertical: 16, paddingHorizontal: 48 },
  doneBtnText: { color: BLACK, fontSize: 16, fontWeight: '800' },
});
