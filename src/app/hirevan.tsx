// app/hirevan.tsx
//
// PAUSED (product decision, same treatment as Dealer Pro in
// dealer.tsx/dealer-pro-pay.tsx): van-hire moved from fully HIDDEN
// (no entry point at all) to VISIBLE-BUT-PAUSED — the "Need a van?"
// banner in index.tsx and the Transport Operator card in register.tsx
// are both visible again, but this screen itself won't accept a real
// submission until VAN_HIRE_PAUSED is flipped to false.
//
// UNLIKE dealer-pro-pay.tsx (which has NO internal guard at all —
// pausing only happens at dealer.tsx's entry-point card, so a direct
// deep link there could still complete a real purchase), this screen
// guards itself directly: handleSubmit() checks VAN_HIRE_PAUSED before
// ever reaching the insert, and the whole form is replaced with a
// "Coming soon" screen when paused. Reaching this route by any path —
// the banner, a bookmark, a deep link — always shows the same paused
// state, not just when arriving via index.tsx's banner.
//
// Everything else (operator-register-pay.tsx, operator-requests.tsx,
// the transport_operator_registration payment kind, quotes.tsx) is
// untouched and stays fully functional for operators already
// registered — this pause only affects NEW trip requests being posted.
const VAN_HIRE_PAUSED = false;

