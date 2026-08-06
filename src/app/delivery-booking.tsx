// app/delivery-booking.tsx
// Delivery booking screen — buyer requests delivery, available drivers avail themselves,
// seller chooses a driver. Fixed rates: $5 local, $10 intercity. $2 booking fee to ImbizoHub.
//
// UPDATED: can now originate from either a marketplace listing (as
// before) OR a matched Wanted-tab request — chat.tsx's deal modal routes
// here with either listing_id+listing_price OR item_request_id, never
// both. confirmBooking() inserts whichever origin is present, leaving
// the other column null — matches delivery_bookings' new mutually-
// exclusive-origin CHECK constraint (see wanted-delivery-migration.sql).
// Everything else about the booking flow itself (driver selection, fixed
// $5/$10 + $2 rates, cash-on-collection) is unchanged and applies
// identically to both origins.
//
// UPDATED: confirmBooking() no longer inserts directly into
// delivery_bookings. The $2 ImbizoHub booking fee is a real Paynow
// charge now — same create-payment -> Paynow checkout -> poll
// payment_intents pattern unlock.tsx already uses for the arrange-deal
// fee. The actual delivery_bookings row is created server-side by
// paynow-webhook once payment is confirmed, not here — same reasoning
// as unlock_fee: a returnurl visit just means the buyer came back to
// the app, it doesn't mean Paynow actually confirmed the charge. The
// $5/$10 driver fee is unchanged and stays cash-on-collection; only the
// $2 platform fee goes through Paynow.

import DateTimePicker from '@react-native-community/datetimepicker';
import { useLocalSearchParams, useRouter } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator, Modal, Platform, ScrollView, StyleSheet,
  Text, TextInput, TouchableOpacity, View,
} from 'react-native';
import { supabase } from '../../lib/supabase';

const GOLD = '#B8860B';
const BLACK = '#1A1A18';
const DARK = '#2a2a2a';
const GREY = '#AAAAAA';

// Same poll budget unlock.tsx uses while waiting for paynow-webhook to
// mark the payment_intents row 'paid'.
const POLL_INTERVAL_MS = 2000;
const POLL_MAX_ATTEMPTS = 20; // ~40 seconds total — was 15 (~30s); widened
// after a real trip_deposit payment on quotes.tsx took 32s to confirm
// and got missed under the old window. Same webhook path, same fix.

