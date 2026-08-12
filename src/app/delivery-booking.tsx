// app/delivery-booking.tsx
// Delivery booking screen — buyer requests delivery, available drivers avail themselves,
// seller chooses a driver.
//
// UPDATED (pricing decision): rates now depend on item size, not just
// distance — a phone and a window frame shouldn't cost the same to
// move. Two tiers:
//   Small (fits in a normal car): $8 local / $12 intercity
//   Large (needs a van or truck): $15 flat — intercity isn't offered
//     at all for large items; large-item delivery is local-only by
//     design, per product decision.
// $2 booking fee to ImbizoHub either way, unchanged.
//
// UPDATED: can now originate from either a marketplace listing (as
// before) OR a matched Wanted-tab request — chat.tsx's deal modal routes
// here with either listing_id+listing_price OR item_request_id, never
// both. confirmBooking() inserts whichever origin is present, leaving
// the other column null.
//
// UPDATED: confirmBooking() no longer inserts directly into
// delivery_bookings. The $2 ImbizoHub booking fee is a real Paynow
// charge — create-payment -> Paynow checkout -> poll payment_intents
// pattern unlock.tsx already uses. The actual delivery_bookings row is
// created server-side by paynow-webhook once payment is confirmed, not
// here. The driver fee itself is unchanged and stays cash-on-collection;
// only the $2 platform fee goes through Paynow.
//
// FIX (real, serious bug, found during a thorough review): this screen
// had NO account check at all — the mount-time auth fetch just did
// nothing if the user was null or anonymous, and confirmBooking() had
// no check of its own either. That meant a fully anonymous session
// could complete an actual $2 Paynow payment and create a real
// delivery_bookings row. This is worse than the "wrong check" version
// of this bug found on several other screens today, specifically
// because of what happens AFTER booking: the buyer needs
// delivery-track.tsx later to generate the PIN and confirm receipt. If
// an anonymous session is lost between booking and delivery (app
// reinstalled, data cleared — genuinely common for anonymous sessions),
// the buyer would be permanently locked out of ever confirming their
// own delivery, leaving real money and a real physical parcel stuck in
// limbo. Now checks on mount, before any details can even be filled
// in, matching post.tsx's reasoning for checking early rather than
// letting someone invest effort before finding out they can't proceed.
//
// FIX (secondary, found in the same pass): findDrivers() validated
// pickup/dropoff cities but never checked that a "Schedule for later"
// selection actually had a date picked — someone could toggle
// scheduled, never pick a date, and the booking would silently proceed
// as if it were ASAP with no warning at all.

import DateTimePicker from '@react-native-community/datetimepicker';
import { useLocalSearchParams, useRouter } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator, KeyboardAvoidingView, Modal, Platform, ScrollView, StyleSheet,
  Text, TextInput, TouchableOpacity, View,
} from 'react-native';
import { supabase } from '../../lib/supabase';

const GOLD = '#B8860B';
const BLACK = '#1A1A18';
const DARK = '#2a2a2a';
const GREY = '#AAAAAA';

const POLL_INTERVAL_MS = 2000;
const POLL_MAX_ATTEMPTS = 20;

const LARGE_VEHICLE_KEYWORDS = ['van', 'truck', 'bakkie', 'pickup', 'pick-up', 'lorry', 'minibus'];

function canCarryLargeItems(vehicleType: string | null | undefined): boolean {
  if (!vehicleType) return false;
  const lower = vehicleType.toLowerCase();
  return LARGE_VEHICLE_KEYWORDS.some((kw) => lower.includes(kw));
}

