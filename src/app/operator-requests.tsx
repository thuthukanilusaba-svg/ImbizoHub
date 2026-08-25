// app/operator-requests.tsx
// Operators browse open trips — blocked until $10 registration paid

import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { supabase } from '../../lib/supabase';
import { operatorCanSeeTrip } from '../../lib/cities';

const GOLD = '#B8860B';
const BLACK = '#1A1A18';
const DARK = '#2a2a2a';
const GREY = '#AAAAAA';
const GREEN = '#4fc96e';
const RED = '#ff8a8a';
// UPDATED (pricing model simplified): COMMISSION constant removed —
// the separate 3% commission no longer exists. See confirm-payment.ts's
// trip_deposit branch for the current, simplified fee model (7%,
// capped at $30).

type Request = {
  id: string;
  pickup: string;
  destination: string;
  date: string;
  passengers: number;
  description: string;
  status: string;
  created_at: string;
  pickup_city?: string | null;
  destination_city?: string | null;
};

// A trip this operator has WON — their quote was accepted.
// The city pair, as one short line. Cities are what decide which
// operator sees a trip, so they belong at the top of the card rather
// than being inferred from a street name — 'Town → Lobengula west'
// means nothing to anyone who does not already know the city.
//
// Same city is written 'Within Bulawayo' rather than 'Bulawayo →
// Bulawayo', which reads as a mistake. Missing cities are older trips
// posted before the picker existed; they show what is known rather
// than an arrow with a blank on one side.
function cityRouteLabel(
  from?: string | null,
  to?: string | null
): string | null {
  if (!from && !to) return null;
  if (from && to) return from === to ? `Within ${from}` : `${from} → ${to}`;
  return from ? `From ${from}` : `To ${to}`;
}

// A quote this operator submitted that did not (or has not yet) turned
// into a trip. Deliberately separate from AcceptedTrip: a won trip is
// work to do, these are a record of bids — different urgency, different
// place on the screen.
type MyQuote = {
  quote_id: string;
  price: number;
  pickup: string;
  destination: string;
  pickup_city: string | null;
  destination_city: string | null;
  date: string;
  status: 'pending' | 'declined';
};

type AcceptedTrip = {
  quote_id: string;
  price: number;
  pickup: string;
  destination: string;
  pickup_city: string | null;
  destination_city: string | null;
  date: string;
  iConfirmed: boolean;
  fullyConfirmed: boolean;
};

