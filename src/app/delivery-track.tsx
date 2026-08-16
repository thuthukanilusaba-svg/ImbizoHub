// app/delivery-track.tsx
// Buyer-facing delivery tracking screen.
// Shows status pipeline, driver info, and lets the buyer generate/reveal the
// PIN to give the driver at collection. Mirrors the buyer view in meetpay.tsx:
// same generatePin() logic, same 15-min expiry, same regenerate pattern —
// but reads/writes directly on the delivery_bookings row instead of a
// separate sessions table.
//
// Usage: router.push(`/delivery-track?booking_id=${bookingId}`)

import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator, Platform, ScrollView, StyleSheet,
  Text, TouchableOpacity, View,
} from 'react-native';
import { supabase } from '../../lib/supabase';

const GOLD = '#B8860B';
const BLACK = '#1A1A18';
const DARK = '#2a2a2a';
const GREY = '#AAAAAA';
const GREEN = '#4fc96e';

function generatePin(): string {
  return Math.floor(1000 + Math.random() * 9000).toString();
}

const STEPS = [
  { key: 'requested', label: 'Requested' },
  { key: 'accepted', label: 'Accepted' },
  { key: 'dispatched', label: 'In transit' },
  { key: 'delivered', label: 'Delivered' },
  { key: 'confirmed', label: 'Confirmed' },
];

