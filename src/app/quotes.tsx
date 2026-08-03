// app/quotes.tsx
// Customer sees quotes, accepts one, pays 10% deposit → contact revealed
// Remaining 90% paid cash or through app (operator's choice)
//
// FIX: handlePayDeposit() previously did an instant client-side
// `.update({ deposit_paid: true, ... })` — no real payment was ever
// collected. This is the exact same placeholder pattern unlock.tsx and
// delivery-operator-register-pay.tsx used to have before being migrated
// to real Paynow, apparently never applied here too. Rewritten to follow
// the same proven pattern: create-payment → real Paynow checkout →
// poll payment_intents → paynow-webhook performs the actual DB writes
// (quotes accepted/deposit_paid, siblings declined, request filled,
// transaction logged) only once Paynow itself confirms payment.

import { useRouter } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Modal,
  Platform,
  RefreshControl,
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
const GREEN = '#4fc96e';
const BLUE = '#4A90D9';
const DEPOSIT_PCT = 0.10;
const COMMISSION_PCT = 0.03;

const POLL_INTERVAL_MS = 2000;
const POLL_MAX_ATTEMPTS = 20; // ~40 seconds total — was 15 (~30s); a real
// trip_deposit payment took 32s to confirm and got missed by 2s under
// the old window, showing a false "not received" to a buyer whose
// payment had actually succeeded. Widened for margin.

type Quote = {
  id: string;
  request_id: string;
  operator_id: string;
  price: number;
  vehicle: string;
  message: string;
  status: string;
  deposit_paid: boolean;
  created_at: string;
  operator_name?: string;
  operator_phone?: string;
};

type Request = {
  id: string;
  pickup: string;
  destination: string;
  date: string;
  passengers: number;
  status: string;
};