export default function OperatorRequestsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [requests, setRequests] = useState<Request[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [operatorActive, setOperatorActive] = useState<boolean | null>(null);
  // FIX (real user report): this screen never tracked which open
  // requests the current operator had already quoted, so every card
  // always showed "Submit a quote" — even seconds after successfully
  // submitting one, going straight back to the list. Same
  // myResponseIds pattern already used in browse-wanted.tsx for wanted
  // post responses. A DB-level unique constraint
  // (quotes_request_operator_unique) now also backstops this, so even
  // a stale list can no longer produce a duplicate quote row.
  const [myQuoteRequestIds, setMyQuoteRequestIds] = useState<Set<string>>(new Set());

  // NEW — closes a dead end in the van-hire flow.
  //
  // This screen only ever listed requests with status='open', so the
  // moment a customer accepted an operator's quote the trip disappeared
  // from that operator's view entirely. Nothing anywhere showed an
  // operator the work they had actually won.
  //
  // That matters because van-hire completion is MUTUAL: meetpay.tsx
  // flips a session to 'confirmed' only once BOTH the customer and the
  // driver have tapped "Confirm Trip Complete", and that confirmation is
  // what unlocks ratings for both sides. The customer had a route to
  // that screen (quotes.tsx). The driver had none — no button, no deep
  // link, nothing. So a customer who confirmed sat on "Waiting for your
  // driver to confirm too..." forever, because the driver had no way to
  // do it. Reported exactly that way.
  const [acceptedTrips, setAcceptedTrips] = useState<AcceptedTrip[]>([]);
  const [myQuotes, setMyQuotes] = useState<MyQuote[]>([]);

  // This operator's base city, used to filter the open-trip list.
  // null means 'not set' and deliberately shows everything — see
  // operatorCanSeeTrip() in lib/cities.ts for why every unknown fails
  // open rather than closed.
  const [baseCity, setBaseCity] = useState<string | null>(null);

  const [modalVisible, setModalVisible] = useState(false);
  const [selected, setSelected] = useState<Request | null>(null);
  const [price, setPrice] = useState('');
  const [vehicle, setVehicle] = useState('');
  const [message, setMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [submitError, setSubmitError] = useState('');

  // Reloads on every focus, not just on mount. The moment a quote is
  // accepted is exactly when both people are moving between screens, so
  // a screen that only loaded once showed the operator a stale list with
  // no won trip on it — and no reason to suspect anything was missing.
  // Pull-to-refresh worked, but nobody pulls a list they believe is
  // already current.
  useFocusEffect(
    useCallback(() => {
      checkStatus();
      fetchRequests();
    }, [])
  );

  async function checkStatus() {
    const { data: { user } } = await supabase.auth.getUser();
    // FIX: was `if (!user)`, missing user.is_anonymous — see the same
    // pattern fixed across the app. In practice account_type only ever
    // becomes 'transport_operator' via a real (non-anonymous) account,
    // so this was defense-in-depth rather than a live hole, but kept
    // consistent with every other account-gated screen regardless.
    if (!user || user.is_anonymous) { setOperatorActive(false); return; }

    const { data: profile } = await supabase
      .from('profiles')
      .select('operator_status, account_type, registration_expires_at, vehicle_type, base_city')
      .eq('id', user.id)
      .single();

    setBaseCity(profile?.base_city ?? null);

    if (profile?.account_type !== 'transport_operator') {
      setOperatorActive(false);
      return;
    }

    // Check if registration is active and not expired
    const isActive = profile?.operator_status === 'active';
    const notExpired = profile?.registration_expires_at
      ? new Date(profile.registration_expires_at) > new Date()
      : false;

    // FIX (found during a final sweep — same edge case already fixed in
    // operator-register-pay.tsx and delivery-operator-register-pay.tsx):
    // this screen previously let anyone with a paid, active,
    // non-expired registration straight through to browsing and
    // quoting on trips, with no check that they'd ever actually
    // completed the vehicle-details step. Someone who paid but exited
    // before tapping "Add your vehicle details" could reach this screen
    // directly and start bidding with an empty vehicle_type — showing
    // customers an incomplete profile. Redirects to finish that step
    // instead of either silently allowing it or showing the confusing
    // "registration required" blocked state to someone who's already
    // genuinely paid.
    if (isActive && notExpired && !profile?.vehicle_type) {
      router.replace('/become-operator?type=operator');
      return;
    }

    setOperatorActive(isActive && notExpired);
  }

  async function fetchRequests() {
    setLoading(true);
    const { data } = await supabase
      .from('requests')
      .select('*')
      .eq('status', 'open')
      .order('created_at', { ascending: false });
    setRequests(data ?? []);

    // FIX: see myQuoteRequestIds' declaration above — without this,
    // the list had no idea which of these open requests the current
    // operator had already quoted.
    const { data: { user } } = await supabase.auth.getUser();
    if (user && !user.is_anonymous && data && data.length > 0) {
      const ids = data.map((r: any) => r.id);
      const { data: quotesOnOpenRequests } = await supabase
        .from('quotes')
        .select('request_id')
        .eq('operator_id', user.id)
        .in('request_id', ids);
      setMyQuoteRequestIds(new Set((quotesOnOpenRequests ?? []).map((q: any) => q.request_id)));
    } else {
      setMyQuoteRequestIds(new Set());
    }

    await fetchAcceptedTrips();
    await fetchMyQuotes();

    setLoading(false);
  }

  // Trips this operator has won. Queried separately from the open-request
  // list above on purpose: that one is filtered to status='open', which
  // is exactly what hid accepted trips from the operator in the first
  // place.
  async function fetchAcceptedTrips() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user || user.is_anonymous) { setAcceptedTrips([]); return; }

    const { data: won } = await supabase
      .from('quotes')
      .select('id, price, request_id')
      .eq('operator_id', user.id)
      .eq('status', 'accepted');

    if (!won || won.length === 0) { setAcceptedTrips([]); return; }

    const requestIds = [...new Set(won.map((q: any) => q.request_id))];
    const { data: reqRows } = await supabase
      .from('requests')
      .select('id, pickup, destination, pickup_city, destination_city, date')
      .in('id', requestIds);
    const reqMap: Record<string, any> = {};
    (reqRows ?? []).forEach((r: any) => { reqMap[r.id] = r; });

    // Read the confirmation state so the card can say what is actually
    // outstanding, rather than offering "Confirm" on a trip already
    // done. reference_id on a van_hire session is the quote's id.
    const quoteIds = won.map((q: any) => q.id);
    const { data: sessions } = await supabase
      .from('meetpay_sessions')
      // operator_confirmed_at, NOT seller_confirmed_at — verified
      // against the live meetpay_sessions schema; the buyer-side column
      // is buyer_confirmed_at and the operator-side one is named for the
      // role, not the seller/buyer pairing used elsewhere.
      .select('reference_id, operator_confirmed_at, status')
      .in('reference_id', quoteIds)
      // Scoped to van_hire: reference_id holds quote ids, listing ids and
      // UUIDs in one text column, and quote ids and listing ids are both
      // small integers. Without this a trip can read a listing's session
      // and show the wrong confirmation state.
      .eq('type', 'van_hire');
    const sessionMap: Record<string, any> = {};
    (sessions ?? []).forEach((s: any) => { sessionMap[s.reference_id] = s; });

    setAcceptedTrips(
      won
        .filter((q: any) => reqMap[q.request_id])
        .map((q: any) => {
          const s = sessionMap[q.id];
          return {
            quote_id: q.id,
            price: q.price,
            pickup: reqMap[q.request_id].pickup,
            destination: reqMap[q.request_id].destination,
            pickup_city: reqMap[q.request_id].pickup_city ?? null,
            destination_city: reqMap[q.request_id].destination_city ?? null,
            date: reqMap[q.request_id].date,
            iConfirmed: !!s?.operator_confirmed_at,
            fullyConfirmed: s?.status === 'confirmed',
          };
        })
    );
  }

  // Every quote this operator has submitted that is not a won trip.
  //
  // WHY THIS EXISTS: until now a quote simply vanished the moment it lost.
  // The "Quote sent" badge only appears on requests still listed as open,
  // and "Your trips" only holds accepted ones — so a declined quote was in
  // neither, and the only notice an operator got was a push notification
  // that goes nowhere if they have no push token, and nowhere at all on
  // the website. Someone paying a yearly fee to bid for work could not see
  // what they had bid on.
  async function fetchMyQuotes() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user || user.is_anonymous) { setMyQuotes([]); return; }

    const { data: quotes } = await supabase
      .from('quotes')
      .select('id, price, request_id, status, created_at')
      .eq('operator_id', user.id)
      .in('status', ['pending', 'declined'])
      .order('created_at', { ascending: false })
      .limit(30);

    if (!quotes || quotes.length === 0) { setMyQuotes([]); return; }

    const ids = [...new Set(quotes.map((q: any) => q.request_id))];
    const { data: reqRows } = await supabase
      .from('requests')
      .select('id, pickup, destination, pickup_city, destination_city, date')
      .in('id', ids);
    const reqMap: Record<string, any> = {};
    (reqRows ?? []).forEach((r: any) => { reqMap[r.id] = r; });

    setMyQuotes(
      quotes
        .filter((q: any) => reqMap[q.request_id])
        .map((q: any) => ({
          quote_id: q.id,
          price: q.price,
          pickup: reqMap[q.request_id].pickup,
          destination: reqMap[q.request_id].destination,
          pickup_city: reqMap[q.request_id].pickup_city ?? null,
          destination_city: reqMap[q.request_id].destination_city ?? null,
          date: reqMap[q.request_id].date,
          status: q.status,
        }))
    );
  }

  async function handleRefresh() {
    setRefreshing(true);
    await Promise.all([checkStatus(), fetchRequests()]);
    setRefreshing(false);
  }

  function openModal(req: Request) {
    setSelected(req);
    setPrice('');
    setVehicle('');
    setMessage('');
    setSubmitted(false);
    setSubmitError('');
    setModalVisible(true);
  }

  async function submitQuote() {
    setSubmitError('');
    if (!price || !vehicle) {
      setSubmitError('Please enter your price and vehicle details.');
      return;
    }
    const priceNum = parseFloat(price);
    if (isNaN(priceNum) || priceNum <= 0) {
      setSubmitError('Enter a valid price.');
      return;
    }

    setSubmitting(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user || user.is_anonymous) { setSubmitting(false); setSubmitError('You need to be signed in to submit a quote.'); return; }

    // UPDATED (pricing model simplified): commission_amount no longer
    // set here — the separate 3% commission was removed entirely, see
    // confirm-payment.ts's trip_deposit branch and quotes.tsx for the
    // full reasoning. ImbizoHub's entire take is now the customer's
    // single commitment fee (7%, capped at $30), charged at the
    // deposit step; the
    // operator keeps their full quoted price with nothing owed on top.
    const { error } = await supabase.from('quotes').insert({
      request_id: selected!.id,
      operator_id: user.id,
      price: priceNum,
      vehicle: vehicle.trim(),
      message: message.trim(),
      status: 'pending',
    });

    setSubmitting(false);
    if (error) {
      // FIX: the new quotes_request_operator_unique constraint means a
      // duplicate submission (e.g. two devices on the same account, or
      // this list being stale) now fails here with a clear DB error
      // instead of silently creating a second quote row. Surface it as
      // a normal, friendly message rather than the raw Postgres text.
      if (error.code === '23505') {
        setSubmitError('You already submitted a quote for this trip.');
        setMyQuoteRequestIds((prev) => new Set(prev).add(selected!.id));
      } else {
        setSubmitError(error.message);
      }
      return;
    }
    // FIX: update local state immediately so the card behind this
    // modal already shows "Quote sent" the moment it closes — no need
    // to wait for a manual pull-to-refresh. See myQuoteRequestIds'
    // declaration above.
    setMyQuoteRequestIds((prev) => new Set(prev).add(selected!.id));
    setSubmitted(true);
  }

  // ── Not an operator or not paid ──
  if (operatorActive === false) {
    return (
      <View style={styles.blockedScreen}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtnSmall}>
          <Text style={styles.backTextSmall}><Text style={styles.backArrow}>‹</Text> Back</Text>
        </TouchableOpacity>
        <Text style={styles.blockedEmoji}>🔒</Text>
        <Text style={styles.blockedTitle}>Registration required</Text>
        <Text style={styles.blockedBody}>
          Pay the $10 yearly registration fee to start bidding on trip requests. Instant access — no waiting for approval.
        </Text>
        <View style={styles.blockedFeeBox}>
          <Text style={styles.blockedFeeLabel}>Registration fee</Text>
          <Text style={styles.blockedFeeAmount}>$10 / year</Text>
        </View>
        <TouchableOpacity
          style={styles.blockedBtn}
          onPress={() => router.push('/operator-register-pay')}
        >
          <Text style={styles.blockedBtnText}>Pay $10 and start bidding</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={() => router.push('/')}>
          <Text style={styles.blockedLink}>Back to home</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (loading || operatorActive === null) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={GOLD} />
      </View>
    );
  }

  // Filtered client-side rather than in the query: the rule has three
  // fail-open cases (operator with no base city, trip with no city,
  // either side marked Other) and expressing that as a PostgREST filter
  // would be both unreadable and easy to get subtly wrong. Trip volume
  // here is small — these are open requests, not history — so filtering
  // in JS costs nothing and keeps the rule in one testable function.
  const visibleRequests = requests.filter((r) =>
    operatorCanSeeTrip(baseCity, r.pickup_city, r.destination_city)
  );
  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()}>
          <Text style={styles.backText}><Text style={styles.backArrow}>‹</Text> Back</Text>
        </TouchableOpacity>
        <Text style={styles.heading}>Open trip requests</Text>
        {/* FIX: was "you keep 97% per job" — a stale claim from before
            the separate 3% commission was removed entirely (see
            confirm-payment.ts's trip_deposit branch). Same fix already
            applied to operator-register-pay.tsx's success screen, but
            missed here — this header is the one operators actually
            see every time they open this screen to browse trips, so
            it's arguably the more visible instance of the two. */}
        <Text style={styles.subheading}>
          {visibleRequests.length} trip{visibleRequests.length !== 1 ? 's' : ''} · you keep 100% of your quoted price
        </Text>
      </View>

      <FlatList
        data={visibleRequests}
        keyExtractor={(item) => item.id}
        style={styles.listContainer}
        contentContainerStyle={[styles.list, { paddingBottom: 16 + insets.bottom }]}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={GOLD} />}
        // Won trips sit ABOVE the open-request list deliberately: a trip
        // you have already been paid to run matters more than one you
        // might bid on, and this is the only place in the app an operator
        // can complete their half of the confirmation.
        ListHeaderComponent={
          <>
          {acceptedTrips.length > 0 ? (
            <View style={styles.wonSection}>
              <Text style={styles.wonHeading}>Your trips</Text>
              {acceptedTrips.map((t) => (
                <View key={t.quote_id} style={styles.wonCard}>
                  {cityRouteLabel(t.pickup_city, t.destination_city) ? (
                    <Text style={styles.cityRoute} numberOfLines={1}>
                      {cityRouteLabel(t.pickup_city, t.destination_city)}
                    </Text>
                  ) : null}
                  <Text style={styles.wonRoute} numberOfLines={1}>
                    {t.pickup} → {t.destination}
                  </Text>
                  <Text style={styles.wonMeta}>
                    {t.date} · ${t.price}
                  </Text>

                  {t.fullyConfirmed ? (
                    <Text style={styles.wonDone}>✓ Completed and confirmed by both of you</Text>
                  ) : t.iConfirmed ? (
                    <Text style={styles.wonWaiting}>You confirmed — waiting for your customer</Text>
                  ) : (
                    <TouchableOpacity
                      style={styles.wonBtn}
                      onPress={() =>
                        router.push(
                          `/meetpay?type=van_hire&reference_id=${t.quote_id}`
                        )
                      }
                    >
                      <Text style={styles.wonBtnText}>Trip completed</Text>
                    </TouchableOpacity>
                  )}
                </View>
              ))}
            </View>
          ) : null}

          {/* Bids that are not (yet) work. Below "Your trips" on purpose —
              a trip you have been hired for matters more than one you are
              waiting to hear about. */}
          {myQuotes.length > 0 ? (
            <View style={styles.quotesSection}>
              <Text style={styles.quotesHeading}>Your quotes</Text>
              {myQuotes.map((q) => (
                <View key={q.quote_id} style={styles.quoteCard}>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    {cityRouteLabel(q.pickup_city, q.destination_city) ? (
                      <Text style={styles.quoteCity} numberOfLines={1}>
                        {cityRouteLabel(q.pickup_city, q.destination_city)}
                      </Text>
                    ) : null}
                    <Text style={styles.quoteRoute} numberOfLines={1}>
                      {q.pickup} → {q.destination}
                    </Text>
                    <Text style={styles.quoteMeta}>{q.date} · ${q.price}</Text>
                  </View>
                  {/* Named for what it means to the operator, not for the
                      database value. 'Declined' reads as a judgement on
                      them; the customer simply chose someone else. */}
                  <View style={q.status === 'pending' ? styles.chipWaiting : styles.chipLost}>
                    <Text style={q.status === 'pending' ? styles.chipWaitingText : styles.chipLostText}>
                      {q.status === 'pending' ? 'Waiting' : 'Not selected'}
                    </Text>
                  </View>
                </View>
              ))}
            </View>
          ) : null}
          </>
        }
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyEmoji}>🛣️</Text>
            <Text style={styles.emptyText}>
              {baseCity ? `No open trips in ${baseCity} right now.` : 'No open requests right now.'}
            </Text>
            {/* Naming the city matters: without it an operator seeing an
                empty list cannot tell whether there is genuinely no work
                or whether a filter they forgot about is hiding it. */}
            <Text style={styles.emptySubtext}>
              {baseCity
                ? 'Pull down to refresh. You can change your city in your operator profile.'
                : 'Pull down to refresh.'}
            </Text>
          </View>
        }
        renderItem={({ item }) => {
          // FIX: see myQuoteRequestIds' declaration above — this is
          // what actually makes the card stop offering "Submit a
          // quote" once this operator already has.
          const alreadyQuoted = myQuoteRequestIds.has(item.id);
          return (
          <View style={styles.card}>
            {cityRouteLabel(item.pickup_city, item.destination_city) ? (
              <Text style={styles.cityRoute} numberOfLines={1}>
                {cityRouteLabel(item.pickup_city, item.destination_city)}
              </Text>
            ) : null}
            <View style={styles.routeRow}>
              <View style={styles.dotGreen} />
              <Text style={styles.routeText} numberOfLines={1}>{item.pickup}</Text>
            </View>
            <View style={styles.routeLine} />
            <View style={styles.routeRow}>
              <View style={styles.dotRed} />
              <Text style={styles.routeText} numberOfLines={1}>{item.destination}</Text>
            </View>

            <View style={styles.chips}>
              <Chip label={`📅 ${item.date}`} />
              <Chip label={`👥 ${item.passengers} pax`} />
            </View>

            {item.description ? (
              <Text style={styles.notes} numberOfLines={2}>{item.description}</Text>
            ) : null}

            {alreadyQuoted ? (
              <View style={styles.quotedBadge}>
                <Text style={styles.quotedBadgeText}>✓ Quote sent</Text>
              </View>
            ) : (
              <TouchableOpacity style={styles.bidBtn} onPress={() => openModal(item)} activeOpacity={0.85}>
                <Text style={styles.bidBtnText}>Submit a quote</Text>
              </TouchableOpacity>
            )}
          </View>
          );
        }}
      />

      {/* Quote modal */}
      <Modal visible={modalVisible} animationType="slide" transparent onRequestClose={() => setModalVisible(false)}>
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        >
          <View style={styles.modalOverlay}>
          {/* FIX: modalSheet's paddingBottom was a hardcoded per-platform
              guess (40 iOS / 24 Android), never accounting for the real
              device safe-area inset — on any phone with a gesture-nav
              bar or home indicator, "Send quote" sat partially under
              the phone's OWN system UI, not the app's bottomNav (this
              screen has no bottomNav at all — different root cause
              than the index.tsx/dealer.tsx/profile.tsx overlap bugs
              fixed earlier, same underlying mistake of not using
              insets.bottom). */}
          <View style={[styles.modalSheet, { paddingBottom: (Platform.OS === 'ios' ? 40 : 24) + insets.bottom }]}>
            {!submitted ? (
              <>
                <Text style={styles.modalTitle}>Your quote</Text>
                {selected && (
                  <Text style={styles.modalRoute}>{selected.pickup} → {selected.destination}</Text>
                )}

                <Text style={styles.modalLabel}>Your price (USD) *</Text>
                <TextInput
                  style={styles.modalInput}
                  placeholder="e.g. 35"
                  placeholderTextColor="#666"
                  value={price}
                  onChangeText={setPrice}
                  keyboardType="decimal-pad"
                />

                {/* REMOVED: the "Platform fee (3%)" preview — that
                    commission no longer exists. Operators keep their
                    full quoted price; ImbizoHub's entire take is the
                    customer's separate commitment fee (7%, capped at
                    $30), charged at
                    the deposit step, nothing owed by the operator on
                    top of what they quote. */}

                <Text style={styles.modalLabel}>Your vehicle *</Text>
                <TextInput
                  style={styles.modalInput}
                  placeholder="e.g. Toyota HiAce, 15-seater"
                  placeholderTextColor="#666"
                  value={vehicle}
                  onChangeText={setVehicle}
                />

                <Text style={styles.modalLabel}>Message (optional)</Text>
                <TextInput
                  style={[styles.modalInput, styles.modalTextArea]}
                  placeholder="Any extra info for the customer..."
                  placeholderTextColor="#666"
                  value={message}
                  onChangeText={setMessage}
                  multiline
                  numberOfLines={3}
                />

                {submitError ? (
                  <Text style={styles.submitError}>{submitError}</Text>
                ) : null}

                <View style={styles.modalActions}>
                  <TouchableOpacity style={styles.cancelBtn} onPress={() => setModalVisible(false)}>
                    <Text style={styles.cancelText}>Cancel</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.submitBtn, submitting && { opacity: 0.6 }]}
                    onPress={submitQuote}
                    disabled={submitting}
                  >
                    {submitting
                      ? <ActivityIndicator color={BLACK} />
                      : <Text style={styles.submitBtnText}>Send quote</Text>
                    }
                  </TouchableOpacity>
                </View>
              </>
            ) : (
              <View style={styles.successBox}>
                <Text style={styles.successEmoji}>✅</Text>
                <Text style={styles.successTitle}>Quote sent!</Text>
                {/* FIX: was "their deposit unlocks your contact details" —
                    leftover old terminology from before this app renamed
                    "deposit" to "commitment fee" everywhere else (see
                    quotes.tsx, operator-register-pay.tsx's Step 3, and
                    confirm-payment.ts's trip_deposit branch, all of which
                    already say "commitment fee"). This was the one screen
                    that still said "deposit" to a real user. */}
                <Text style={styles.successBody}>
                  The customer will review your bid. If they accept and pay their platform fee, you'll be notified and your contact details will be revealed.
                </Text>
                <TouchableOpacity style={styles.submitBtn} onPress={() => setModalVisible(false)}>
                  <Text style={styles.submitBtnText}>Done</Text>
                </TouchableOpacity>
              </View>
            )}
          </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