export default function DeliveryTrackScreen() {
  const router = useRouter();
  const { booking_id } = useLocalSearchParams<{ booking_id: string }>();

  const [myId, setMyId] = useState('');
  const [booking, setBooking] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [secondsLeft, setSecondsLeft] = useState(0);
  const [generating, setGenerating] = useState(false);

  useEffect(() => {
    init();
  }, [booking_id]);

  useEffect(() => {
    const poll = setInterval(() => {
      if (booking?.id) loadBooking(booking.id, false);
    }, 5000);
    return () => clearInterval(poll);
  }, [booking?.id]);

  useEffect(() => {
    if (!booking?.pin_expires_at) { setSecondsLeft(0); return; }
    const tick = () => {
      const remaining = Math.max(0, Math.floor((new Date(booking.pin_expires_at).getTime() - Date.now()) / 1000));
      setSecondsLeft(remaining);
    };
    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [booking?.pin_expires_at]);

  async function init() {
    setLoading(true);
    setError('');

    const { data: { user } } = await supabase.auth.getUser();
    // FIX: was `if (!user)`, missing user.is_anonymous — same gap as
    // seller-deliveries.tsx and buyer-deliveries.tsx. An anonymous
    // session is truthy, so it fell through to a query scoped to an
    // anon buyer_id that can never match a real booking, landing on a
    // silent "No delivery found" error instead of being sent to
    // register. Redirect target now matches buyer-deliveries.tsx.
    if (!user || user.is_anonymous) { router.replace('/register'); return; }
    setMyId(user.id);

    if (booking_id) {
      await loadBooking(booking_id, true, user.id);
    } else {
      const { data, error: fetchError } = await supabase
        .from('delivery_bookings')
        .select('*, listings(title, price), item_requests(title), delivery_operators(full_name, vehicle_type, rating, rating_count)')
        .eq('buyer_id', user.id)
        .order('requested_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (fetchError) { setError(fetchError.message); setLoading(false); return; }
      if (!data) { setError('No delivery found.'); setLoading(false); return; }
      setBooking(data);
    }

    setLoading(false);
  }

  async function loadBooking(id: string, showLoading: boolean, buyerId?: string) {
    if (showLoading) setLoading(true);
    const { data, error: fetchError } = await supabase
      .from('delivery_bookings')
      .select('*, listings(title, price), item_requests(title), delivery_operators(full_name, vehicle_type, rating, rating_count)')
      .eq('id', id)
      .maybeSingle();

    if (fetchError) { setError(fetchError.message); setLoading(false); return; }
    if (!data) { setError('Delivery not found.'); setLoading(false); return; }

    // FIX (real security bug, found during a thorough review): this
    // had no ownership check at all when a booking_id came in via the
    // URL — any logged-in user who knew or guessed a booking_id could
    // load full delivery details for someone else's booking, including
    // driver info AND the actual PIN value (part of the `*` select
    // above). The PIN is meant to be the buyer's private handover
    // confirmation code; this screen's own header comment calls it
    // "Buyer-facing," but nothing actually enforced that. Using the
    // buyerId passed from init() (captured once, right after auth,
    // rather than re-fetching auth on every 5-second poll tick) to
    // reject anything that isn't genuinely this user's own booking.
    const effectiveBuyerId = buyerId ?? myId;
    if (effectiveBuyerId && data.buyer_id !== effectiveBuyerId) {
      setError('This delivery does not belong to your account.');
      setBooking(null);
      setLoading(false);
      return;
    }

    setBooking(data);
    if (showLoading) setLoading(false);
  }

  async function generateOrRegeneratePin() {
    if (!booking) return;
    setGenerating(true);
    setError('');

    // FIX (real bug, found during a full RLS/schema review): this used
    // to be a direct .update() guarded by .eq('buyer_id', myId) — real
    // protection, but only because this specific query included that
    // condition; nothing in the database itself required it. Now calls
    // generate_delivery_pin(), a SECURITY DEFINER RPC that generates the
    // PIN itself server-side (never trusting a client-supplied value)
    // and re-verifies ownership as a real database check.
    const { data, error: rpcError } = await supabase.rpc('generate_delivery_pin', {
      p_booking_id: booking.id,
    });

    if (rpcError) {
      setGenerating(false);
      setError(rpcError.message);
      return;
    }

    // The RPC returns only the bare delivery_bookings row, not the
    // joined listings/item_requests/delivery_operators fields this
    // screen also needs — merge rather than replace so those stay
    // intact (they don't change here anyway).
    setBooking((prev: any) => (prev ? { ...prev, ...data } : data));
    setGenerating(false);
  }

  function formatTime(s: number) {
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${m}:${sec.toString().padStart(2, '0')}`;
  }

  function currentStepIndex(status: string) {
    return STEPS.findIndex(s => s.key === status);
  }

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={GOLD} />
      </View>
    );
  }

  if (error && !booking) {
    return (
      <View style={styles.center}>
        <Text style={styles.errorText}>⚠️ {error}</Text>
        <TouchableOpacity style={styles.regenBtn} onPress={() => router.back()}>
          <Text style={styles.regenBtnText}>Go back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (!booking) return null;

  const stepIdx = currentStepIndex(booking.status);
  const driver = booking.delivery_operators;
  const isConfirmed = booking.status === 'confirmed';
  // NEW: a driver can now decline an assigned job instead of it being
  // auto-accepted (see decline_delivery_job). 'declined' also excluded
  // here since there's no PIN to show at all for a booking with no
  // driver actively working it.
  const isDeclined = booking.status === 'declined';
  const canShowPin = booking.status !== 'requested' && !isDeclined;
  const pinIsFresh = booking.pin && secondsLeft > 0;

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Text style={styles.backText}>← Back</Text>
        </TouchableOpacity>

        <Text style={styles.heading}>Track delivery</Text>
        {(booking.listings?.title || booking.item_requests?.title) ? (
          <Text style={styles.subheading}>{booking.listings?.title || booking.item_requests?.title} · {booking.pickup_city} → {booking.dropoff_city}</Text>
        ) : (
          <Text style={styles.subheading}>{booking.pickup_city} → {booking.dropoff_city}</Text>
        )}

        {/* NEW: item-size badge — closes a real gap found during a
            broader review pass. dealer.tsx, buyer-deliveries.tsx, and
            seller-deliveries.tsx all got this badge when the item-size
            pricing tier was added; this screen — the richest
            single-booking detail view, and the one a buyer actually
            uses to generate their PIN — was missed. Placed prominently
            near the top since this screen's whole purpose is tracking
            this specific delivery closely. */}
        {booking.parcel_size && (
          <View style={[
            styles.sizeBadge,
            booking.parcel_size === 'large' && styles.sizeBadgeLarge,
          ]}>
            <Text style={[
              styles.sizeBadgeText,
              booking.parcel_size === 'large' && styles.sizeBadgeTextLarge,
            ]}>
              {booking.parcel_size === 'large' ? '🚚 Large item' : '🚗 Small item'}
            </Text>
          </View>
        )}

        {error ? (
          <View style={styles.errorBox}><Text style={styles.errorText}>⚠️ {error}</Text></View>
        ) : null}

        {/* ── Declined state: no timeline/driver/PIN, just a clear CTA ── */}
        {isDeclined ? (
          <View style={styles.declinedBox}>
            <Text style={styles.declinedEmoji}>🚫</Text>
            <Text style={styles.declinedTitle}>Driver unavailable</Text>
            <Text style={styles.declinedBody}>
              Your driver couldn't take this delivery. Choose another driver to keep it moving — the $2 booking
              fee you already paid covers the new driver too.
            </Text>
            <TouchableOpacity
              style={styles.chooseAnotherBtn}
              onPress={() => router.push(`/delivery-booking?reassign_booking_id=${booking.id}`)}
            >
              <Text style={styles.chooseAnotherBtnText}>Choose another driver →</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <>
            {/* ── Status timeline ── */}
            <View style={styles.timelineCard}>
              {STEPS.map((step, i) => {
                const done = i <= stepIdx;
                const isLast = i === STEPS.length - 1;
                return (
                  <View key={step.key} style={styles.timelineRow}>
                    <View style={styles.timelineLeft}>
                      <View style={[styles.timelineDot, done && styles.timelineDotDone]}>
                        {done && <Text style={styles.timelineCheck}>✓</Text>}
                      </View>
                      {!isLast && <View style={[styles.timelineLine, i < stepIdx && styles.timelineLineDone]} />}
                    </View>
                    <Text style={[styles.timelineLabel, done && styles.timelineLabelDone]}>{step.label}</Text>
                  </View>
                );
              })}
            </View>

            {/* ── Driver info ── */}
            {driver && (
              <View style={styles.driverCard}>
                <View style={styles.driverAvatar}>
                  <Text style={styles.driverAvatarText}>{driver.full_name ? driver.full_name[0].toUpperCase() : '?'}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.driverName}>{driver.full_name}</Text>
                  <Text style={styles.driverVehicle}>🚗 {driver.vehicle_type || 'Vehicle not specified'}</Text>
                  {driver.rating_count > 0 && (
                    <Text style={styles.driverRating}>★ {driver.rating.toFixed(1)} ({driver.rating_count})</Text>
                  )}
                </View>
              </View>
            )}
          </>
        )}

        {/* ── PIN section ── */}
        {isDeclined ? null : isConfirmed ? (
          <View style={styles.confirmedBox}>
            <Text style={styles.confirmedEmoji}>✅</Text>
            <Text style={styles.confirmedTitle}>Delivery confirmed</Text>
            <Text style={styles.confirmedBody}>This delivery is complete. Thanks for using ImbizoHub safely.</Text>
            {/* FIX (real bug): this used to link to
                /rating?session_id=${booking.id}... — but session_id is
                meant to be a meetpay_sessions id, and submit_rating()
                only ever recognizes those, so this always failed with
                "Transaction not found" for a real delivery booking.
                Now routes through the delivery-specific
                submit_delivery_rating() RPC via source=delivery&
                booking_id=... — see rating.tsx's top-of-file comment. */}
            {booking.seller_id && (
              <TouchableOpacity
                style={styles.rateLinkBtn}
                onPress={() => router.push(
                  `/rating?source=delivery&booking_id=${booking.id}&target=seller&has_driver=${driver?.full_name ? '1' : '0'}&listing_id=${booking.listing_id ?? ''}`
                )}
              >
                <Text style={styles.rateLinkText}>⭐ Rate this delivery</Text>
              </TouchableOpacity>
            )}
          </View>
        ) : canShowPin ? (
          <>
            <View style={styles.pinCard}>
              <Text style={styles.pinLabel}>Your delivery PIN</Text>
              {pinIsFresh ? (
                <>
                  <Text style={styles.pinDisplay}>{booking.pin}</Text>
                  <Text style={[styles.pinTimer, secondsLeft < 60 && { color: '#ff8a8a' }]}>
                    Expires in {formatTime(secondsLeft)}
                  </Text>
                </>
              ) : (
                <Text style={styles.pinPlaceholder}>
                  {booking.pin ? 'Expired — generate a new one below' : 'Not generated yet'}
                </Text>
              )}
            </View>

            <TouchableOpacity
              style={[styles.regenBtn, generating && { opacity: 0.6 }]}
              onPress={generateOrRegeneratePin}
              disabled={generating}
            >
              {generating
                ? <ActivityIndicator color={GOLD} />
                : <Text style={styles.regenBtnText}>{booking.pin ? 'Generate new PIN' : 'Generate PIN'}</Text>
              }
            </TouchableOpacity>

            <View style={styles.instructionsBox}>
              <Text style={styles.instructionsTitle}>How it works</Text>
              <InstructionStep n="1" text="Wait for the driver to arrive with your item" />
              <InstructionStep n="2" text="Inspect the parcel before handing over any cash" />
              <InstructionStep n="3" text="Once you're satisfied, show the driver this 4-digit PIN" />
              <InstructionStep n="4" text="They'll enter it on their end to confirm the delivery is complete" />
            </View>
          </>
        ) : (
          <View style={styles.waitingBox}>
            <Text style={styles.waitingText}>Your PIN will be available here once the delivery is underway.</Text>
          </View>
        )}

        <View style={{ height: 40 }} />
      </ScrollView>
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
  container: { flex: 1, backgroundColor: '#111111' },
  content: { padding: 20, paddingTop: Platform.OS === 'ios' ? 56 : 40 },
  center: { flex: 1, backgroundColor: '#111', alignItems: 'center', justifyContent: 'center', padding: 32 },

  backBtn: { marginBottom: 16 },
  backText: { color: GREY, fontSize: 14 },
  heading: { fontSize: 24, fontWeight: '800', color: '#fff', marginBottom: 6 },
  subheading: { fontSize: 13, color: GREY, marginBottom: 24 },

  // NEW: item-size badge styles — matching dealer.tsx,
  // buyer-deliveries.tsx, and seller-deliveries.tsx exactly, so the
  // same visual language appears everywhere a booking is shown.
  sizeBadge: { alignSelf: 'flex-start', backgroundColor: '#1a2a1a', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 5, marginBottom: 16 },
  sizeBadgeLarge: { backgroundColor: '#3a2800', borderWidth: 1, borderColor: GOLD },
  sizeBadgeText: { color: '#4fc96e', fontSize: 11, fontWeight: '700' },
  sizeBadgeTextLarge: { color: GOLD },

  errorBox: { backgroundColor: '#3a1a1a', borderRadius: 10, padding: 12, marginBottom: 16 },
  errorText: { color: '#ff8a8a', fontSize: 13, textAlign: 'center' },

  timelineCard: { backgroundColor: BLACK, borderRadius: 14, padding: 18, marginBottom: 16, borderWidth: 0.5, borderColor: '#333' },
  timelineRow: { flexDirection: 'row', alignItems: 'flex-start' },
  timelineLeft: { alignItems: 'center', width: 24 },
  timelineDot: { width: 20, height: 20, borderRadius: 10, backgroundColor: DARK, borderWidth: 1, borderColor: '#444', alignItems: 'center', justifyContent: 'center' },
  timelineDotDone: { backgroundColor: GREEN, borderColor: GREEN },
  timelineCheck: { color: BLACK, fontSize: 11, fontWeight: '800' },
  timelineLine: { width: 2, flex: 1, minHeight: 18, backgroundColor: '#333', marginVertical: 2 },
  timelineLineDone: { backgroundColor: GREEN },
  timelineLabel: { color: GREY, fontSize: 13, marginLeft: 10, marginTop: 1, paddingBottom: 18 },
  timelineLabelDone: { color: '#fff', fontWeight: '700' },

  driverCard: { backgroundColor: DARK, borderRadius: 14, padding: 16, marginBottom: 16, flexDirection: 'row', alignItems: 'center', gap: 12, borderWidth: 0.5, borderColor: '#333' },
  driverAvatar: { width: 44, height: 44, backgroundColor: GOLD, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  driverAvatarText: { color: BLACK, fontSize: 18, fontWeight: '800' },
  driverName: { color: '#fff', fontSize: 14, fontWeight: '700' },
  driverVehicle: { color: GREY, fontSize: 12, marginTop: 3 },
  driverRating: { color: GOLD, fontSize: 11, marginTop: 3 },

  pinCard: { backgroundColor: BLACK, borderRadius: 18, padding: 28, alignItems: 'center', marginBottom: 16, borderWidth: 1, borderColor: GOLD },
  pinLabel: { fontSize: 12, color: GREY, marginBottom: 10, letterSpacing: 1 },
  pinDisplay: { fontSize: 56, fontWeight: '800', color: GOLD, letterSpacing: 12 },
  pinTimer: { fontSize: 12, color: GREY, marginTop: 12 },
  pinPlaceholder: { fontSize: 14, color: GREY, paddingVertical: 20 },

  regenBtn: { backgroundColor: DARK, borderRadius: 12, paddingVertical: 14, alignItems: 'center', marginBottom: 16, borderWidth: 0.5, borderColor: '#333' },
  regenBtnText: { color: GOLD, fontWeight: '700', fontSize: 14 },

  instructionsBox: { backgroundColor: BLACK, borderRadius: 14, padding: 18, borderWidth: 0.5, borderColor: '#333' },
  instructionsTitle: { fontSize: 13, fontWeight: '700', color: '#fff', marginBottom: 14 },
  stepRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, marginBottom: 12 },
  stepNum: { width: 22, height: 22, borderRadius: 11, backgroundColor: GOLD, alignItems: 'center', justifyContent: 'center' },
  stepNumText: { color: BLACK, fontSize: 11, fontWeight: '800' },
  stepText: { fontSize: 13, color: '#ccc', flex: 1, lineHeight: 18 },

  waitingBox: { backgroundColor: BLACK, borderRadius: 14, padding: 24, alignItems: 'center', borderWidth: 0.5, borderColor: '#333' },
  waitingText: { fontSize: 13, color: GREY, textAlign: 'center' },

  confirmedBox: { backgroundColor: BLACK, borderRadius: 14, padding: 28, alignItems: 'center', borderWidth: 0.5, borderColor: GREEN },
  confirmedEmoji: { fontSize: 48, marginBottom: 12 },
  confirmedTitle: { fontSize: 18, fontWeight: '800', color: '#fff', marginBottom: 8 },
  confirmedBody: { fontSize: 13, color: GREY, textAlign: 'center', lineHeight: 19 },
  rateLinkBtn: { marginTop: 16 },
  rateLinkText: { color: GOLD, fontSize: 14, fontWeight: '700' },

  declinedBox: { backgroundColor: BLACK, borderRadius: 14, padding: 28, alignItems: 'center', borderWidth: 0.5, borderColor: '#ff8a8a', marginBottom: 16 },
  declinedEmoji: { fontSize: 48, marginBottom: 12 },
  declinedTitle: { fontSize: 18, fontWeight: '800', color: '#fff', marginBottom: 8 },
  declinedBody: { fontSize: 13, color: GREY, textAlign: 'center', lineHeight: 19, marginBottom: 20 },
  chooseAnotherBtn: { backgroundColor: GOLD, borderRadius: 12, paddingVertical: 14, paddingHorizontal: 24 },
  chooseAnotherBtnText: { color: BLACK, fontSize: 14, fontWeight: '800' },
});
