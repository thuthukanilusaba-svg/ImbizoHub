// app/buyer-deliveries.tsx
// NEW FILE — closes a real gap found during a full-app review pass.
//
// profile.tsx's "My deliveries" link always pointed to
// seller-deliveries.tsx, which only shows bookings where the user is the
// SELLER (eq('seller_id', userId)). There was no screen anywhere for a
// BUYER to see a list of deliveries they're waiting to RECEIVE.
//
// CORRECTED after this file was first built: it originally also
// duplicated PIN generation inline — not realizing delivery-track.tsx
// already existed in the project and did that job, with real advantages
// (live 5-second polling for status changes, a real countdown timer on
// the PIN, driver rating, a full "how it works" walkthrough). It was
// simply never linked to from anywhere, which is why it went unnoticed.
// Rather than run two competing implementations, this screen's job is
// now just the LIST — the same relationship messages.tsx has to
// chat.tsx. Anything actively trackable links out to
// /delivery-track?booking_id=... for the real single-booking detail
// view and PIN generation.

import { useRouter } from 'expo-router';
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

const STEPS = [
  { key: 'accepted', label: 'Driver assigned' },
  { key: 'dispatched', label: 'In transit' },
  { key: 'delivered', label: 'Delivered' },
  { key: 'confirmed', label: 'Confirmed' },
];

function statusColor(status: string) {
  const map: Record<string, string> = {
    requested: '#888', accepted: '#4A90D9', dispatched: GOLD,
    delivered: GREEN, confirmed: GREEN,
  };
  return map[status] ?? '#888';
}

function statusLabel(status: string) {
  const map: Record<string, string> = {
    requested: 'Finding a driver', accepted: 'Driver on the way to collect',
    dispatched: 'In transit to you', delivered: 'Delivered — confirm receipt',
    confirmed: 'Completed',
  };
  return map[status] ?? status;
}

function itemTitleFor(booking: any): string | null {
  return booking.listings?.title || booking.item_requests?.title || null;
}

