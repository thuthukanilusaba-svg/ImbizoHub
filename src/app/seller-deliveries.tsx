// app/seller-deliveries.tsx
// Seller-facing screen: lists the seller's active/past delivery bookings.
// While a booking is 'accepted' (driver assigned, not yet dispatched), the
// seller can upload a photo of the parcel before handing it to the driver —
// same Supabase Storage approach as listing photos (post.tsx), reusing the
// 'listing-photos' bucket with a per-user folder path, saved to
// delivery_bookings.dispatch_photo_url.
//
// UPDATED: a booking can now originate from either a marketplace listing
// OR a matched Wanted-tab request (delivery-booking.tsx populates exactly
// one of listing_id / item_request_id). The query now joins both, and
// itemTitleFor() picks whichever is actually populated — everything else
// about this screen (progress tracker, dispatch photo upload) applies
// identically to either origin.

import * as ImagePicker from 'expo-image-picker';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator, Alert, Image, Platform, ScrollView, StyleSheet,
  Text, TouchableOpacity, View,
} from 'react-native';
import { normalizeImageOrientation } from '../../lib/imageOrientation';
import { supabase } from '../../lib/supabase';
import { prepareUpload } from '../../lib/uploadHelpers';

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
    // NEW: bookings now start life as 'requested' and can end up
    // 'declined' if the assigned driver turns the job down — see
    // confirm-payment.ts. Both are real, visible states now that
    // bookings aren't auto-accepted at payment time.
    requested: '#888',
    declined: '#ff8a8a',
    accepted: '#4A90D9',
    dispatched: GOLD,
    delivered: GREEN,
    confirmed: GREEN,
  };
  return map[status] ?? '#888';
}

function statusLabel(status: string) {
  const map: Record<string, string> = {
    requested: 'Waiting for driver to accept',
    declined: 'Driver declined — buyer is choosing another',
    accepted: 'Awaiting pickup',
    dispatched: 'In transit',
    delivered: 'Delivered — awaiting buyer PIN',
    confirmed: 'Completed',
  };
  return map[status] ?? status;
}

function itemTitleFor(booking: any): string | null {
  return booking.listings?.title || booking.item_requests?.title || null;
}