import DateTimePicker from '@react-native-community/datetimepicker';
import { useRouter } from 'expo-router';
import { createElement, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { supabase } from '../../lib/supabase';
import CityPicker from '../../components/CityPicker';

const GOLD = '#B8860B';
const BLACK = '#1A1A18';
const DARK = '#2a2a2a';
const GREY = '#AAAAAA';
const GREEN = '#4fc96e';

// FIX (date pickers dead on web — see the `Platform.OS === 'web'` branch
// below): a plain object, deliberately NOT run through StyleSheet.create.
// StyleSheet.create's return value is react-native-web's own internal
// style representation, meant to be read by RN Views/Text — handing it
// straight to a raw DOM <input> (which isn't wrapped by react-native-web
// at all) risks it not being applied as real CSS. A plain inline-style
// object sidesteps that entirely.
// FIX (real bug, "date picker overlaps" report): this raw DOM <input>
// bypasses react-native-web entirely (see comment above), which means it
// also misses out on the `boxSizing: 'border-box'` that RNW quietly adds
// to every one of its own components (checked react-native-web's own
// View source — it's applied per-component in its generated style, never
// as a global CSS reset, so nothing outside RNW's pipeline gets it for
// free). Left at the browser default of content-box, this field's actual
// rendered width was 100% of its container PLUS 28px of padding and a
// border on top of that — spilling past the card's right edge and
// overlapping whatever sits next to it, unlike every other input on this
// screen (which stayed flush because RNW's TextInput gets border-box
// automatically). Explicit boxSizing here closes that gap.
const webDateInputStyle: any = {
  backgroundColor: DARK, borderRadius: 10, paddingLeft: 14, paddingRight: 14,
  paddingTop: 12, paddingBottom: 12, border: '0.5px solid #333',
  color: '#fff', fontSize: 14, width: '100%', boxSizing: 'border-box',
  colorScheme: 'dark',
};

// NEW: same launch promo window used everywhere else today — needed
// here so the info box can honestly reflect that the deposit
// mentioned below is currently free, matching what quotes.tsx (the
// next screen in this flow) actually shows.
const FREE_PROMO_END = new Date('2027-01-31T23:59:59Z');
const isPromoActive = () => new Date() < FREE_PROMO_END;

export default function HireVanScreen() {
  const router = useRouter();

  const [pickup, setPickup] = useState('');
  // Picked from a fixed list, unlike pickup/destination above which
  // stay free text. These are what operator-requests.tsx matches on —
  // see lib/cities.ts for why the free-text fields cannot be.
  const [pickupCity, setPickupCity] = useState('');
  const [destinationCity, setDestinationCity] = useState('');
  const [destination, setDestination] = useState('');
  const [date, setDate] = useState('');
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
        setDate(toIsoDate(selected));
      }
    } else {
      if (selected) setDateObj(selected);
    }
  }
  // GOODS SUPPORT (2 Sep 2026). This screen could only describe a
  // passenger trip: "Number of passengers" was required and there was no
  // way to say what you were moving. Real demand ignored that — the trip
  // posted 1 Sep (Kwekwe -> Plumtree) put "2 passengers" in the required
  // field and the actual job in the notes: "Fragile glass to be wrapped in
  // bubble wrap". It went unquoted, because no operator could see it.
  //
  // loadType now decides which follow-up question is asked. 'people' keeps
  // the passenger count exactly as it always was, so every existing trip
  // flow is untouched; goods trips ask for a rough size instead.
  //
  // The options are deliberately small. Every registered operator drives
  // an 8-seater, so there is no truck supply behind "farm load" or
  // "truck load" — offering them would just produce more unquoted
  // requests, which is the exact problem this is fixing. Widen this list
  // when the operators exist, not before.
  const [loadType, setLoadType] = useState<'people' | 'goods' | 'large_item'>('people');
  const [loadSize, setLoadSize] = useState<'boot' | 'van' | 'truck' | ''>('');

  // "A truck load" appears only when a truck operator actually exists.
  //
  // The first version of this screen hard-coded the option list to boot/van
  // because every operator drove an 8-seater. That was accurate on the day
  // and wrong as a design: it baked a snapshot of supply into the customer's
  // form, so the day someone registered a truck, a human had to notice and
  // edit this file. Deriving it instead means the option turns itself on,
  // and turns itself off again if every truck operator lapses.
  const [truckAvailable, setTruckAvailable] = useState(false);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data, error: capErr } = await supabase
        .from('profiles')
        .select('id')
        .eq('max_load_size', 'truck')
        .eq('operator_status', 'active')
        .limit(1);
      // On error, leave it off. Showing an option nobody can serve is a
      // worse failure than hiding one somebody could — an unquoted request
      // costs the customer a wasted post and their trust.
      if (!cancelled && !capErr) setTruckAvailable((data ?? []).length > 0);
    })();
    return () => { cancelled = true; };
  }, []);
  const [passengers, setPassengers] = useState('');
  const [description, setDescription] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

  async function handleSubmit() {
    if (VAN_HIRE_PAUSED) return;

    setError('');

    // Trimmed, because a string of spaces is truthy. Typing a space into
    // Pickup satisfied the old check and then stored '' — the insert below
    // has always written pickup.trim() — producing a live trip request
    // with no pickup address for operators to quote on.
    const pickupText = pickup.trim();
    const destinationText = destination.trim();

    // The passenger count is only required for a passenger trip now — a
    // goods trip needs a size instead. Checked separately so each gives
    // the message that names the field actually missing.
    if (!pickupText || !destinationText || !date) {
      setError('Please fill in all required fields.');
      return;
    }
    if (loadType === 'people' && !passengers) {
      setError('Enter how many passengers are travelling.');
      return;
    }
    if (loadType !== 'people' && !loadSize) {
      setError('Choose roughly how much you\'re moving.');
      return;
    }

    // The web build uses a real <input type="date"> whose min attribute
    // stops the browser's own picker offering earlier dates — but it does
    // not stop someone typing one, and nothing here re-checked it. The
    // native pickers already enforce minimumDate, so this closes the web
    // gap and gives both platforms the same rule in one place.
    const todayIso = toIsoDate(new Date());
    if (date < todayIso) {
      setError('Pick a date from today onwards.');
      return;
    }

    // Required: without a city the trip cannot be matched to any
    // operator, and would fall back to being shown to everyone —
    // which is the noise this feature exists to remove.
    if (!pickupCity || !destinationCity) {
      setError('Please select both a pickup city and a destination city.');
      return;
    }

    // A goods trip still writes a passenger count of 1: `requests.passengers`
    // is NOT NULL and several older screens read it directly. 1 is the
    // honest value — the person accompanying their own load — and it keeps
    // every existing query working without a migration on those screens.
    let passengerCount = 1;
    if (loadType === 'people') {
      passengerCount = parseInt(passengers, 10);
      if (isNaN(passengerCount) || passengerCount < 1) {
        setError('Enter a valid number of passengers.');
        return;
      }
    }

    setLoading(true);

    // FIX (consistent with chat.tsx, post-wanted.tsx, browse-wanted.tsx):
    // requesting a quote reveals no contact info and isn't a financial
    // commitment — same free/anonymous treatment as the rest of the
    // browse-and-engage surface. This previously showed an error and
    // hard-blocked posting entirely without an account, which is exactly
    // the kind of friction that deters casual customers before they've
    // even seen a quote. A real account is only needed once money
    // actually changes hands — paying the commitment fee (7%, capped
    // at $15) in quotes.tsx.
    let { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      const { data, error: signInError } = await supabase.auth.signInAnonymously();
      if (signInError) {
        setError('Couldn\'t post — please check your connection and try again.');
        setLoading(false);
        return;
      }
      user = data.user;
    }
    if (!user) {
      setError('Something went wrong. Please try again.');
      setLoading(false);
      return;
    }

    const { error: insertError } = await supabase.from('requests').insert({
      user_id: user.id,
      pickup: pickupText,
      destination: destinationText,
      pickup_city: pickupCity || null,
      destination_city: destinationCity || null,
      date: date.trim(),
      passengers: passengerCount,
      load_type: loadType,
      load_size: loadType === 'people' ? null : loadSize,
      description: description.trim(),
      status: 'open',
    });

    setLoading(false);

    if (insertError) {
      // Postgres error text is written for a developer. Trigger-raised
      // messages (check_violation / P0001) are written for a person and
      // are worth showing; everything else is not.
      if (insertError.code === '23514' || insertError.code === 'P0001') {
        setError(insertError.message);
      } else {
        console.error('request insert failed', insertError.code, insertError.message);
        setError('Could not post your trip. Please try again.');
      }
      return;
    }

    setSuccess(true);
  }

  if (VAN_HIRE_PAUSED) {
    return (
      <View style={styles.successScreen}>
        <Text style={styles.successEmoji}>🚐</Text>
        <Text style={styles.successTitle}>Coming soon</Text>
        <Text style={styles.successSub}>
          Transport is on its way — post a trip and let operators bid
          for the job. Check back soon.
        </Text>
        <TouchableOpacity
          style={styles.successBtnOutline}
          onPress={() => router.push('/')}
        >
          <Text style={styles.successBtnOutlineText}>Back to home</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (success) {
    return (
      <View style={styles.successScreen}>
        <Text style={styles.successEmoji}>🎉</Text>
        <Text style={styles.successTitle}>Trip request posted!</Text>
        <Text style={styles.successSub}>
          Operators can now see your trip and submit quotes.
        </Text>
        <TouchableOpacity
          style={styles.successBtn}
          onPress={() => router.push('/quotes')}
        >
          <Text style={styles.successBtnText}>View quotes</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.successBtnOutline}
          onPress={() => router.push('/')}
        >
          <Text style={styles.successBtnOutlineText}>Back to home</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    // FIX (real bug, reported: "the keyboard hides some of the tabs, i
    // cannot scroll up to type in the tabs" — passengers/notes near the
    // bottom of this form end up hidden behind the keyboard with no way
    // to reach them): this screen had a ScrollView but no
    // KeyboardAvoidingView at all, unlike every other form screen in
    // this app (browse-wanted.tsx, chat.tsx). Without it, particularly
    // on iOS, opening the keyboard doesn't resize or inset the
    // scrollable area to account for the space the keyboard now
    // covers, so a field near the bottom can end up entirely behind it
    // with no amount of scrolling able to reveal it — the ScrollView
    // itself was never told the keyboard exists. Wrapping it here
    // matches the same fix already applied elsewhere.
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
    <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
        <Text style={styles.backText}><Text style={styles.backArrow}>‹</Text> Back</Text>
      </TouchableOpacity>

      {/* "Hire a Van" and "your fare" both said passengers-only. The
          screen now carries goods too, so the wording has to stop
          promising one of the two things it does. */}
      <Text style={styles.heading}>Post a trip</Text>
      <Text style={styles.subheading}>
        Say what you're moving and where. Operators bid for the job.
      </Text>

      {error ? (
        <View style={styles.errorBox}>
          <Text style={styles.errorText}>⚠️ {error}</Text>
        </View>
      ) : null}

      <View style={styles.card}>
        {/* CHANGED (1 Sep 2026, direct product decision): grouped by LEG
            of the journey — pickup address then pickup city, destination
            address then destination city.

            This reverses an earlier decision, and the reasoning for that
            one is worth keeping rather than deleting: the two cities
            decide who is shown the trip, so putting them side by side let
            the person compare the pair that actually matters.

            But it asked them to answer in an order nobody thinks in.
            People plan a journey one end at a time — where am I leaving
            from, then where am I going — and the earlier layout made them
            describe both ends loosely, then go back and pin down both
            ends precisely. Answering "Imbizo" and immediately "Kwekwe" is
            one thought; answering it four fields later is a second visit
            to the same question.

            The hint below still ties the pickup city to who sees the
            trip, which is the part the old order existed to communicate. */}
        <Text style={styles.label}>Pickup location *</Text>
        <TextInput
          style={styles.input}
          placeholder="e.g. Mbare Musika, Harare"
          placeholderTextColor="#666"
          value={pickup}
          onChangeText={setPickup}
        />

        <Text style={styles.label}>Pickup city *</Text>
        <CityPicker value={pickupCity} onChange={setPickupCity} placeholder="Select pickup city" />

        <Text style={styles.label}>Destination *</Text>
        <TextInput
          style={styles.input}
          placeholder="e.g. Chinhoyi Bus Terminus"
          placeholderTextColor="#666"
          value={destination}
          onChangeText={setDestination}
        />

        <Text style={styles.label}>Destination city *</Text>
        <CityPicker value={destinationCity} onChange={setDestinationCity} placeholder="Select destination city" />
        <Text style={styles.cityHint}>
          Operators based in the pickup city will see your trip.
        </Text>

        <Text style={styles.label}>Travel date *</Text>
        {Platform.OS === 'web' ? (
          // FIX: @react-native-community/datetimepicker has no web
          // implementation at all — the two branches below (Android's
          // inline calendar, iOS's modal sheet) simply never matched on
          // web, so tapping this field did nothing visible and the
          // "Hire a Van" form could never actually be submitted from the
          // website. A real HTML date input is the standard fallback —
          // it opens the browser's own native date picker.
          createElement('input', {
            type: 'date',
            value: date,
            min: toIsoDate(new Date()),
            onChange: (e: any) => setDate(e.target.value),
            style: webDateInputStyle,
          })
        ) : (
          <TouchableOpacity
            style={styles.dateField}
            onPress={() => {
              setDateObj(date ? new Date(date + 'T00:00:00') : new Date());
              setShowDatePicker(true);
            }}
          >
            <Text style={date ? styles.dateFieldText : styles.dateFieldPlaceholder}>
              {date ? formatDateDisplay(date) : 'Select date'}
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
                    setDate(toIsoDate(dateObj));
                    setShowDatePicker(false);
                  }}
                >
                  <Text style={styles.pickerDoneBtnText}>Done</Text>
                </TouchableOpacity>
              </View>
            </View>
          </Modal>
        )}

        <Text style={styles.label}>What are you moving? *</Text>
        <View style={styles.chipRow}>
          {([
            ['people', 'People'],
            ['goods', 'Boxes or goods'],
            ['large_item', 'One big item'],
          ] as const).map(([value, label]) => (
            <TouchableOpacity
              key={value}
              style={[styles.chip, loadType === value && styles.chipOn]}
              onPress={() => setLoadType(value)}
              activeOpacity={0.85}
            >
              <Text style={[styles.chipText, loadType === value && styles.chipTextOn]}>
                {label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {loadType === 'people' ? (
          <>
            <Text style={styles.label}>Number of passengers *</Text>
            <TextInput
              style={styles.input}
              placeholder="e.g. 4"
              placeholderTextColor="#666"
              value={passengers}
              onChangeText={setPassengers}
              keyboardType="number-pad"
            />
          </>
        ) : (
          <>
            <Text style={styles.label}>Roughly how much? *</Text>
            <View style={styles.chipRow}>
              {([
                ['boot', 'Fits in a car boot'],
                ['van', 'A van load'],
                ...(truckAvailable ? [['truck', 'A truck load'] as const] : []),
              ] as const).map(([value, label]) => (
                <TouchableOpacity
                  key={value}
                  style={[styles.chip, loadSize === value && styles.chipOn]}
                  onPress={() => setLoadSize(value)}
                  activeOpacity={0.85}
                >
                  <Text style={[styles.chipText, loadSize === value && styles.chipTextOn]}>
                    {label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
            {/* Says plainly what the vans on this app can take, so nobody
                posts a house move that will never be quoted. */}
            <Text style={styles.cityHint}>
              {truckAvailable
                ? 'Pick the closest size — operators quote against what you choose.'
                : 'Operators here drive vans, not trucks — anything up to a van load.'}
            </Text>
          </>
        )}

        <Text style={styles.label}>Extra notes (optional)</Text>
        <TextInput
          style={[styles.input, styles.textArea]}
          placeholder="Any special requirements, luggage, stops..."
          placeholderTextColor="#666"
          value={description}
          onChangeText={setDescription}
          multiline
          numberOfLines={4}
        />
      </View>

      {/* FIX (real staleness bug, found during a thorough review): this
          used to unconditionally say "pay a small deposit," even
          though accepting a quote is currently free under the launch
          promo — the exact thing quotes.tsx (the very next screen in
          this flow) already correctly shows. Someone posting a trip
          here would be told to expect a fee that, right now, doesn't
          apply. Now branches the same way every other promo-aware
          screen does today. */}
      <View style={styles.infoBox}>
        <Text style={styles.infoText}>
          {isPromoActive()
            ? '🔒 Your contact details stay private until you choose an operator — free right now, launch promotion through Jan 31, 2027.'
            : '🔒 Your contact details stay private until you choose an operator and pay a small platform fee.'}
        </Text>
      </View>

      <TouchableOpacity
        style={[styles.submitBtn, loading && styles.submitBtnDisabled]}
        onPress={handleSubmit}
        disabled={loading}
        activeOpacity={0.85}
      >
        {loading ? (
          <ActivityIndicator color={BLACK} />
        ) : (
          <Text style={styles.submitText}>Post trip request</Text>
        )}
      </TouchableOpacity>
    </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#111111' },
  // NEW: extra scroll headroom below the last field/submit button —
  // was 48, which can leave content sitting right against the
  // keyboard's edge on some phones. This is pure safety margin on top
  // of the KeyboardAvoidingView + ScrollView fix above; doesn't change
  // anything when the keyboard is closed since it's just trailing
  // whitespace at the very bottom of a scrollable area.
  content: { padding: 20, paddingTop: Platform.OS === 'ios' ? 56 : 40, paddingBottom: 140 },

  backBtn: { marginBottom: 16 },
  backText: { color: GREY, fontSize: 14 },
  // NEW: bigger than the label text so the '‹' glyph reads clearly — direct product decision ("back symbol too small").
  backArrow: { fontSize: 20 },

  heading: { fontSize: 24, fontWeight: '800', color: '#fff', marginBottom: 6 },
  subheading: { fontSize: 13, color: GREY, marginBottom: 24, lineHeight: 19 },

  errorBox: { backgroundColor: '#3a1a1a', borderRadius: 10, padding: 12, marginBottom: 16 },
  errorText: { color: '#ff8a8a', fontSize: 13 },

  card: {
    backgroundColor: BLACK,
    borderRadius: 14,
    padding: 18,
    marginBottom: 16,
    borderWidth: 0.5,
    borderColor: '#333',
  },
  label: { fontSize: 13, fontWeight: '700', color: '#fff', marginBottom: 8, marginTop: 14 },
  cityHint: { color: '#888', fontSize: 12, marginTop: 6 },

  // Chips rather than a picker: there are three options and two options,
  // both sets fit on one screen, and a tap is faster than opening a modal
  // and choosing. `flexWrap` matters — "Boxes or goods" and "One big item"
  // do not fit on one line on a small phone.
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    backgroundColor: '#222220',
    borderWidth: 1,
    borderColor: '#333',
    borderRadius: 999,
    paddingVertical: 9,
    paddingHorizontal: 14,
  },
  chipOn: { backgroundColor: '#2A2416', borderColor: '#5a4a1c' },
  chipText: { color: '#AAAAAA', fontSize: 13 },
  chipTextOn: { color: GOLD, fontWeight: '700' },

  input: {
    backgroundColor: DARK,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: Platform.OS === 'ios' ? 13 : 10,
    fontSize: 14,
    color: '#fff',
    borderWidth: 0.5,
    borderColor: '#333',
  },
  textArea: { height: 90, textAlignVertical: 'top', paddingTop: 10 },

  dateField: {
    backgroundColor: DARK, borderRadius: 10, paddingHorizontal: 14,
    paddingVertical: Platform.OS === 'ios' ? 13 : 12,
    borderWidth: 0.5, borderColor: '#333',
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
  },
  dateFieldText: { fontSize: 14, color: '#fff' },
  dateFieldPlaceholder: { fontSize: 14, color: '#666' },
  dateFieldIcon: { fontSize: 16 },
  pickerModalOverlay: { flex: 1, width: '100%', backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end', alignItems: 'center' },
  pickerModalSheet: { width: '100%', maxWidth: 640, alignSelf: 'center', backgroundColor: DARK, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 16, paddingBottom: 32 },
  pickerDoneBtn: { backgroundColor: GOLD, borderRadius: 12, paddingVertical: 14, alignItems: 'center', marginTop: 12 },
  pickerDoneBtnText: { color: BLACK, fontSize: 14, fontWeight: '700' },

  infoBox: { backgroundColor: '#1a1a2e', borderRadius: 10, padding: 14, marginBottom: 20, borderWidth: 0.5, borderColor: '#3a3a5e' },
  infoText: { color: '#8888ff', fontSize: 12, lineHeight: 18 },

  submitBtn: { backgroundColor: GOLD, borderRadius: 14, paddingVertical: 16, alignItems: 'center' },
  submitBtnDisabled: { opacity: 0.6 },
  submitText: { color: BLACK, fontSize: 16, fontWeight: '800' },

  successScreen: {
    flex: 1,
    backgroundColor: '#111111',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
  },
  successEmoji: { fontSize: 64, marginBottom: 20 },
  successTitle: { fontSize: 24, fontWeight: '800', color: '#fff', marginBottom: 10, textAlign: 'center' },
  successSub: { fontSize: 15, color: GREY, textAlign: 'center', lineHeight: 22, marginBottom: 32 },
  successBtn: {
    backgroundColor: GOLD,
    borderRadius: 14,
    paddingVertical: 16,
    paddingHorizontal: 40,
    marginBottom: 12,
    width: '100%',
    alignItems: 'center',
  },
  successBtnText: { color: BLACK, fontSize: 16, fontWeight: '800' },
  successBtnOutline: {
    borderRadius: 14,
    paddingVertical: 16,
    paddingHorizontal: 40,
    width: '100%',
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: GOLD,
  },
  successBtnOutlineText: { color: GOLD, fontSize: 16, fontWeight: '700' },
});
