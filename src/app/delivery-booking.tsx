// app/delivery-booking.tsx
// Delivery booking screen — buyer requests delivery, available drivers avail themselves,
// seller chooses a driver.
//
// UPDATED (pricing decision): rates now depend on item size, not just
// distance — a phone and a window frame shouldn't cost the same to
// move. Two tiers:
//   Small (fits in a normal car): $8 local / $12 intercity, fixed.
//   Large (needs a van or truck): NEGOTIATED directly with the driver,
//     not a fixed rate — sizes vary too much (a bed frame and a
//     wardrobe are both "large" but not the same job). Intercity isn't
//     offered at all for large items; large-item delivery is
//     local-only by design, per product decision.
// $2 booking fee to ImbizoHub either way, unchanged.
//
// UPDATED (large-item pricing → negotiated): every buyer/driver-facing
// screen now shows "Negotiate with driver" instead of a fixed $ amount
// for large items. Under the hood, `deliveryFee` still resolves to a
// real positive number (LARGE_ITEM_REFERENCE_FEE) for large bookings —
// the create-payment edge function's `!delivery_fee` presence check and
// the delivery_bookings.delivery_fee NOT NULL column both require a
// truthy numeric value, and changing either is a backend/schema change
// out of scope here. That number is never shown to buyer or driver as
// a price; it's purely a backend placeholder so the existing payment
// plumbing keeps working unchanged.
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
// NEW (launch promo): the $2 ImbizoHub booking fee is now free through
// Jan 31, 2027, same promo window as everything else in the app — we
// don't have a payment method wired up as a business yet, so charging
// this fee isn't the point right now. confirmBooking() branches on
// isPromoActive(): during the promo it calls the new
// book-delivery-free-promo edge function directly (no Paynow checkout,
// no polling); afterward it falls back to the existing
// create-payment -> Paynow -> poll flow, unchanged. The driver's own
// fee stays cash-on-collection either way — only the platform's $2 cut
// is waived.
//
// FIX (secondary, found in the same pass): findDrivers() validated
// pickup/dropoff cities but never checked that a "Schedule for later"
// selection actually had a date picked — someone could toggle
// scheduled, never pick a date, and the booking would silently proceed
// as if it were ASAP with no warning at all.

import DateTimePicker from '@react-native-community/datetimepicker';
import { useLocalSearchParams, useRouter } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { createElement, useEffect, useState } from 'react';
import {
  ActivityIndicator, KeyboardAvoidingView, Modal, Platform, ScrollView, StyleSheet,
  Text, TextInput, TouchableOpacity, View,
} from 'react-native';
import { supabase } from '../../lib/supabase';
import { extractFunctionError } from '../../lib/paymentError';

const GOLD = '#B8860B';
const BLACK = '#1A1A18';
const DARK = '#2a2a2a';
const GREY = '#AAAAAA';

// FIX (date picker dead on web — see the `Platform.OS === 'web'` branch
// below): a plain object, deliberately NOT run through StyleSheet.create.
// StyleSheet.create's return value is react-native-web's own internal
// style representation, meant to be read by RN Views/Text — handing it
// straight to a raw DOM <input> (which isn't wrapped by react-native-web
// at all) risks it not being applied as real CSS. A plain inline-style
// object sidesteps that entirely.
// FIX (real bug, "date picker overlaps" report, same root cause found in
// hirevan.tsx's identical copy of this style object): this raw DOM
// <input> bypasses react-native-web entirely, which means it also misses
// the `boxSizing: 'border-box'` RNW quietly adds to every one of its own
// components (checked react-native-web's own View source — applied
// per-component in its generated style, never as a global CSS reset, so
// nothing outside RNW's pipeline gets it for free). Left at the browser
// default of content-box, this field's actual rendered width was 100% of
// its container PLUS 28px of padding and a border on top of that —
// spilling past its container's right edge and overlapping whatever sits
// next to it, unlike every other input on this screen (which stayed
// flush because RNW's TextInput gets border-box automatically). Explicit
// boxSizing here closes that gap.
const webDateInputStyle: any = {
  backgroundColor: DARK, borderRadius: 10, paddingLeft: 14, paddingRight: 14,
  paddingTop: 12, paddingBottom: 12, border: '0.5px solid #333',
  color: '#fff', fontSize: 14, width: '100%', boxSizing: 'border-box',
  colorScheme: 'dark',
};

const POLL_INTERVAL_MS = 2000;
const POLL_MAX_ATTEMPTS = 20;