export default function SellerDeliveriesScreen() {
  const router = useRouter();
  const [myId, setMyId] = useState('');
  const [bookings, setBookings] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [uploadingId, setUploadingId] = useState<string | null>(null);
  const [uploadErrors, setUploadErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    init();
  }, []);

  async function init() {
    setLoading(true);
    setError('');

    const { data: { user } } = await supabase.auth.getUser();
    // FIX: was `if (!user)`, missing the same user.is_anonymous gap
    // found across the app (profile.tsx, buyer-deliveries.tsx, etc.) —
    // an anonymous session is truthy here, so it fell through to a
    // seller-deliveries query scoped to an anon id that can never have
    // any real deliveries, showing a silent empty list instead of
    // sending the person to create a real account. Redirect target and
    // check now match buyer-deliveries.tsx's established fix.
    if (!user || user.is_anonymous) { router.replace('/register'); return; }
    setMyId(user.id);

    await loadBookings(user.id);
    setLoading(false);
  }

  async function loadBookings(userId: string) {
    const { data, error: fetchError } = await supabase
      .from('delivery_bookings')
      .select('*, listings(title, price), item_requests(title), delivery_operators(full_name, vehicle_type)')
      .eq('seller_id', userId)
      .order('requested_at', { ascending: false });

    if (fetchError) { setError(fetchError.message); return; }
    setBookings(data ?? []);
  }

  async function uploadDispatchUri(bookingId: string, uri: string) {
    setUploadingId(bookingId);
    try {
      const { data: uploadData, contentType, extension } = await prepareUpload(uri);
      const fileName = `${myId}/dispatch-${bookingId}-${Date.now()}.${extension}`;

      const { error: uploadError } = await supabase.storage
        .from('listing-photos')
        .upload(fileName, uploadData, { contentType, upsert: false });

      if (uploadError) throw uploadError;

      const { data: urlData } = supabase.storage.from('listing-photos').getPublicUrl(fileName);

      const { error: updateError } = await supabase
        .from('delivery_bookings')
        .update({ dispatch_photo_url: urlData.publicUrl })
        .eq('id', bookingId)
        .eq('seller_id', myId);

      if (updateError) throw updateError;

      setBookings(prev => prev.map(b => b.id === bookingId ? { ...b, dispatch_photo_url: urlData.publicUrl } : b));
    } catch (err: any) {
      setUploadErrors(prev => ({ ...prev, [bookingId]: `Upload failed: ${err.message}` }));
    }
    setUploadingId(null);
  }

  async function uploadDispatchPhoto(bookingId: string) {
    setUploadErrors(prev => ({ ...prev, [bookingId]: '' }));

    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      setUploadErrors(prev => ({ ...prev, [bookingId]: 'Permission to access photos is required.' }));
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      quality: 0.7,
      exif: true,
    });

    if (result.canceled) return;
    const asset = result.assets[0];
    await uploadDispatchUri(bookingId, await normalizeImageOrientation(asset.uri, asset.exif));
  }

  async function takeDispatchPhoto(bookingId: string) {
    setUploadErrors(prev => ({ ...prev, [bookingId]: '' }));

    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) {
      setUploadErrors(prev => ({ ...prev, [bookingId]: 'Camera permission is required.' }));
      return;
    }

    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      quality: 0.7,
      exif: true,
    });

    if (result.canceled) return;
    const asset = result.assets[0];
    await uploadDispatchUri(bookingId, await normalizeImageOrientation(asset.uri, asset.exif));
  }

  function chooseDispatchPhotoSource(bookingId: string) {
    Alert.alert(
      'Add dispatch photo',
      undefined,
      [
        { text: 'Take Photo', onPress: () => takeDispatchPhoto(bookingId) },
        { text: 'Choose from Gallery', onPress: () => uploadDispatchPhoto(bookingId) },
        { text: 'Cancel', style: 'cancel' },
      ]
    );
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

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Text style={styles.backText}>← Back</Text>
        </TouchableOpacity>

        <Text style={styles.heading}>My deliveries</Text>
        <Text style={styles.subheading}>Deliveries booked against your listings and matched Wanted requests.</Text>

        {error ? (
          <View style={styles.errorBox}><Text style={styles.errorText}>⚠️ {error}</Text></View>
        ) : null}

        {bookings.length === 0 ? (
          <View style={styles.emptyBox}>
            <Text style={styles.emptyText}>No deliveries yet.</Text>
            <Text style={styles.emptySubText}>When a buyer books delivery — for one of your listings, or a Wanted request you matched — it'll show up here.</Text>
          </View>
        ) : (
          bookings.map((booking) => {
            const stepIdx = currentStepIndex(booking.status);
            const driver = booking.delivery_operators;
            const canUploadPhoto = booking.status === 'accepted';
            const isUploading = uploadingId === booking.id;
            const itemTitle = itemTitleFor(booking);

            return (
              <View key={booking.id} style={styles.card}>
                <View style={styles.cardHeader}>
                  <Text style={styles.route}>{booking.pickup_city} → {booking.dropoff_city}</Text>
                  <Text style={[styles.statusText, { color: statusColor(booking.status) }]}>
                    {statusLabel(booking.status)}
                  </Text>
                </View>

                {itemTitle && (
                  <Text style={styles.itemText}>Item: {itemTitle}</Text>
                )}

                {/* NEW: item-size badge — closes a real gap found in a
                    later review pass. dealer.tsx (the operator's job
                    list) and buyer-deliveries.tsx both got this badge
                    when the item-size pricing tier was added; this
                    screen — the SELLER's own view of the same
                    booking — never did. Relevant here specifically
                    because it's the seller who's about to hand the
                    parcel to a driver — knowing whether the driver is
                    expecting something car-sized or van-sized matters
                    before that handoff. */}
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

                {driver && (
                  <Text style={styles.driverText}>
                    🚗 {driver.full_name} · {driver.vehicle_type || 'Vehicle not specified'}
                  </Text>
                )}

                {/* Mini progress row */}
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

                {/* Dispatch photo section */}
                {booking.dispatch_photo_url ? (
                  <View style={styles.photoDoneBox}>
                    <Image source={{ uri: booking.dispatch_photo_url }} style={styles.photoThumb} />
                    <View style={{ flex: 1 }}>
                      <Text style={styles.photoDoneTitle}>✅ Dispatch photo uploaded</Text>
                      <Text style={styles.photoDoneSub}>The driver and buyer can see proof of the parcel's condition at handover.</Text>
                    </View>
                  </View>
                ) : canUploadPhoto ? (
                  <View style={styles.photoUploadBox}>
                    <Text style={styles.photoUploadLabel}>
                      Photograph the parcel before handing it to the driver
                    </Text>
                    <TouchableOpacity
                      style={[styles.photoUploadBtn, isUploading && { opacity: 0.6 }]}
                      onPress={() => chooseDispatchPhotoSource(booking.id)}
                      disabled={isUploading}
                    >
                      {isUploading
                        ? <ActivityIndicator color={BLACK} size="small" />
                        : <Text style={styles.photoUploadBtnText}>📷 Add dispatch photo</Text>
                      }
                    </TouchableOpacity>
                    {uploadErrors[booking.id] ? (
                      <Text style={styles.photoErrorText}>⚠️ {uploadErrors[booking.id]}</Text>
                    ) : null}
                  </View>
                ) : null}
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

  // NEW: item-size badge styles — matching dealer.tsx and
  // buyer-deliveries.tsx exactly, so the same visual language appears
  // on all three sides of a booking.
  sizeBadge: { alignSelf: 'flex-start', backgroundColor: '#1a2a1a', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 5, marginBottom: 8 },
  sizeBadgeLarge: { backgroundColor: '#3a2800', borderWidth: 1, borderColor: GOLD },
  sizeBadgeText: { color: '#4fc96e', fontSize: 11, fontWeight: '700' },
  sizeBadgeTextLarge: { color: GOLD },

  driverText: { color: GREY, fontSize: 12, marginBottom: 10 },

  progressRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 14, marginTop: 4 },
  progressStep: { flexDirection: 'row', alignItems: 'center', flex: 1 },
  progressDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: DARK, borderWidth: 1, borderColor: '#444' },
  progressDotDone: { backgroundColor: GREEN, borderColor: GREEN },
  progressLine: { flex: 1, height: 2, backgroundColor: '#333', marginHorizontal: 2 },
  progressLineDone: { backgroundColor: GREEN },

  photoUploadBox: { paddingTop: 10, borderTopWidth: 0.5, borderTopColor: '#333' },
  photoUploadLabel: { color: GREY, fontSize: 12, marginBottom: 10, lineHeight: 17 },
  photoUploadBtn: { backgroundColor: GOLD, borderRadius: 10, paddingVertical: 12, alignItems: 'center' },
  photoUploadBtnText: { color: BLACK, fontSize: 13, fontWeight: '800' },
  photoErrorText: { color: '#ff8a8a', fontSize: 11, marginTop: 8, textAlign: 'center' },

  photoDoneBox: { flexDirection: 'row', gap: 12, alignItems: 'center', paddingTop: 10, borderTopWidth: 0.5, borderTopColor: '#333' },
  photoThumb: { width: 56, height: 56, borderRadius: 10 },
  photoDoneTitle: { color: '#fff', fontSize: 12, fontWeight: '700', marginBottom: 3 },
  photoDoneSub: { color: GREY, fontSize: 11, lineHeight: 15 },
});