export default function BuyerDeliveriesScreen() {
  const router = useRouter();
  const [myId, setMyId] = useState('');
  const [bookings, setBookings] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => { init(); }, []);

  async function init() {
    setLoading(true);
    setError('');

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { router.replace('/login'); return; }
    setMyId(user.id);

    await loadBookings(user.id);
    setLoading(false);
  }

  async function loadBookings(userId: string) {
    const { data, error: fetchError } = await supabase
      .from('delivery_bookings')
      .select('*, listings(title, price), item_requests(title), delivery_operators(full_name, vehicle_type)')
      .eq('buyer_id', userId)
      .order('requested_at', { ascending: false });

    if (fetchError) { setError(fetchError.message); return; }
    setBookings(data ?? []);
  }

  function currentStepIndex(status: string) {
    return STEPS.findIndex((s) => s.key === status);
  }

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={GOLD} />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Text style={styles.backText}>← Back</Text>
        </TouchableOpacity>

        <Text style={styles.heading}>Deliveries to me</Text>
        <Text style={styles.subheading}>Items you've booked delivery for, on their way to you.</Text>

        {error ? (
          <View style={styles.errorBox}><Text style={styles.errorText}>⚠️ {error}</Text></View>
        ) : null}

        {bookings.length === 0 ? (
          <View style={styles.emptyBox}>
            <Text style={styles.emptyText}>No incoming deliveries yet.</Text>
            <Text style={styles.emptySubText}>When you book delivery for something you're buying, it'll show up here.</Text>
          </View>
        ) : (
          bookings.map((booking) => {
            const stepIdx = currentStepIndex(booking.status);
            const driver = booking.delivery_operators;
            const itemTitle = itemTitleFor(booking);
            const isTrackable = booking.status !== 'requested' && booking.status !== 'confirmed';
            const isConfirmed = booking.status === 'confirmed';

            return (
              <View key={booking.id} style={styles.card}>
                <View style={styles.cardHeader}>
                  <Text style={styles.route}>{booking.pickup_city} → {booking.dropoff_city}</Text>
                  <Text style={[styles.statusText, { color: statusColor(booking.status) }]}>
                    {statusLabel(booking.status)}
                  </Text>
                </View>

                {itemTitle && <Text style={styles.itemText}>Item: {itemTitle}</Text>}
                {driver && (
                  <Text style={styles.driverText}>
                    🚗 {driver.full_name} · {driver.vehicle_type || 'Vehicle not specified'}
                  </Text>
                )}

                <View style={styles.progressRow}>
                  {STEPS.map((step, i) => (
                    <View key={step.key} style={styles.progressStep}>
                      <View style={[styles.progressDot, i <= stepIdx && styles.progressDotDone]} />
                      {i < STEPS.length - 1 && (
                        <View style={[styles.progressLine, i < stepIdx && styles.progressLineDone]} />
                      )}
                    </View>
                  ))}
                </View>

                {/* FIX: this used to have its own inline PIN-generation UI
                    right here — duplicating delivery-track.tsx, a
                    screen that already existed in the project (found
                    after this file was first built) and does the same
                    job with real advantages this list format can't
                    easily match: live 5-second polling for status
                    changes, a real countdown timer on the PIN, driver
                    rating, and a full "how it works" walkthrough.
                    Rather than keep two competing implementations, this
                    list now links OUT to that richer single-booking
                    view for anything actively trackable — this screen's
                    job is just to be the list, same relationship
                    messages.tsx has to chat.tsx. */}
                {isTrackable && (
                  <TouchableOpacity
                    style={styles.trackBtn}
                    onPress={() => router.push(`/delivery-track?booking_id=${booking.id}`)}
                  >
                    <Text style={styles.trackBtnText}>
                      {booking.status === 'delivered' ? 'Confirm receipt →' : 'Track delivery →'}
                    </Text>
                  </TouchableOpacity>
                )}

                {isConfirmed && (
                  <View style={styles.confirmedBox}>
                    <Text style={styles.confirmedText}>✅ Delivery confirmed</Text>
                    {driver?.full_name && (
                      <TouchableOpacity
                        onPress={() => router.push(
                          `/rating?session_id=${booking.id}&reviewee_id=${booking.seller_id}&role=buyer&listing_id=${booking.listing_id ?? ''}`
                        )}
                      >
                        <Text style={styles.rateLink}>⭐ Rate this delivery</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                )}
              </View>
            );
          })
        )}

        <View style={{ height: 40 }} />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#111111' },
  content: { padding: 20, paddingTop: Platform.OS === 'ios' ? 56 : 40 },
  center: { flex: 1, backgroundColor: '#111', alignItems: 'center', justifyContent: 'center' },

  backBtn: { marginBottom: 16 },
  backText: { color: GREY, fontSize: 14 },
  heading: { fontSize: 24, fontWeight: '800', color: '#fff', marginBottom: 6 },
  subheading: { fontSize: 13, color: GREY, marginBottom: 24 },

  errorBox: { backgroundColor: '#3a1a1a', borderRadius: 10, padding: 12, marginBottom: 16 },
  errorText: { color: '#ff8a8a', fontSize: 13, textAlign: 'center' },

  emptyBox: { backgroundColor: BLACK, borderRadius: 14, padding: 28, alignItems: 'center', borderWidth: 0.5, borderColor: '#333' },
  emptyText: { color: '#fff', fontSize: 14, fontWeight: '600', marginBottom: 6 },
  emptySubText: { color: GREY, fontSize: 12, textAlign: 'center', lineHeight: 17 },

  card: { backgroundColor: BLACK, borderRadius: 14, padding: 16, marginBottom: 12, borderWidth: 0.5, borderColor: '#333' },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 },
  route: { color: '#fff', fontSize: 15, fontWeight: '700' },
  statusText: { fontSize: 11, fontWeight: '700' },
  itemText: { color: GREY, fontSize: 12, marginBottom: 4 },
  driverText: { color: GREY, fontSize: 12, marginBottom: 10 },

  progressRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 14, marginTop: 4 },
  progressStep: { flexDirection: 'row', alignItems: 'center', flex: 1 },
  progressDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: DARK, borderWidth: 1, borderColor: '#444' },
  progressDotDone: { backgroundColor: GREEN, borderColor: GREEN },
  progressLine: { flex: 1, height: 2, backgroundColor: '#333', marginHorizontal: 2 },
  progressLineDone: { backgroundColor: GREEN },

  trackBtn: { paddingTop: 10, borderTopWidth: 0.5, borderTopColor: '#333', alignItems: 'center', marginTop: 4 },
  trackBtnText: { color: GOLD, fontSize: 13, fontWeight: '700' },

  confirmedBox: { paddingTop: 10, borderTopWidth: 0.5, borderTopColor: '#333', alignItems: 'center' },
  confirmedText: { color: GREEN, fontSize: 13, fontWeight: '700', marginBottom: 8 },
  rateLink: { color: GOLD, fontSize: 13, fontWeight: '600' },
});