export default function DeliveryBookingScreen() {
  const router = useRouter();
  const { listing_id, seller_id, listing_price, item_request_id } = useLocalSearchParams<{
    listing_id?: string;
    seller_id: string;
    listing_price?: string;
    item_request_id?: string;
  }>();

  const isFromWantedMatch = !listing_id && !!item_request_id;

  const [checkingAuth, setCheckingAuth] = useState(true);
  const [myId, setMyId] = useState('');
  const [myEmail, setMyEmail] = useState('');
  const [pickupCity, setPickupCity] = useState('');
  const [dropoffCity, setDropoffCity] = useState('');
  const [parcelDescription, setParcelDescription] = useState('');
  const [parcelSize, setParcelSize] = useState<'small' | 'large'>('small');
  const [deliveryTiming, setDeliveryTiming] = useState<'asap' | 'scheduled'>('asap');
  const [scheduledDate, setScheduledDate] = useState('');
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [dateObj, setDateObj] = useState<Date>(new Date());

  function formatDateDisplay(iso: string): string {
    if (!iso) return '';
    const d = new Date(iso + 'T00:00:00');
    return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
  }

  function toIsoDate(d: Date): string {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  function handleDateChange(event: any, selected?: Date) {
    if (Platform.OS === 'android') {
      setShowDatePicker(false);
      if (event.type === 'set' && selected) {
        setDateObj(selected);
        setScheduledDate(toIsoDate(selected));
      }
    } else if (selected) {
      setDateObj(selected);
    }
  }
  const [availableDrivers, setAvailableDrivers] = useState<any[]>([]);
  const [selectedDriver, setSelectedDriver] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [driversLoading, setDriversLoading] = useState(false);
  const [booking, setBooking] = useState(false);
  const [bookingStage, setBookingStage] = useState<'idle' | 'starting' | 'awaiting_payment' | 'confirming'>('idle');
  const [booked, setBooked] = useState(false);
  const [error, setError] = useState('');
  const [step, setStep] = useState<'details' | 'choose-driver' | 'confirm'>('details');

  useEffect(() => { checkAuth(); }, []);

  async function checkAuth() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user || user.is_anonymous) {
      router.replace('/register');
      return;
    }
    setMyId(user.id);
    setMyEmail(user.email ?? '');
    setCheckingAuth(false);
  }

  const citiesDiffer = pickupCity.trim().toLowerCase() !== dropoffCity.trim().toLowerCase()
    && pickupCity.trim() !== '' && dropoffCity.trim() !== '';
  const isIntercity = parcelSize === 'small' && citiesDiffer;

  const deliveryFee = parcelSize === 'large' ? 15 : (isIntercity ? 12 : 8);
  const deliveryType = parcelSize === 'large' ? 'local' : (isIntercity ? 'intercity' : 'local');
  const BOOKING_FEE = 2;

  async function findDrivers() {
    if (!pickupCity.trim() || !dropoffCity.trim()) {
      setError('Please enter both pickup and dropoff cities.');
      return;
    }
    // FIX: see top-of-file comment — was possible to select "Schedule
    // for later" and proceed all the way to payment without ever
    // actually picking a date.
    if (deliveryTiming === 'scheduled' && !scheduledDate) {
      setError('Please select a date for your scheduled delivery.');
      return;
    }
    setError('');
    setDriversLoading(true);

    const { data, error: fetchError } = await supabase
      .from('delivery_operators')
      .select('*')
      .eq('status', 'active')
      .eq('registration_paid', true)
      .gt('registration_expires_at', new Date().toISOString())
      .order('verification_tier', { ascending: false })
      .order('rating', { ascending: false });

    setDriversLoading(false);

    if (fetchError) {
      setError(fetchError.message);
      return;
    }

    const filtered = parcelSize === 'large'
      ? (data ?? []).filter((d) => canCarryLargeItems(d.vehicle_type))
      : (data ?? []);

    setAvailableDrivers(filtered);
    setStep('choose-driver');
  }

  async function pollForPaid(reference: string): Promise<'paid' | 'failed' | 'timeout'> {
    for (let attempt = 0; attempt < POLL_MAX_ATTEMPTS; attempt++) {
      const { data } = await supabase
        .from('payment_intents')
        .select('status')
        .eq('our_reference', reference)
        .maybeSingle();

      if (data?.status === 'paid') return 'paid';
      if (data?.status === 'error' || data?.status === 'cancelled') return 'failed';

      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
    }
    return 'timeout';
  }

  async function confirmBooking() {
    if (!selectedDriver) return;
    setBooking(true);
    setError('');
    setBookingStage('starting');

    const { data: createResult, error: createError } = await supabase.functions.invoke('create-payment', {
      body: {
        kind: 'delivery_booking_fee',
        amount: BOOKING_FEE,
        email: myEmail || undefined,
        listing_id: isFromWantedMatch ? undefined : parseInt(listing_id!),
        item_request_id: isFromWantedMatch ? item_request_id : undefined,
        buyer_id: myId,
        seller_id: seller_id,
        operator_user_id: selectedDriver.id,
        pickup_city: pickupCity.trim(),
        dropoff_city: dropoffCity.trim(),
        delivery_type: deliveryType,
        delivery_fee: deliveryFee,
        parcel_size: parcelSize,
        parcel_description: parcelDescription.trim() || undefined,
        scheduled_date: scheduledDate || undefined,
      },
    });

    if (createError || createResult?.error || !createResult?.checkoutUrl) {
      setBooking(false);
      setBookingStage('idle');
      setError(createResult?.error || createError?.message || 'Could not start payment. Please try again.');
      return;
    }

    const { reference, checkoutUrl } = createResult;

    setBookingStage('awaiting_payment');

    await WebBrowser.openBrowserAsync(checkoutUrl);

    setBookingStage('confirming');
    const result = await pollForPaid(reference);

    setBooking(false);
    setBookingStage('idle');

    if (result === 'paid') {
      setBooked(true);
    } else if (result === 'failed') {
      setError('Your payment could not be completed. Please try again.');
    } else {
      setError("We haven't received confirmation of your payment yet. If you completed an EcoCash prompt on your phone, it can take a moment — try again in a few seconds, or check your Paynow confirmation email.");
    }
  }

  function verificationBadge(tier: string) {
    if (tier === 'trusted') return { label: 'Trusted ✓✓', color: GOLD };
    if (tier === 'id_verified') return { label: 'ID Verified ✓', color: '#4A90D9' };
    return { label: 'Unverified', color: '#888' };
  }

  function renderStars(rating: number) {
    const full = Math.round(rating);
    return '★'.repeat(full) + '☆'.repeat(5 - full);
  }

  function bookingButtonLabel() {
    if (bookingStage === 'starting') return 'Starting payment…';
    if (bookingStage === 'awaiting_payment') return 'Opening Paynow…';
    if (bookingStage === 'confirming') return 'Confirming payment…';
    return 'Confirm booking';
  }

  if (checkingAuth) {
    return (
      <View style={[styles.container, { alignItems: 'center', justifyContent: 'center' }]}>
        <ActivityIndicator size="large" color={GOLD} />
      </View>
    );
  }

  if (booked) {
    return (
      <View style={styles.container}>
        <View style={styles.successCard}>
          <Text style={{ fontSize: 64, marginBottom: 16 }}>📦</Text>
          <Text style={styles.successTitle}>Delivery booked!</Text>
          <Text style={styles.successBody}>
            {selectedDriver?.full_name} will collect the parcel from the seller.{'\n\n'}
            Pay them <Text style={{ color: GOLD, fontWeight: '800' }}>${deliveryFee} cash</Text> when they collect.{'\n'}
            The ${BOOKING_FEE} ImbizoHub booking fee has been paid.{'\n\n'}
            You'll receive a PIN to confirm receipt when the item is delivered.
          </Text>
          <TouchableOpacity style={styles.doneBtn} onPress={() => router.back()}>
            <Text style={styles.doneBtnText}>Back to chat</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <ScrollView contentContainerStyle={styles.content}>
        <TouchableOpacity onPress={() => step === 'details' ? router.back() : setStep('details')} style={styles.backBtn}>
          <Text style={styles.backText}>← {step === 'details' ? 'Back' : 'Change details'}</Text>
        </TouchableOpacity>

        <Text style={styles.heading}>Book delivery</Text>

        {step === 'details' && (
          <>
            <Text style={styles.subheading}>
              Enter pickup and dropoff cities. A registered driver will deliver the item.
              You pay the driver <Text style={{ color: GOLD }}>cash on collection</Text>.
            </Text>

            <Text style={styles.label}>Item size</Text>
            <View style={styles.sizeRow}>
              <TouchableOpacity
                style={[styles.sizeChip, parcelSize === 'small' && styles.sizeChipActive]}
                onPress={() => setParcelSize('small')}
              >
                <Text style={styles.sizeChipIcon}>🚗</Text>
                <Text style={[styles.sizeChipText, parcelSize === 'small' && styles.sizeChipTextActive]}>
                  Small — fits in a car
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.sizeChip, parcelSize === 'large' && styles.sizeChipActive]}
                onPress={() => setParcelSize('large')}
              >
                <Text style={styles.sizeChipIcon}>🚚</Text>
                <Text style={[styles.sizeChipText, parcelSize === 'large' && styles.sizeChipTextActive]}>
                  Large — needs a van/truck
                </Text>
              </TouchableOpacity>
            </View>

            <View style={styles.feeCard}>
              {parcelSize === 'small' ? (
                <>
                  <View style={styles.feeRow}>
                    <Text style={styles.feeLabel}>Within same city</Text>
                    <Text style={styles.feeValue}>$8 to driver + $2 booking fee</Text>
                  </View>
                  <View style={styles.feeDivider} />
                  <View style={styles.feeRow}>
                    <Text style={styles.feeLabel}>Different cities</Text>
                    <Text style={styles.feeValue}>$12 to driver + $2 booking fee</Text>
                  </View>
                </>
              ) : (
                <View style={styles.feeRow}>
                  <Text style={styles.feeLabel}>Large item (local only)</Text>
                  <Text style={styles.feeValue}>$15 to driver + $2 booking fee</Text>
                </View>
              )}
            </View>

            <Text style={styles.label}>Pickup city (their location)</Text>
            <TextInput
              style={styles.input}
              value={pickupCity}
              onChangeText={setPickupCity}
              placeholder="e.g. Harare"
              placeholderTextColor="#555"
            />

            <Text style={styles.label}>Dropoff city (your location)</Text>
            <TextInput
              style={styles.input}
              value={dropoffCity}
              onChangeText={setDropoffCity}
              placeholder="e.g. Bulawayo"
              placeholderTextColor="#555"
            />

            {parcelSize === 'large' && citiesDiffer && (
              <View style={styles.largeIntercityNote}>
                <Text style={styles.largeIntercityNoteText}>
                  ℹ️ Large-item delivery is local only. This booking will be treated as local pickup and dropoff.
                </Text>
              </View>
            )}

            {pickupCity.trim() !== '' && dropoffCity.trim() !== '' && (
              <View style={styles.deliveryTypeBadge}>
                <Text style={styles.deliveryTypeBadgeText}>
                  {parcelSize === 'large'
                    ? `🚚 Large item — $15`
                    : isIntercity
                      ? '🚌 Intercity delivery — $12'
                      : '🛵 Local delivery — $8'}
                </Text>
              </View>
            )}

            <Text style={styles.label}>Parcel description (optional)</Text>
            <TextInput
              style={[styles.input, { minHeight: 60, textAlignVertical: 'top' }]}
              value={parcelDescription}
              onChangeText={setParcelDescription}
              placeholder="e.g. Small phone box, fragile"
              placeholderTextColor="#555"
              multiline
            />

            <Text style={styles.label}>When do you need this delivered?</Text>
            <View style={styles.timingRow}>
              <TouchableOpacity
                style={[styles.timingChip, deliveryTiming === 'asap' && styles.timingChipActive]}
                onPress={() => setDeliveryTiming('asap')}
              >
                <Text style={[styles.timingChipText, deliveryTiming === 'asap' && styles.timingChipTextActive]}>
                  As soon as possible
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.timingChip, deliveryTiming === 'scheduled' && styles.timingChipActive]}
                onPress={() => setDeliveryTiming('scheduled')}
              >
                <Text style={[styles.timingChipText, deliveryTiming === 'scheduled' && styles.timingChipTextActive]}>
                  Schedule for later
                </Text>
              </TouchableOpacity>
            </View>

            {deliveryTiming === 'scheduled' && (
              <TouchableOpacity
                style={styles.dateField}
                onPress={() => {
                  setDateObj(scheduledDate ? new Date(scheduledDate + 'T00:00:00') : new Date());
                  setShowDatePicker(true);
                }}
              >
                <Text style={scheduledDate ? styles.dateFieldText : styles.dateFieldPlaceholder}>
                  {scheduledDate ? formatDateDisplay(scheduledDate) : 'Select date'}
                </Text>
                <Text style={styles.dateFieldIcon}>📅</Text>
              </TouchableOpacity>
            )}

            {showDatePicker && Platform.OS === 'android' && (
              <DateTimePicker
                value={dateObj}
                mode="date"
                display="calendar"
                minimumDate={new Date()}
                onChange={handleDateChange}
              />
            )}

            {Platform.OS === 'ios' && (
              <Modal visible={showDatePicker} transparent animationType="slide">
                <View style={styles.pickerModalOverlay}>
                  <View style={styles.pickerModalSheet}>
                    <DateTimePicker
                      value={dateObj}
                      mode="date"
                      display="inline"
                      minimumDate={new Date()}
                      onChange={handleDateChange}
                      themeVariant="dark"
                    />
                    <TouchableOpacity
                      style={styles.pickerDoneBtn}
                      onPress={() => {
                        setScheduledDate(toIsoDate(dateObj));
                        setShowDatePicker(false);
                      }}
                    >
                      <Text style={styles.pickerDoneBtnText}>Done</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              </Modal>
            )}

            {error ? <Text style={styles.errorText}>⚠️ {error}</Text> : null}

            <TouchableOpacity
              style={[styles.primaryBtn, driversLoading && { opacity: 0.6 }]}
              onPress={findDrivers}
              disabled={driversLoading}
            >
              {driversLoading
                ? <ActivityIndicator color={BLACK} />
                : <Text style={styles.primaryBtnText}>Find available drivers →</Text>
              }
            </TouchableOpacity>
          </>
        )}

        {step === 'choose-driver' && (
          <>
            <Text style={styles.subheading}>
              {availableDrivers.length > 0
                ? `${availableDrivers.length} driver${availableDrivers.length === 1 ? '' : 's'} available. Choose one to deliver your item.`
                : parcelSize === 'large'
                  ? 'No van/truck drivers available right now. Try again later or choose Meet & Collect instead.'
                  : 'No drivers available right now. Try again later or choose Meet & Collect instead.'}
            </Text>

            {parcelSize === 'large' && availableDrivers.length > 0 && (
              <View style={styles.largeIntercityNote}>
                <Text style={styles.largeIntercityNoteText}>
                  ℹ️ Showing only drivers with a van, truck, or similar vehicle — suitable for large items.
                </Text>
              </View>
            )}

            {availableDrivers.length === 0 && (
              <TouchableOpacity style={styles.primaryBtn} onPress={() => router.back()}>
                <Text style={styles.primaryBtnText}>← Back to chat</Text>
              </TouchableOpacity>
            )}

            {availableDrivers.map((driver) => {
              const badge = verificationBadge(driver.verification_tier);
              const isSelected = selectedDriver?.id === driver.id;
              return (
                <TouchableOpacity
                  key={driver.id}
                  style={[styles.driverCard, isSelected && styles.driverCardSelected]}
                  onPress={() => { setSelectedDriver(driver); setStep('confirm'); }}
                >
                  <View style={styles.driverAvatar}>
                    <Text style={styles.driverAvatarText}>
                      {driver.full_name ? driver.full_name[0].toUpperCase() : '?'}
                    </Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                      <Text style={styles.driverName}>{driver.full_name}</Text>
                      <Text style={[styles.driverBadge, { color: badge.color }]}>{badge.label}</Text>
                    </View>
                    <Text style={styles.driverVehicle}>🚗 {driver.vehicle_type || 'Vehicle not specified'}</Text>
                    {driver.rating_count > 0 && (
                      <Text style={styles.driverRating}>
                        {renderStars(driver.rating)} {driver.rating.toFixed(1)} ({driver.rating_count})
                      </Text>
                    )}
                  </View>
                  <Text style={{ color: GOLD, fontSize: 20 }}>›</Text>
                </TouchableOpacity>
              );
            })}
          </>
        )}

        {step === 'confirm' && selectedDriver && (
          <>
            <Text style={styles.subheading}>Confirm your delivery booking.</Text>

            <View style={styles.confirmCard}>
              <Text style={styles.confirmLabel}>Driver</Text>
              <Text style={styles.confirmValue}>{selectedDriver.full_name}</Text>

              <View style={styles.confirmDivider} />
              <Text style={styles.confirmLabel}>Vehicle</Text>
              <Text style={styles.confirmValue}>{selectedDriver.vehicle_type || 'Not specified'}</Text>

              <View style={styles.confirmDivider} />
              <Text style={styles.confirmLabel}>Route</Text>
              <Text style={styles.confirmValue}>{pickupCity} → {dropoffCity}</Text>

              <View style={styles.confirmDivider} />
              <Text style={styles.confirmLabel}>Item size</Text>
              <Text style={styles.confirmValue}>{parcelSize === 'large' ? 'Large (van/truck)' : 'Small (car)'}</Text>

              <View style={styles.confirmDivider} />
              <Text style={styles.confirmLabel}>Delivery type</Text>
              <Text style={styles.confirmValue}>{parcelSize === 'large' ? 'Local only' : (isIntercity ? 'Intercity' : 'Local')}</Text>

              <View style={styles.confirmDivider} />
              <Text style={styles.confirmLabel}>Pay driver (cash on collection)</Text>
              <Text style={[styles.confirmValue, { color: GOLD, fontSize: 20, fontWeight: '800' }]}>${deliveryFee}</Text>

              <View style={styles.confirmDivider} />
              <Text style={styles.confirmLabel}>ImbizoHub booking fee</Text>
              <Text style={styles.confirmValue}>${BOOKING_FEE} — pay now via Paynow</Text>
            </View>

            <View style={styles.cashNote}>
              <Text style={styles.cashNoteText}>
                💵 Pay the driver <Text style={{ color: GOLD, fontWeight: '700' }}>${deliveryFee} in cash</Text> when
                they collect the parcel from the seller. Do not pay until they have the item in hand.
              </Text>
            </View>

            {error ? <Text style={styles.errorText}>⚠️ {error}</Text> : null}

            <TouchableOpacity
              style={[styles.primaryBtn, booking && { opacity: 0.6 }]}
              onPress={confirmBooking}
              disabled={booking}
            >
              {booking
                ? <ActivityIndicator color={BLACK} />
                : <Text style={styles.primaryBtnText}>{bookingButtonLabel()}</Text>
              }
            </TouchableOpacity>

            <TouchableOpacity style={styles.secondaryBtn} onPress={() => setStep('choose-driver')} disabled={booking}>
              <Text style={styles.secondaryBtnText}>Choose a different driver</Text>
            </TouchableOpacity>
          </>
        )}

        <View style={{ height: 40 }} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#111111' },
  content: { padding: 20, paddingTop: Platform.OS === 'ios' ? 56 : 40 },

  backBtn: { marginBottom: 8 },
  backText: { color: GREY, fontSize: 13 },
  heading: { fontSize: 24, fontWeight: '800', color: '#fff', marginBottom: 8 },
  subheading: { fontSize: 13, color: GREY, lineHeight: 19, marginBottom: 20 },

  sizeRow: { flexDirection: 'row', gap: 8, marginBottom: 16 },
  sizeChip: {
    flex: 1, backgroundColor: DARK, borderRadius: 12, paddingVertical: 14, paddingHorizontal: 8,
    alignItems: 'center', borderWidth: 1, borderColor: '#333',
  },
  sizeChipActive: { borderColor: GOLD, backgroundColor: '#2a2200' },
  sizeChipIcon: { fontSize: 22, marginBottom: 6 },
  sizeChipText: { color: '#ccc', fontSize: 12, fontWeight: '600', textAlign: 'center' },
  sizeChipTextActive: { color: GOLD, fontWeight: '700' },

  largeIntercityNote: { backgroundColor: '#1a1a2e', borderRadius: 8, padding: 10, marginTop: 8, borderWidth: 0.5, borderColor: '#3a3a5e' },
  largeIntercityNoteText: { color: '#8888ff', fontSize: 11, lineHeight: 16 },

  feeCard: { backgroundColor: BLACK, borderRadius: 12, padding: 14, marginBottom: 20, borderWidth: 0.5, borderColor: '#333' },
  feeRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 6 },
  feeLabel: { fontSize: 12, color: GREY },
  feeValue: { fontSize: 12, color: '#fff', fontWeight: '600' },
  feeDivider: { height: 0.5, backgroundColor: '#2a2a2a', marginVertical: 4 },

  label: { fontSize: 12, fontWeight: '600', color: GREY, marginBottom: 6, marginTop: 14 },
  input: { backgroundColor: DARK, borderRadius: 10, padding: 12, color: '#fff', fontSize: 13, borderWidth: 0.5, borderColor: '#333' },
  timingRow: { flexDirection: 'row', gap: 8, marginBottom: 12 },
  timingChip: { flex: 1, backgroundColor: DARK, borderRadius: 10, paddingVertical: 12, alignItems: 'center', borderWidth: 0.5, borderColor: '#333' },
  timingChipActive: { borderColor: GOLD, borderWidth: 1 },
  timingChipText: { color: '#ccc', fontSize: 12, fontWeight: '600' },
  timingChipTextActive: { color: GOLD, fontWeight: '700' },
  dateField: {
    backgroundColor: DARK, borderRadius: 10, paddingHorizontal: 14,
    paddingVertical: Platform.OS === 'ios' ? 13 : 12,
    borderWidth: 0.5, borderColor: '#333', marginBottom: 12,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
  },
  dateFieldText: { fontSize: 14, color: '#fff' },
  dateFieldPlaceholder: { fontSize: 14, color: '#666' },
  dateFieldIcon: { fontSize: 16 },
  pickerModalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
  pickerModalSheet: { backgroundColor: DARK, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 16, paddingBottom: 32 },
  pickerDoneBtn: { backgroundColor: GOLD, borderRadius: 12, paddingVertical: 14, alignItems: 'center', marginTop: 12 },
  pickerDoneBtnText: { color: BLACK, fontSize: 14, fontWeight: '700' },

  deliveryTypeBadge: { backgroundColor: '#1a2a1a', borderRadius: 8, padding: 10, marginTop: 10, alignItems: 'center' },
  deliveryTypeBadgeText: { color: '#4fc96e', fontSize: 13, fontWeight: '700' },

  errorText: { color: '#ff8a8a', fontSize: 13, marginTop: 10, textAlign: 'center' },

  primaryBtn: { backgroundColor: GOLD, borderRadius: 14, paddingVertical: 16, alignItems: 'center', marginTop: 20 },
  primaryBtnText: { color: BLACK, fontSize: 15, fontWeight: '800' },
  secondaryBtn: { borderRadius: 14, paddingVertical: 14, alignItems: 'center', marginTop: 10, borderWidth: 1, borderColor: '#333' },
  secondaryBtnText: { color: GREY, fontSize: 13 },

  driverCard: { backgroundColor: DARK, borderRadius: 14, padding: 16, marginBottom: 10, flexDirection: 'row', alignItems: 'center', gap: 12, borderWidth: 0.5, borderColor: '#333' },
  driverCardSelected: { borderColor: GOLD },
  driverAvatar: { width: 44, height: 44, backgroundColor: GOLD, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  driverAvatarText: { color: BLACK, fontSize: 18, fontWeight: '800' },
  driverName: { color: '#fff', fontSize: 14, fontWeight: '700' },
  driverBadge: { fontSize: 10, fontWeight: '700' },
  driverVehicle: { color: GREY, fontSize: 12, marginTop: 3 },
  driverRating: { color: GOLD, fontSize: 11, marginTop: 3 },

  confirmCard: { backgroundColor: BLACK, borderRadius: 14, padding: 18, marginBottom: 16, borderWidth: 0.5, borderColor: '#333' },
  confirmLabel: { fontSize: 11, color: GREY, marginBottom: 2 },
  confirmValue: { fontSize: 14, color: '#fff', fontWeight: '600' },
  confirmDivider: { height: 0.5, backgroundColor: '#2a2a2a', marginVertical: 10 },

  cashNote: { backgroundColor: '#1a1a00', borderRadius: 10, padding: 14, marginBottom: 4, borderWidth: 0.5, borderColor: '#3a3a00' },
  cashNoteText: { color: '#cccc88', fontSize: 12, lineHeight: 18 },

  successCard: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 30 },
  successTitle: { fontSize: 22, fontWeight: '800', color: '#fff', marginBottom: 12, textAlign: 'center' },
  successBody: { fontSize: 13, color: GREY, textAlign: 'center', lineHeight: 21, marginBottom: 32 },
  doneBtn: { backgroundColor: GOLD, borderRadius: 14, paddingVertical: 16, paddingHorizontal: 40, alignItems: 'center' },
  doneBtnText: { color: BLACK, fontSize: 15, fontWeight: '800' },
});