export default function DeliveryBookingScreen() {
  const router = useRouter();
  const { listing_id, seller_id, listing_price, item_request_id } = useLocalSearchParams<{
    listing_id?: string;
    seller_id: string;
    listing_price?: string;
    item_request_id?: string;
  }>();

  // Exactly one of these should be present per navigation — mirrors the
  // listing_id vs request_id vs item_request_id branching already used
  // in chat.tsx.
  const isFromWantedMatch = !listing_id && !!item_request_id;

  const [myId, setMyId] = useState('');
  const [myEmail, setMyEmail] = useState('');
  const [pickupCity, setPickupCity] = useState('');
  const [dropoffCity, setDropoffCity] = useState('');
  const [parcelDescription, setParcelDescription] = useState('');
  // NEW: previously deliveries had no date concept at all — implicitly
  // always "as soon as possible." This adds a genuine, optional
  // scheduling choice; ASAP stays the default, matching existing
  // behavior exactly when nothing's changed here.
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

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (user) {
        setMyId(user.id);
        setMyEmail(user.email ?? '');
      }
    });
  }, []);

  // Determine delivery type and fee based on cities
  const isIntercity = pickupCity.trim().toLowerCase() !== dropoffCity.trim().toLowerCase()
    && pickupCity.trim() !== '' && dropoffCity.trim() !== '';
  const deliveryFee = isIntercity ? 10 : 5;
  const deliveryType = isIntercity ? 'intercity' : 'local';
  const BOOKING_FEE = 2;

  async function findDrivers() {
    if (!pickupCity.trim() || !dropoffCity.trim()) {
      setError('Please enter both pickup and dropoff cities.');
      return;
    }
    setError('');
    setDriversLoading(true);

    // Load all active, verified, PAID delivery operators.
    // registration_paid gates out operators who haven't paid the $10
    // registration fee (or whose 12-month registration has lapsed) — they
    // must not appear as choosable drivers until they pay/renew.
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

    setAvailableDrivers(data ?? []);
    setStep('choose-driver');
  }

  // Polls payment_intents for this reference until it's marked 'paid'
  // (paynow-webhook does that once Paynow confirms the charge and
  // creates the real delivery_bookings row) — same shape as unlock.tsx's
  // pollForPaid: bounded attempts, short-circuits immediately on
  // 'error'/'cancelled' rather than waiting out the full poll window.
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

    // The person on this screen is always the buyer requesting delivery.
    // seller_id comes in as a route param identifying either the
    // listing's seller or the Wanted match's accepted responder — same
    // meaning either way ("the person providing the item").
    const { data: createResult, error: createError } = await supabase.functions.invoke('create-payment', {
      body: {
        kind: 'delivery_booking_fee',
        amount: BOOKING_FEE,
        email: myEmail || undefined,
        // Exactly one of these two, matching delivery_bookings' own
        // mutually-exclusive-origin CHECK constraint.
        listing_id: isFromWantedMatch ? undefined : parseInt(listing_id!),
        item_request_id: isFromWantedMatch ? item_request_id : undefined,
        buyer_id: myId,
        seller_id: seller_id,
        operator_user_id: selectedDriver.id,
        pickup_city: pickupCity.trim(),
        dropoff_city: dropoffCity.trim(),
        delivery_type: deliveryType,
        delivery_fee: deliveryFee,
        parcel_description: parcelDescription.trim() || undefined,
        // NEW: NULL/undefined means ASAP, matching today's existing
        // (only) behavior — only sent when the buyer actually picked a
        // scheduled date via the new calendar option.
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

    // Open Paynow's real checkout page — same in-app browser unlock.tsx
    // uses. The buyer completes payment there (EcoCash prompt, card
    // entry, etc.); this screen has no visibility into that step and
    // must not assume it succeeded just because the browser closed —
    // only the webhook, polled below, confirms that.
    await WebBrowser.openBrowserAsync(checkoutUrl);

    setBookingStage('confirming');
    const result = await pollForPaid(reference);

    setBooking(false);
    setBookingStage('idle');

    if (result === 'paid') {
      // The real delivery_bookings row was created server-side by
      // paynow-webhook — nothing left to insert from here.
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
    <View style={styles.container}>
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

            {/* Fee preview */}
            <View style={styles.feeCard}>
              <View style={styles.feeRow}>
                <Text style={styles.feeLabel}>Within same city</Text>
                <Text style={styles.feeValue}>$5 to driver + $2 booking fee</Text>
              </View>
              <View style={styles.feeDivider} />
              <View style={styles.feeRow}>
                <Text style={styles.feeLabel}>Different cities</Text>
                <Text style={styles.feeValue}>$10 to driver + $2 booking fee</Text>
              </View>
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

            {pickupCity.trim() !== '' && dropoffCity.trim() !== '' && (
              <View style={styles.deliveryTypeBadge}>
                <Text style={styles.deliveryTypeBadgeText}>
                  {isIntercity ? '🚌 Intercity delivery — $10' : '🛵 Local delivery — $5'}
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

            {/* NEW: previously deliveries had no scheduling concept at
                all — always implicitly ASAP. This is a genuinely
                optional addition; leaving it on ASAP keeps behavior
                identical to before this existed. */}
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
                : 'No drivers available right now. Try again later or choose Meet & Collect instead.'}
            </Text>

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
              <Text style={styles.confirmLabel}>Delivery type</Text>
              <Text style={styles.confirmValue}>{isIntercity ? 'Intercity' : 'Local'}</Text>

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
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#111111' },
  content: { padding: 20, paddingTop: Platform.OS === 'ios' ? 56 : 40 },

  backBtn: { marginBottom: 8 },
  backText: { color: GREY, fontSize: 13 },
  heading: { fontSize: 24, fontWeight: '800', color: '#fff', marginBottom: 8 },
  subheading: { fontSize: 13, color: GREY, lineHeight: 19, marginBottom: 20 },

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