function Chip({ label }: { label: string }) {
  return (
    <View style={styles.chip}>
      <Text style={styles.chipText}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#111111' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#111111' },

  header: {
    backgroundColor: BLACK,
    paddingTop: Platform.OS === 'ios' ? 56 : 32,
    paddingBottom: 20, paddingHorizontal: 20,
    borderBottomWidth: 0.5, borderBottomColor: DARK,
  },
  backText: { color: GREY, fontSize: 14, marginBottom: 12 },
  // NEW: bigger than the label text so the '‹' glyph reads clearly — direct product decision ("back symbol too small").
  backArrow: { fontSize: 20 },
  heading: { color: '#fff', fontSize: 22, fontWeight: '800' },
  subheading: { color: GREY, fontSize: 13, marginTop: 4 },
  wonSection: { marginBottom: 20 },
  wonHeading: { color: '#fff', fontSize: 16, fontWeight: '700', marginBottom: 10 },
  wonCard: { backgroundColor: DARK, borderRadius: 12, padding: 14, marginBottom: 10, borderWidth: 1, borderColor: GOLD },
  wonRoute: { color: '#fff', fontSize: 15, fontWeight: '600' },
  wonMeta: { color: GREY, fontSize: 13, marginTop: 4 },
  wonBtn: { backgroundColor: GOLD, borderRadius: 8, paddingVertical: 11, alignItems: 'center', marginTop: 12 },
  wonBtnText: { color: BLACK, fontSize: 14, fontWeight: '700' },
  wonWaiting: { color: GREY, fontSize: 13, marginTop: 12, fontStyle: 'italic' },
  wonDone: { color: GREEN, fontSize: 13, fontWeight: '600', marginTop: 12 },

  // FIX (same bug class already caught in my-wanted-posts.tsx /
  // browse-wanted.tsx): a FlatList's contentContainerStyle used
  // `gap: 14` — a documented cross-platform reliability quirk at list
  // boundaries, not something to trust for vertical spacing here.
  // Replaced with marginBottom on the card style itself, matching the
  // already-established, proven fix.
  // FIX: FlatList had no `style`, only `contentContainerStyle` — without
  // a bounded height/flex, React Native sizes it to its full content
  // height instead of the remaining screen space below the header. With
  // only 2-3 open requests this looked fine (content fit on one
  // screen), but with more items the list wouldn't actually be
  // scrollable — the extra cards would render past the screen edge
  // with no way to reach them. Also added insets.bottom to the
  // content's bottom padding (matching browse-wanted.tsx's existing
  // pattern) so the last card doesn't sit flush against the phone's
  // home-indicator/gesture bar.
  listContainer: { flex: 1 },
  list: { padding: 16 },
  quotesSection: { marginBottom: 18 },
  quotesHeading: { color: '#888', fontSize: 12, fontWeight: '800', letterSpacing: 0.5, textTransform: 'uppercase', marginBottom: 8 },
  quoteCard: { backgroundColor: DARK, borderRadius: 12, padding: 12, marginBottom: 8, flexDirection: 'row', alignItems: 'center', gap: 10, borderWidth: 0.5, borderColor: '#2a2a2a' },
  quoteCity: { color: '#777', fontSize: 10, fontWeight: '800', letterSpacing: 0.4, textTransform: 'uppercase', marginBottom: 3 },
  quoteRoute: { color: '#ddd', fontSize: 13, fontWeight: '600' },
  quoteMeta: { color: '#666', fontSize: 11, marginTop: 2 },
  chipWaiting: { backgroundColor: '#2a2410', borderRadius: 20, paddingHorizontal: 10, paddingVertical: 4, borderWidth: 0.5, borderColor: '#5a4a12' },
  chipWaitingText: { color: GOLD, fontSize: 10, fontWeight: '800' },
  chipLost: { backgroundColor: '#241a1a', borderRadius: 20, paddingHorizontal: 10, paddingVertical: 4, borderWidth: 0.5, borderColor: '#4a2a2a' },
  chipLostText: { color: '#b98080', fontSize: 10, fontWeight: '800' },
  cityRoute: { color: GOLD, fontSize: 12, fontWeight: '800', letterSpacing: 0.4, textTransform: 'uppercase', marginBottom: 8 },
  card: {
    backgroundColor: BLACK, borderRadius: 14, padding: 16,
    borderWidth: 0.5, borderColor: '#333', marginBottom: 14,
  },
  routeRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  dotGreen: { width: 10, height: 10, borderRadius: 5, backgroundColor: GREEN },
  dotRed: { width: 10, height: 10, borderRadius: 5, backgroundColor: '#f44336' },
  routeLine: { width: 2, height: 14, backgroundColor: '#333', marginLeft: 4, marginVertical: 3 },
  routeText: { fontSize: 15, fontWeight: '600', color: '#fff', flex: 1 },
  chips: { flexDirection: 'row', gap: 8, marginTop: 12, flexWrap: 'wrap' },
  chip: { backgroundColor: DARK, borderRadius: 20, paddingHorizontal: 10, paddingVertical: 4, borderWidth: 0.5, borderColor: '#333' },
  chipText: { fontSize: 12, color: GREY },
  notes: { fontSize: 13, color: GREY, marginTop: 10, lineHeight: 18 },
  bidBtn: { marginTop: 14, backgroundColor: GOLD, borderRadius: 10, paddingVertical: 12, alignItems: 'center' },
  bidBtnText: { color: BLACK, fontWeight: '800', fontSize: 14 },
  // Same colors/shape as browse-wanted.tsx's respondedBadge, for the
  // same "you already acted on this" state.
  quotedBadge: { marginTop: 14, backgroundColor: '#1a2a1a', borderRadius: 10, paddingVertical: 12, alignItems: 'center', borderWidth: 0.5, borderColor: '#2a4a2a' },
  quotedBadgeText: { color: GREEN, fontWeight: '700', fontSize: 13 },

  empty: { alignItems: 'center', paddingTop: 60 },
  emptyEmoji: { fontSize: 40, marginBottom: 12 },
  emptyText: { fontSize: 16, color: '#fff', fontWeight: '600' },
  emptySubtext: { fontSize: 13, color: GREY, marginTop: 6 },

  // Blocked screen
  blockedScreen: { flex: 1, backgroundColor: '#111111', padding: 28, paddingTop: 60 },
  backBtnSmall: { marginBottom: 28 },
  backTextSmall: { color: GREY, fontSize: 14 },
  blockedEmoji: { fontSize: 52, marginBottom: 14 },
  blockedTitle: { fontSize: 24, fontWeight: '800', color: '#fff', marginBottom: 10 },
  blockedBody: { fontSize: 15, color: GREY, lineHeight: 22, marginBottom: 20 },
  blockedFeeBox: {
    backgroundColor: BLACK, borderRadius: 14, padding: 18, marginBottom: 24,
    borderWidth: 0.5, borderColor: '#333',
    alignItems: 'center',
  },
  blockedFeeLabel: { fontSize: 12, color: GREY, marginBottom: 4 },
  blockedFeeAmount: { fontSize: 32, fontWeight: '800', color: '#fff', marginBottom: 4 },
  blockedFeeNote: { fontSize: 12, color: GREY },
  blockedBtn: { backgroundColor: GOLD, borderRadius: 14, paddingVertical: 16, alignItems: 'center', marginBottom: 14 },
  blockedBtnText: { color: BLACK, fontSize: 16, fontWeight: '800' },
  blockedLink: { color: GREY, fontSize: 14, textAlign: 'center' },

  // Modal
  modalOverlay: { flex: 1, width: '100%', backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end', alignItems: 'center' },
  modalSheet: { width: '100%', maxWidth: 640, alignSelf: 'center',
    backgroundColor: BLACK, borderTopLeftRadius: 20, borderTopRightRadius: 20,
    padding: 24, paddingBottom: Platform.OS === 'ios' ? 40 : 24,
  },
  modalTitle: { fontSize: 18, fontWeight: '800', color: '#fff', marginBottom: 4 },
  modalRoute: { fontSize: 13, color: GREY, marginBottom: 16 },
  modalLabel: { fontSize: 13, fontWeight: '700', color: '#fff', marginBottom: 6, marginTop: 14 },
  modalInput: {
    backgroundColor: DARK, borderRadius: 10,
    paddingHorizontal: 14, paddingVertical: Platform.OS === 'ios' ? 13 : 10,
    fontSize: 14, color: '#fff', borderWidth: 0.5, borderColor: '#333',
  },
  modalTextArea: { height: 90, textAlignVertical: 'top', paddingTop: 10 },
  submitError: { color: RED, fontSize: 13, marginTop: 10 },
  modalActions: { flexDirection: 'row', gap: 12, marginTop: 20 },
  cancelBtn: { flex: 1, borderRadius: 10, paddingVertical: 13, alignItems: 'center', backgroundColor: DARK },
  cancelText: { color: GREY, fontWeight: '600' },
  submitBtn: { flex: 2, borderRadius: 10, paddingVertical: 13, alignItems: 'center', backgroundColor: GOLD },
  submitBtnText: { color: BLACK, fontWeight: '800', fontSize: 15 },

  successBox: { alignItems: 'center', paddingVertical: 16 },
  successEmoji: { fontSize: 48, marginBottom: 12 },
  successTitle: { fontSize: 20, fontWeight: '800', color: '#fff', marginBottom: 8 },
  successBody: { fontSize: 14, color: GREY, textAlign: 'center', lineHeight: 20, marginBottom: 24 },
});