// NEW: launch promotion — the $2 ImbizoHub booking fee is free until
// Jan 31, 2027, same window/pattern as every other promo in the app
// (see unlock.tsx). We don't have a payment method wired up as a
// business yet, so charging this fee right now isn't the point —
// waiving it removes the one remaining friction point (and Paynow
// checkout) between a buyer and a booked driver. The driver's own fee
// stays cash-on-collection, unchanged; only the platform's $2 cut is
// waived during the promo.
const FREE_PROMO_END = new Date('2027-01-31T23:59:59Z');
const isPromoActive = () => new Date() < FREE_PROMO_END;

const LARGE_VEHICLE_KEYWORDS = ['van', 'truck', 'bakkie', 'pickup', 'pick-up', 'lorry', 'minibus'];

function canCarryLargeItems(vehicleType: string | null | undefined): boolean {
  if (!vehicleType) return false;
  const lower = vehicleType.toLowerCase();
  return LARGE_VEHICLE_KEYWORDS.some((kw) => lower.includes(kw));
}

export default function DeliveryBookingScreen() {
  const router = useRouter();
  const { listing_id, seller_id, listing_price, item_request_id, reassign_booking_id } = useLocalSearchParams<{
    listing_id?: string;
    seller_id: string;
    listing_price?: string;
    item_request_id?: string;
    reassign_booking_id?: string;
  }>();

  // NEW: reassignment mode — reached from delivery-track.tsx /
  // buyer-deliveries.tsx's "Choose another driver →" button after a
  // driver declines a job. The $2 booking fee was already paid on the
  // original booking, so this skips the whole details/payment flow and
  // goes straight to picking a new driver for the SAME booking row.
  const isReassignMode = !!reassign_booking_id;

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
  const [reassignBooking, setReassignBooking] = useState<any>(null);

  useEffect(() => { checkAuth(); }, []);

  async function checkAuth() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user || user.is_anonymous) {
      router.replace('/register');
      return;
    }
    setMyId(user.id);
    setMyEmail(user.email ?? '');

    // Stay on the loading spinner (not the details form) until
    // reassignment data has actually loaded — otherwise the full
    // "Book delivery" form flashes for a moment before jumping to
    // 'choose-driver', which is jarring and shows fields that don't
    // apply to reassignment at all.
    if (reassign_booking_id) {
      await initReassign(reassign_booking_id, user.id);
    }
    setCheckingAuth(false);
  }

  // NEW: loads the declined booking, prefills the same route/item
  // details it was originally booked with, and jumps straight to
  // driver selection — excluding whichever driver(s) already declined
  // it (declined_operator_ids, kept server-side by decline_delivery_job).
  async function initReassign(bookingId: string, userId: string) {
    setDriversLoading(true);
    setError('');

    const { data: bookingRow, error: fetchError } = await supabase
      .from('delivery_bookings')
      .select('*')
      .eq('id', bookingId)
      .maybeSingle();

    if (fetchError || !bookingRow) {
      setError('This booking could not be found.');
      setDriversLoading(false);
      return;
    }
    if (bookingRow.buyer_id !== userId) {
      setError('This booking does not belong to you.');
      setDriversLoading(false);
      return;
    }
    if (bookingRow.status !== 'declined') {
      setError('This booking is not currently waiting for a new driver.');
      setDriversLoading(false);
      return;
    }

    setReassignBooking(bookingRow);
    setPickupCity(bookingRow.pickup_city ?? '');
    setDropoffCity(bookingRow.dropoff_city ?? '');
    setParcelDescription(bookingRow.parcel_description ?? '');
    setParcelSize((bookingRow.parcel_size as 'small' | 'large') ?? 'small');
    setScheduledDate(bookingRow.scheduled_date ?? '');

    const excludedOperatorIds = [
      ...(bookingRow.declined_operator_ids ?? []),
      ...(bookingRow.operator_id ? [bookingRow.operator_id] : []),
    ];

    const { data, error: driversError } = await supabase
      .from('delivery_operators')
      .select('*')
      .eq('status', 'active')
      .eq('registration_paid', true)
      .gt('registration_expires_at', new Date().toISOString())
      .order('verification_tier', { ascending: false })
      .order('rating', { ascending: false });

    setDriversLoading(false);

    if (driversError) {
      setError(driversError.message);
      return;
    }

    let filtered = (data ?? []).filter((d) => !excludedOperatorIds.includes(d.id));
    if (bookingRow.parcel_size === 'large') {
      filtered = filtered.filter((d) => canCarryLargeItems(d.vehicle_type));
    }

    setAvailableDrivers(filtered);
    setStep('choose-driver');
  }

  const citiesDiffer = pickupCity.trim().toLowerCase() !== dropoffCity.trim().toLowerCase()
    && pickupCity.trim() !== '' && dropoffCity.trim() !== '';
  const isIntercity = parcelSize === 'small' && citiesDiffer;

  // NEW: LARGE_ITEM_REFERENCE_FEE is a backend-only placeholder — see
  // top-of-file comment. Never render it directly for a large booking;
  // use isNegotiableFee below to branch to "Negotiate with driver" text
  // instead.
  const LARGE_ITEM_REFERENCE_FEE = 15;
  const isNegotiableFee = parcelSize === 'large';
  const deliveryFee = isNegotiableFee ? LARGE_ITEM_REFERENCE_FEE : (isIntercity ? 12 : 8);
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

  // NEW: reassignment has no payment step — the $2 booking fee was
  // already paid on the original booking — so this just points the
  // existing row at a new operator and puts it back to 'requested' for
  // them (reassign_delivery_operator RPC does both, server-side, and
  // is what triggers that driver's "New delivery job" notification).
  async function reassignDriver() {
    if (!selectedDriver || !reassignBooking) return;
    setBooking(true);
    setError('');

    const { error: rpcError } = await supabase.rpc('reassign_delivery_operator', {
      p_booking_id: reassignBooking.id,
      p_new_operator_id: selectedDriver.id,
    });

    setBooking(false);

    if (rpcError) {
      setError(rpcError.message);
      return;
    }

    setBooked(true);
  }

  // NEW: promo booking path — calls book-delivery-free-promo directly,
  // no create-payment/Paynow checkout/poll at all. Kept fully separate
  // from the paid path below (same reasoning as unlock.tsx's
  // handleUnlockFreePromo) so each flow stays simple and isolated.
  async function confirmBookingFreePromo() {
    setBooking(true);
    setError('');
    setBookingStage('starting');

    const { data: promoResult, error: promoError } = await supabase.functions.invoke('book-delivery-free-promo', {
      body: {
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

    setBooking(false);
    setBookingStage('idle');

    if (promoError || promoResult?.error) {
      setError(await extractFunctionError(promoError, promoResult, 'Could not book delivery. Please try again.'));
      return;
    }

    setBooked(true);
  }

  async function confirmBooking() {
    if (!selectedDriver) return;
    if (isReassignMode) {
      return reassignDriver();
    }
    if (isPromoActive()) {
      return confirmBookingFreePromo();
    }
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
      setError(await extractFunctionError(createError, createResult, 'Could not start payment. Please try again.'));
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
    if (isReassignMode) return booking ? 'Reassigning…' : 'Reassign to this driver';
    // NEW: promo path never leaves the 'starting' stage (no Paynow
    // checkout/poll to move through), so give it its own wording rather
    // than the payment-specific "Starting payment…"/"Opening Paynow…".
    if (isPromoActive()) return bookingStage === 'starting' ? 'Booking…' : 'Confirm booking';
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
          <Text style={styles.successTitle}>
            {isReassignMode ? 'New driver requested!' : 'Delivery booked!'}
          </Text>
          {isReassignMode ? (
            <Text style={styles.successBody}>
              We've sent this job to {selectedDriver?.full_name}. They'll get a notification and can accept
              or decline — you'll be notified either way.{'\n\n'}
              {isNegotiableFee ? (
                <>Agree a price with them directly and <Text style={{ color: GOLD, fontWeight: '800' }}>pay cash</Text> when they collect.</>
              ) : (
                <>Pay them <Text style={{ color: GOLD, fontWeight: '800' }}>${deliveryFee} cash</Text> when they collect.</>
              )}
            </Text>
          ) : (
            <Text style={styles.successBody}>
              We've sent this job to {selectedDriver?.full_name}. They'll get a notification and need to accept
              it before they head your way — you'll be notified as soon as they do.{'\n\n'}
              {isNegotiableFee ? (
                <>Agree a price with them directly and <Text style={{ color: GOLD, fontWeight: '800' }}>pay cash</Text> when they collect.</>
              ) : (
                <>Pay them <Text style={{ color: GOLD, fontWeight: '800' }}>${deliveryFee} cash</Text> when they collect.</>
              )}{'\n'}
              {isPromoActive()
                ? 'The ImbizoHub booking fee was free — launch promotion.'
                : `The $${BOOKING_FEE} ImbizoHub booking fee has been paid.`}
            </Text>
          )}
          <TouchableOpacity
            style={styles.doneBtn}
            onPress={() =>
              isReassignMode
                ? router.replace(`/delivery-track?booking_id=${reassignBooking?.id}`)
                : router.back()
            }
          >
            <Text style={styles.doneBtnText}>{isReassignMode ? 'Track delivery' : 'Back to chat'}</Text>
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
        <TouchableOpacity
          onPress={() => {
            // Reassign mode skips the 'details' step entirely (there's
            // nothing to re-edit — same booking, just a new driver), so
            // its only "back" destination is leaving the screen, not a
            // details step that was never shown.
            if (isReassignMode) { router.back(); return; }
            step === 'details' ? router.back() : setStep('details');
          }}
          style={styles.backBtn}
        >
          <Text style={styles.backText}>
            <Text style={styles.backArrow}>‹</Text> {isReassignMode ? 'Back' : step === 'details' ? 'Back' : 'Change details'}
          </Text>
        </TouchableOpacity>

        <Text style={styles.heading}>{isReassignMode ? 'Choose another driver' : 'Book delivery'}</Text>

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
                    <Text style={styles.feeValue}>
                      {isPromoActive() ? '$8 to driver + booking fee free (launch promo)' : '$8 to driver + $2 booking fee'}
                    </Text>
                  </View>
                  <View style={styles.feeDivider} />
                  <View style={styles.feeRow}>
                    <Text style={styles.feeLabel}>Different cities</Text>
                    <Text style={styles.feeValue}>
                      {isPromoActive() ? '$12 to driver + booking fee free (launch promo)' : '$12 to driver + $2 booking fee'}
                    </Text>
                  </View>
                </>
              ) : (
                <View style={styles.feeRow}>
                  <Text style={styles.feeLabel}>Large item (local only)</Text>
                  <Text style={styles.feeValue}>
                    {isPromoActive() ? 'Negotiate with driver + booking fee free (launch promo)' : 'Negotiate with driver + $2 booking fee'}
                  </Text>
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
                    ? `🚚 Large item — Negotiate with driver`
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
              Platform.OS === 'web' ? (
                // FIX: same gap as hirevan.tsx — @react-native-community/
                // datetimepicker has no web implementation, so this field
                // did nothing when tapped on the website and "Schedule
                // for later" could never actually get a date picked. A
                // real HTML date input opens the browser's own picker.
                createElement('input', {
                  type: 'date',
                  value: scheduledDate,
                  min: toIsoDate(new Date()),
                  onChange: (e: any) => setScheduledDate(e.target.value),
                  style: webDateInputStyle,
                })
              ) : (
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
              )
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
                <Text style={styles.primaryBtnText}>‹ Back to chat</Text>
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
            <Text style={styles.subheading}>
              {isReassignMode ? 'Confirm your new driver for this delivery.' : 'Confirm your delivery booking.'}
            </Text>

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
              <Text style={[styles.confirmValue, { color: GOLD, fontSize: 20, fontWeight: '800' }]}>
                {isNegotiableFee ? 'Negotiate with driver' : `$${deliveryFee}`}
              </Text>

              {!isReassignMode && (
                <>
                  <View style={styles.confirmDivider} />
                  <Text style={styles.confirmLabel}>ImbizoHub booking fee</Text>
                  <Text style={styles.confirmValue}>
                    {isPromoActive() ? 'Free through Jan 31, 2027 — launch promo' : `$${BOOKING_FEE} — pay now via Paynow`}
                  </Text>
                </>
              )}
            </View>

            {isReassignMode && (
              <View style={styles.cashNote}>
                <Text style={styles.cashNoteText}>
                  {/* NEW: reassignBooking carries the ORIGINAL booking's
                      real booking_fee — could be 0 if that booking was
                      itself made free under the promo — so this checks
                      the actual paid amount rather than today's promo
                      state, which could differ from when it was booked. */}
                  {reassignBooking?.booking_fee > 0
                    ? `ℹ️ Your $${reassignBooking.booking_fee} booking fee already covers this delivery — no new payment needed to switch drivers.`
                    : 'ℹ️ This delivery was booked free under the launch promo — no payment needed to switch drivers.'}
                </Text>
              </View>
            )}

            <View style={styles.cashNote}>
              <Text style={styles.cashNoteText}>
                {isNegotiableFee ? (
                  <>💵 <Text style={{ color: GOLD, fontWeight: '700' }}>Agree a price with the driver directly</Text> and
                  pay them in cash when they collect the parcel from the seller. Do not pay until they have the item in hand.</>
                ) : (
                  <>💵 Pay the driver <Text style={{ color: GOLD, fontWeight: '700' }}>${deliveryFee} in cash</Text> when
                  they collect the parcel from the seller. Do not pay until they have the item in hand.</>
                )}
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
  // NEW: bigger than the label text so the '‹' glyph reads clearly — direct product decision ("back symbol too small").
  backArrow: { fontSize: 20 },
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