export default function QuotesScreen() {
  const router = useRouter();
  const [request, setRequest] = useState<Request | null>(null);
  const [quotes, setQuotes] = useState<Quote[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [myId, setMyId] = useState('');
  const [myEmail, setMyEmail] = useState('');

  const [modalVisible, setModalVisible] = useState(false);
  const [chosenQuote, setChosenQuote] = useState<Quote | null>(null);
  const [step, setStep] = useState<'confirm' | 'paying' | 'revealed'>('confirm');
  const [paying, setPaying] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [payError, setPayError] = useState('');

  useEffect(() => { loadData(); }, []);

  async function loadData() {
    setLoading(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setLoading(false); return; }
    setMyId(user.id);
    setMyEmail(user.email ?? '');

    const { data: req } = await supabase
      .from('requests')
      .select('*')
      .eq('user_id', user.id)
      .eq('status', 'open')
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (!req) { setLoading(false); return; }
    setRequest(req);

    // FIX: same bug class just found and confirmed live in
    // wanted-responses.tsx. This embedded profiles via
    // `profiles:operator_id (full_name, phone)`, which requires an
    // actual declared foreign key between quotes and profiles —
    // quotes.operator_id references auth.users(id), not profiles(id),
    // matching the same pattern confirmed broken for
    // item_responses.responder_id. This was never caught because the
    // query's error was never checked, and because this screen was
    // never actually tested live before today — meaning van-hire quotes
    // have very likely never shown an operator's name or phone number
    // correctly in production, this whole time.
    //
    // Fixed the same way: two separate queries instead of relying on an
    // embed that can't actually resolve.
    const { data: quotesData, error: quotesError } = await supabase
      .from('quotes')
      .select('*')
      .eq('request_id', req.id)
      .order('price', { ascending: true });

    if (quotesError) {
      console.log('loadData quotes error:', quotesError.message);
      setQuotes([]);
      setLoading(false);
      return;
    }

    const operatorIds = [...new Set((quotesData ?? []).map((q: any) => q.operator_id))];
    const profileMap: Record<string, { full_name: string; phone: string }> = {};
    if (operatorIds.length > 0) {
      const { data: profiles } = await supabase
        .from('profiles')
        .select('id, full_name, phone')
        .in('id', operatorIds);
      (profiles ?? []).forEach((p: any) => { profileMap[p.id] = { full_name: p.full_name, phone: p.phone }; });
    }

    setQuotes((quotesData ?? []).map((q: any) => ({
      ...q,
      operator_name: profileMap[q.operator_id]?.full_name ?? 'Operator',
      operator_phone: profileMap[q.operator_id]?.phone ?? '',
    })));
    setLoading(false);
  }

  async function handleRefresh() {
    setRefreshing(true);
    await loadData();
    setRefreshing(false);
  }

  function openModal(quote: Quote) {
    setChosenQuote(quote);
    // If this quote is already accepted+paid (the "View contact
    // details" button on an accepted card), skip straight to the
    // revealed step instead of showing the payment screen again.
    setStep(quote.status === 'accepted' && quote.deposit_paid ? 'revealed' : 'confirm');
    setPayError('');
    setModalVisible(true);
  }

  async function handlePayDeposit() {
    if (!chosenQuote || !request) return;
    setPayError('');

    const { data: { user } } = await supabase.auth.getUser();

    // FIX: paying a real deposit is exactly the kind of "deal" moment
    // that should require a real account, per the same principle applied
    // throughout the app — browsing, posting, and chatting are all free
    // and anonymous-friendly, but money changing hands needs someone
    // reachable/accountable, not a throwaway anonymous session with no
    // way to recover it if the browser is cleared. Redirect to register
    // rather than silently doing nothing.
    if (!user || user.is_anonymous) {
      setModalVisible(false);
      router.push('/register');
      return;
    }

    setPaying(true);

    const deposit = parseFloat((chosenQuote.price * DEPOSIT_PCT).toFixed(2));

    const { data, error: fnError } = await supabase.functions.invoke('create-payment', {
      body: {
        kind: 'trip_deposit',
        amount: deposit,
        email: myEmail,
        trip_request_id: request.id,
        trip_quote_id: chosenQuote.id,
        buyer_id: user.id,
        seller_id: chosenQuote.operator_id,
      },
    });

    if (fnError || !data?.checkoutUrl) {
      setPayError(fnError?.message || data?.error || 'Could not start payment. Please try again.');
      setPaying(false);
      return;
    }

    const { reference, checkoutUrl } = data;

    // Open Paynow's real checkout page. This app has no visibility into
    // what happens there and must not assume success just because the
    // browser closed — only the webhook confirms that (see
    // pollForPaid below).
    await WebBrowser.openBrowserAsync(checkoutUrl);

    setPaying(false);
    setVerifying(true);
    setStep('paying');

    const paid = await pollForPaid(reference);

    setVerifying(false);

    if (paid) {
      setStep('revealed');
      await loadData(); // pick up the server-confirmed quote/request state
    } else {
      setStep('confirm');
      setPayError(
        'We haven\'t received confirmation of your payment yet. If you completed an EcoCash prompt on your phone, it can take a moment — try again in a few seconds, or check your Paynow confirmation email.'
      );
    }
  }

  async function pollForPaid(reference: string): Promise<boolean> {
    for (let attempt = 0; attempt < POLL_MAX_ATTEMPTS; attempt++) {
      const { data } = await supabase
        .from('payment_intents')
        .select('status')
        .eq('our_reference', reference)
        .maybeSingle();

      if (data?.status === 'paid') return true;
      if (data?.status === 'error' || data?.status === 'cancelled') return false;

      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
    }
    return false;
  }

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={GOLD} />
        <Text style={styles.loadingText}>Loading quotes…</Text>
      </View>
    );
  }

  const deposit = chosenQuote ? (chosenQuote.price * DEPOSIT_PCT).toFixed(2) : '0';
  const balance = chosenQuote ? (chosenQuote.price * (1 - DEPOSIT_PCT)).toFixed(2) : '0';

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()}>
          <Text style={styles.backText}>← Back</Text>
        </TouchableOpacity>
        <Text style={styles.heading}>Quotes for your trip</Text>
        {request && (
          <Text style={styles.subheading}>
            {request.pickup} → {request.destination} · {request.date}
          </Text>
        )}
      </View>

      {!request ? (
        <View style={styles.center}>
          <Text style={styles.emptyText}>No active requests found.</Text>
          <TouchableOpacity style={styles.actionBtn} onPress={() => router.push('/hirevan')}>
            <Text style={styles.actionBtnText}>Post a trip</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          data={quotes}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.list}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={GOLD} />}
          ListHeaderComponent={
            quotes.length > 0 ? (
              <View style={styles.infoBar}>
                <Text style={styles.infoBarText}>
                  {quotes.length} quote{quotes.length !== 1 ? 's' : ''} · sorted cheapest first · accept to pay 10% deposit
                </Text>
              </View>
            ) : null
          }
          ListEmptyComponent={
            <View style={styles.emptyBox}>
              <Text style={styles.emptyEmoji}>⏳</Text>
              <Text style={styles.emptyText}>No quotes yet.</Text>
              <Text style={styles.emptySubtext}>Operators will submit bids shortly. Pull down to refresh.</Text>
            </View>
          }
          renderItem={({ item, index }) => {
            const isBest = index === 0 && item.status !== 'declined';
            const isAccepted = item.status === 'accepted';
            const isDeclined = item.status === 'declined';
            const dep = (item.price * DEPOSIT_PCT).toFixed(2);

            return (
              <View style={[
                styles.card,
                isBest && !isDeclined && styles.cardBest,
                isAccepted && styles.cardAccepted,
                isDeclined && styles.cardDeclined,
              ]}>
                {isBest && !isDeclined && (
                  <View style={styles.bestBadge}><Text style={styles.bestBadgeText}>⭐ Best price</Text></View>
                )}
                {isAccepted && (
                  <View style={styles.acceptedBadge}><Text style={styles.acceptedBadgeText}>✓ Accepted</Text></View>
                )}

                <View style={styles.quoteTop}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.operatorName}>{item.operator_name}</Text>
                    <Text style={styles.vehicleText}>{item.vehicle}</Text>
                  </View>
                  <View style={{ alignItems: 'flex-end' }}>
                    <Text style={styles.priceText}>${item.price}</Text>
                    <Text style={styles.depositHint}>Deposit: ${dep}</Text>
                  </View>
                </View>

                {item.message ? <Text style={styles.messageText}>"{item.message}"</Text> : null}

                {!isDeclined && !isAccepted && request.status === 'open' && (
                  <TouchableOpacity style={styles.pickBtn} onPress={() => openModal(item)} activeOpacity={0.85}>
                    <Text style={styles.pickBtnText}>Accept — pay ${dep} deposit</Text>
                  </TouchableOpacity>
                )}

                {isAccepted && item.deposit_paid && (
                  <TouchableOpacity style={styles.pickBtn} onPress={() => openModal(item)} activeOpacity={0.85}>
                    <Text style={styles.pickBtnText}>View contact details</Text>
                  </TouchableOpacity>
                )}
              </View>
            );
          }}
        />
      )}

      {/* Modal */}
      <Modal visible={modalVisible} animationType="slide" transparent onRequestClose={() => setModalVisible(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalSheet}>

            {(step === 'confirm' || step === 'paying') && chosenQuote && (
              <>
                <Text style={styles.modalTitle}>Confirm booking</Text>
                <Text style={styles.modalSub}>Pay a 10% deposit to lock in this operator and reveal their contact details.</Text>

                {/* Summary */}
                <View style={styles.summaryBox}>
                  <SummaryRow label="Operator" value={chosenQuote.operator_name ?? ''} />
                  <SummaryRow label="Vehicle" value={chosenQuote.vehicle} />
                  <SummaryRow label="Total fare" value={`$${chosenQuote.price}`} />
                  <View style={styles.divider} />
                  <SummaryRow label="Deposit now (10%)" value={`$${deposit}`} gold />
                  <SummaryRow label="Balance remaining (90%)" value={`$${balance}`} />
                </View>

                {/* Balance payment options */}
                {/* FIX: this box used to also offer a "Pay through the
                    app" option describing funds being "held safely —
                    released when trip is confirmed complete" — i.e.
                    escrow. Escrow was never actually built (no code
                    path implements it anywhere in this app), and per a
                    deliberate product decision it never will be, due to
                    the licensing/regulatory burden of holding customer
                    funds in trust — a burden that only grows with
                    multi-country expansion (separate financial
                    regulators, exchange-control rules, and AML/KYC
                    obligations in each new country), not shrinks. This
                    text was describing a real, selectable-sounding
                    option to real users for something that was pure
                    fiction — removed entirely rather than reworded,
                    since there's nothing accurate left to say about it. */}
                <View style={styles.paymentOptionsBox}>
                  <Text style={styles.paymentOptionsTitle}>How to pay the ${balance} balance</Text>
                  <View style={styles.paymentOption}>
                    <Text style={styles.paymentOptionIcon}>💵</Text>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.paymentOptionTitle}>Pay the operator directly</Text>
                      <Text style={styles.paymentOptionDesc}>Cash, EcoCash, or bank transfer — hand over or send payment when you meet. ImbizoHub isn't involved in this part of the payment.</Text>
                    </View>
                  </View>
                  <Text style={styles.paymentNote}>You and the operator agree on the exact method directly.</Text>
                </View>

                {payError ? <Text style={styles.payErrorText}>⚠️ {payError}</Text> : null}

                <TouchableOpacity
                  style={[styles.payBtn, (paying || verifying) && { opacity: 0.6 }]}
                  onPress={handlePayDeposit}
                  disabled={paying || verifying}
                >
                  {paying ? (
                    <ActivityIndicator color={BLACK} />
                  ) : verifying ? (
                    <>
                      <ActivityIndicator color={BLACK} />
                      <Text style={styles.payBtnSub}>Confirming your payment…</Text>
                    </>
                  ) : (
                    <Text style={styles.payBtnText}>Pay ${deposit} deposit</Text>
                  )}
                </TouchableOpacity>

                <TouchableOpacity style={styles.cancelLink} onPress={() => setModalVisible(false)} disabled={paying || verifying}>
                  <Text style={styles.cancelLinkText}>Cancel</Text>
                </TouchableOpacity>
              </>
            )}

            {step === 'revealed' && chosenQuote && (
              <>
                <Text style={styles.modalTitle}>Booking confirmed 🎉</Text>
                <Text style={styles.modalSub}>Deposit paid. Here are your operator's contact details.</Text>

                <View style={styles.contactBox}>
                  <Text style={styles.contactLabel}>Operator</Text>
                  <Text style={styles.contactName}>{chosenQuote.operator_name}</Text>
                  <View style={styles.contactDivider} />
                  <Text style={styles.contactLabel}>Phone number</Text>
                  <Text style={styles.contactPhone}>{chosenQuote.operator_phone || 'Not provided'}</Text>
                </View>

                <View style={styles.balanceReminder}>
                  <Text style={styles.balanceReminderText}>
                    💡 Remaining balance: <Text style={{ fontWeight: '700' }}>${balance}</Text>{'\n'}
                    Pay cash on the day or ask your operator about paying through the app for added security.
                  </Text>
                </View>

                <TouchableOpacity
                  style={styles.meetPayBtn}
                  onPress={() => {
                    setModalVisible(false);
                    router.push(
                      `/meetpay?type=van_hire&reference_id=${chosenQuote.id}&seller_id=${chosenQuote.operator_id}&amount=${balance}`
                    );
                  }}
                >
                  <Text style={styles.meetPayBtnText}>🔒 Meet & Pay (confirm trip complete)</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={styles.payBtn}
                  onPress={() => {
                    setModalVisible(false);
                    if (request && chosenQuote) {
                      router.push(`/chat?request_id=${request.id}&receiver_id=${chosenQuote.operator_id}`);
                    }
                  }}
                >
                  <Text style={styles.payBtnText}>Chat with operator</Text>
                </TouchableOpacity>

                <TouchableOpacity style={styles.cancelLink} onPress={() => setModalVisible(false)}>
                  <Text style={styles.cancelLinkText}>Close</Text>
                </TouchableOpacity>
              </>
            )}

          </View>
        </View>
      </Modal>
    </View>
  );
}

function SummaryRow({ label, value, gold }: { label: string; value: string; gold?: boolean }) {
  return (
    <View style={styles.summaryRow}>
      <Text style={styles.summaryLabel}>{label}</Text>
      <Text style={[styles.summaryValue, gold && { color: GOLD, fontWeight: '700' }]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#111111' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 16, backgroundColor: '#111111' },
  loadingText: { color: GREY, fontSize: 14 },

  header: {
    backgroundColor: BLACK,
    paddingTop: Platform.OS === 'ios' ? 56 : 32,
    paddingBottom: 20, paddingHorizontal: 20,
    borderBottomWidth: 0.5, borderBottomColor: DARK,
  },
  backText: { color: GREY, fontSize: 14, marginBottom: 12 },
  heading: { color: '#fff', fontSize: 22, fontWeight: '800' },
  subheading: { color: GREY, fontSize: 13, marginTop: 4 },

  infoBar: { backgroundColor: '#1a1a2e', borderRadius: 10, padding: 10, marginBottom: 8, borderWidth: 0.5, borderColor: '#3a3a5e' },
  infoBarText: { color: '#8888ff', fontSize: 12, textAlign: 'center' },

  list: { padding: 16, gap: 14, paddingBottom: 40 },

  card: {
    backgroundColor: BLACK, borderRadius: 14, padding: 16,
    borderWidth: 1.5, borderColor: '#333',
  },
  cardBest: { borderColor: GREEN },
  cardAccepted: { borderColor: BLUE },
  cardDeclined: { opacity: 0.4 },

  bestBadge: { alignSelf: 'flex-start', backgroundColor: '#1a2a1a', borderRadius: 20, paddingHorizontal: 10, paddingVertical: 3, marginBottom: 10 },
  bestBadgeText: { color: GREEN, fontSize: 11, fontWeight: '700' },
  acceptedBadge: { alignSelf: 'flex-start', backgroundColor: '#1a2535', borderRadius: 20, paddingHorizontal: 10, paddingVertical: 3, marginBottom: 10 },
  acceptedBadgeText: { color: BLUE, fontSize: 11, fontWeight: '700' },

  quoteTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 },
  operatorName: { fontSize: 15, fontWeight: '700', color: '#fff' },
  vehicleText: { fontSize: 13, color: GREY, marginTop: 2 },
  priceText: { fontSize: 24, fontWeight: '800', color: GOLD },
  depositHint: { fontSize: 11, color: GREY, marginTop: 2 },
  messageText: { fontSize: 13, color: '#ccc', fontStyle: 'italic', marginBottom: 8, lineHeight: 18 },

  pickBtn: { backgroundColor: GOLD, borderRadius: 10, paddingVertical: 13, alignItems: 'center', marginTop: 10 },
  pickBtnText: { color: BLACK, fontWeight: '800', fontSize: 14 },

  emptyBox: { alignItems: 'center', paddingTop: 60, paddingHorizontal: 24 },
  emptyEmoji: { fontSize: 48, marginBottom: 12 },
  emptyText: { fontSize: 16, color: '#fff', fontWeight: '600' },
  emptySubtext: { fontSize: 13, color: GREY, marginTop: 8, textAlign: 'center', lineHeight: 18 },

  actionBtn: { backgroundColor: GOLD, borderRadius: 10, paddingHorizontal: 24, paddingVertical: 12 },
  actionBtnText: { color: BLACK, fontWeight: '700' },

  // Modal
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
  modalSheet: {
    backgroundColor: BLACK, borderTopLeftRadius: 22, borderTopRightRadius: 22,
    padding: 24, paddingBottom: Platform.OS === 'ios' ? 44 : 24,
    maxHeight: '90%',
  },
  modalTitle: { fontSize: 20, fontWeight: '800', color: '#fff', marginBottom: 6 },
  modalSub: { fontSize: 13, color: GREY, lineHeight: 19, marginBottom: 18 },

  summaryBox: { backgroundColor: DARK, borderRadius: 12, padding: 14, marginBottom: 14, borderWidth: 0.5, borderColor: '#333' },
  summaryRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8 },
  summaryLabel: { fontSize: 13, color: GREY },
  summaryValue: { fontSize: 13, color: '#fff' },
  divider: { height: 1, backgroundColor: '#333', marginVertical: 8 },

  paymentOptionsBox: { backgroundColor: '#1a1a2e', borderRadius: 12, padding: 14, marginBottom: 16, borderWidth: 0.5, borderColor: '#3a3a5e' },
  paymentOptionsTitle: { fontSize: 13, fontWeight: '700', color: '#fff', marginBottom: 10 },
  paymentOption: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, marginBottom: 10 },
  paymentOptionIcon: { fontSize: 20, width: 28 },
  paymentOptionTitle: { fontSize: 13, fontWeight: '600', color: '#fff' },
  paymentOptionDesc: { fontSize: 12, color: GREY, marginTop: 2, lineHeight: 16 },
  paymentNote: { fontSize: 11, color: '#8888ff', marginTop: 4, fontStyle: 'italic' },

  payErrorText: { color: '#ff8a8a', fontSize: 13, marginBottom: 12, textAlign: 'center' },

  payBtn: { backgroundColor: GOLD, borderRadius: 12, paddingVertical: 15, alignItems: 'center', marginBottom: 12, flexDirection: 'row', justifyContent: 'center', gap: 8 },
  payBtnText: { color: BLACK, fontWeight: '800', fontSize: 16 },
  payBtnSub: { color: '#5a4400', fontSize: 12 },
  meetPayBtn: { backgroundColor: 'transparent', borderRadius: 12, paddingVertical: 15, alignItems: 'center', marginBottom: 12, borderWidth: 1.5, borderColor: GOLD },
  meetPayBtnText: { color: GOLD, fontWeight: '700', fontSize: 15 },
  cancelLink: { alignItems: 'center', paddingVertical: 8 },
  cancelLinkText: { color: GREY, fontSize: 14 },

  contactBox: {
    backgroundColor: '#1a2a1a', borderRadius: 12, padding: 20,
    alignItems: 'center', marginBottom: 14, borderWidth: 0.5, borderColor: '#2a4a2a',
  },
  contactLabel: { fontSize: 11, color: GREY, marginBottom: 4 },
  contactName: { fontSize: 18, fontWeight: '700', color: GREEN },
  contactDivider: { height: 1, backgroundColor: '#2a4a2a', width: '100%', marginVertical: 12 },
  contactPhone: { fontSize: 28, fontWeight: '800', color: GREEN },

  balanceReminder: { backgroundColor: '#3a2800', borderRadius: 10, padding: 12, marginBottom: 16, borderWidth: 0.5, borderColor: '#5a4400' },
  balanceReminderText: { fontSize: 13, color: GOLD, lineHeight: 20 },
});
