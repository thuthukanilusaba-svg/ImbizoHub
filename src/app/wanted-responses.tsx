// app/wanted-responses.tsx
// Buyer views responses to their "wanted" post and accepts one, paying
// a small commission to unlock chat with that seller — same
// unlock-fee-style pattern as unlock.tsx, just for the Wanted flow
// instead of a regular listing.
//
// REAL PAYNOW INTEGRATION: handleAccept() calls the create-payment Edge
// Function, opens the real Paynow checkout, and polls payment_intents
// for confirmation. The actual item_responses/item_requests updates
// (accepted response, declined siblings, request marked matched) are
// performed by the paynow-webhook Edge Function once Paynow confirms
// payment, never by this screen directly.
//
// FIX (real security gap, found while building my-wanted-posts.tsx):
// loadData() only ever checked that SOME user was logged in, then
// fetched and displayed whatever item_requests row matched the
// request_id in the URL — with no check that the logged-in user was
// actually the person who posted that request. Anyone who was logged
// in and knew or guessed a request_id could view another buyer's
// responses (seller names, prices, messages) and could very likely
// still trigger a real payment/accept on someone else's want, since
// handleAccept() also never checked ownership. Now redirects home with
// no data shown if request.user_id doesn't match the logged-in user.

import { useLocalSearchParams, useRouter } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator, FlatList, Platform, StyleSheet,
  Text, TouchableOpacity, View,
} from 'react-native';
import { supabase } from '../../lib/supabase';

const GOLD = '#B8860B';
const BLACK = '#1A1A18';
const DARK = '#2a2a2a';
const GREY = '#AAAAAA';
const GREEN = '#4fc96e';

const POLL_INTERVAL_MS = 2000;
const POLL_MAX_ATTEMPTS = 20; // ~40 seconds total — matches the same
// widened window applied across every other payment screen today, after
// a real trip_deposit payment on quotes.tsx took 32s to confirm and got
// missed under the old 15-attempt (~30s) window.

export default function WantedResponsesScreen() {
  const router = useRouter();
  const { request_id } = useLocalSearchParams<{ request_id: string }>();

  const [loading, setLoading] = useState(true);
  const [request, setRequest] = useState<any>(null);
  const [responses, setResponses] = useState<any[]>([]);
  const [myId, setMyId] = useState('');
  const [myEmail, setMyEmail] = useState('');
  // NEW: distinguishes "still loading" from "loaded, but this isn't
  // your request" — see the ownership check below.
  const [notYours, setNotYours] = useState(false);

  const [acceptingId, setAcceptingId] = useState<string | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => { loadData(); }, []);

  async function loadData() {
    setLoading(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { router.replace('/login'); return; }
    setMyId(user.id);
    setMyEmail(user.email ?? '');

    const { data: req } = await supabase
      .from('item_requests')
      .select('*')
      .eq('id', request_id)
      .maybeSingle();

    // FIX: ownership check — this screen shows seller names, prices,
    // and messages, and lets the viewer trigger a real payment. Without
    // this check, any logged-in user who knew or guessed a request_id
    // could view and potentially act on someone else's want.
    if (!req || req.user_id !== user.id) {
      setNotYours(true);
      setLoading(false);
      return;
    }

    setRequest(req);

    const { data: resps } = await supabase
      .from('item_responses')
      .select('*')
      .eq('item_request_id', request_id)
      .order('price', { ascending: true });

    // Same class of bug already found and fixed elsewhere today
    // (quotes.tsx, wanted-responses.tsx itself per the header comment
    // above) — an embedded profiles select via a declared foreign key
    // that doesn't actually exist between item_responses and profiles.
    // Two separate queries instead.
    const responderIds = [...new Set((resps ?? []).map((r: any) => r.responder_id))];
    const profileMap: Record<string, { full_name: string }> = {};
    if (responderIds.length > 0) {
      const { data: profiles } = await supabase
        .from('profiles')
        .select('id, full_name')
        .in('id', responderIds);
      (profiles ?? []).forEach((p: any) => { profileMap[p.id] = { full_name: p.full_name }; });
    }

    setResponses((resps ?? []).map((r: any) => ({
      ...r,
      responder_name: profileMap[r.responder_id]?.full_name ?? 'Seller',
    })));
    setLoading(false);
  }

  async function handleAccept(response: any) {
    // FIX: same ownership guard as loadData() — belt-and-braces in case
    // this function is ever called from somewhere that skips loadData's
    // check. myId is only ever set once loadData confirms ownership, so
    // this is a cheap, safe no-op guard rather than a redundant query.
    if (!request || request.user_id !== myId) return;

    setError('');
    setAcceptingId(response.id);

    const commission = parseFloat((response.price * 0.05).toFixed(2));

    const { data, error: fnError } = await supabase.functions.invoke('create-payment', {
      body: {
        kind: 'wanted_request_match',
        amount: commission,
        email: myEmail,
        item_request_id: request_id,
        item_response_id: response.id,
        buyer_id: myId,
        seller_id: response.responder_id,
      },
    });

    if (fnError || !data?.checkoutUrl) {
      setError(fnError?.message || data?.error || 'Could not start payment. Please try again.');
      setAcceptingId(null);
      return;
    }

    const { reference, checkoutUrl } = data;

    await WebBrowser.openBrowserAsync(checkoutUrl);

    setAcceptingId(null);
    setVerifying(true);

    const paid = await pollForPaid(reference);

    setVerifying(false);

    if (paid) {
      router.replace(`/chat?item_request_id=${request_id}&receiver_id=${response.responder_id}`);
    } else {
      setError(
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
      </View>
    );
  }

  // NEW: shown instead of any request/response data when the logged-in
  // user isn't the one who posted this request — see FIX comment above.
  if (notYours) {
    return (
      <View style={styles.container}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Text style={styles.backText}>← Back</Text>
        </TouchableOpacity>
        <View style={styles.center}>
          <Text style={styles.emptyText}>This isn't your wanted post.</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
        <Text style={styles.backText}>← Back</Text>
      </TouchableOpacity>

      <Text style={styles.heading}>Responses to your want</Text>
      {request ? <Text style={styles.subheading}>{request.title}</Text> : null}

      {error ? (
        <View style={styles.errorBox}><Text style={styles.errorText}>⚠️ {error}</Text></View>
      ) : null}

      <FlatList
        data={responses}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        ListEmptyComponent={
          <Text style={styles.emptyText}>No responses yet — sellers will see your want and respond with a price.</Text>
        }
        renderItem={({ item }) => {
          const isAccepting = acceptingId === item.id;
          return (
            <View style={styles.card}>
              <Text style={styles.sellerName}>{item.responder_name}</Text>
              <Text style={styles.priceLabel}>Their price</Text>
              <Text style={styles.priceValue}>${item.price}</Text>
              {item.message ? <Text style={styles.messageText}>"{item.message}"</Text> : null}

              <TouchableOpacity
                style={[styles.acceptBtn, (isAccepting || verifying) && { opacity: 0.6 }]}
                onPress={() => handleAccept(item)}
                disabled={isAccepting || verifying}
              >
                {isAccepting ? (
                  <ActivityIndicator color={BLACK} />
                ) : verifying && acceptingId === null ? (
                  <ActivityIndicator color={BLACK} />
                ) : (
                  <Text style={styles.acceptBtnText}>Confirm and unlock chat</Text>
                )}
              </TouchableOpacity>
            </View>
          );
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#111111', paddingTop: Platform.OS === 'ios' ? 56 : 40, paddingHorizontal: 20 },
  center: { flex: 1, backgroundColor: '#111', alignItems: 'center', justifyContent: 'center' },

  backBtn: { marginBottom: 16 },
  backText: { color: GREY, fontSize: 14 },
  heading: { fontSize: 22, fontWeight: '800', color: '#fff', marginBottom: 4 },
  subheading: { fontSize: 13, color: GREY, marginBottom: 20 },

  errorBox: { backgroundColor: '#3a1a1a', borderRadius: 10, padding: 12, marginBottom: 16 },
  errorText: { color: '#ff8a8a', fontSize: 13 },

  list: { paddingBottom: 40 },
  emptyText: { color: GREY, fontSize: 13, textAlign: 'center', marginTop: 40 },

  card: { backgroundColor: BLACK, borderRadius: 14, padding: 18, marginBottom: 14, borderWidth: 0.5, borderColor: '#333' },
  sellerName: { color: '#fff', fontSize: 15, fontWeight: '700', marginBottom: 8 },
  priceLabel: { color: GREY, fontSize: 11 },
  priceValue: { color: GOLD, fontSize: 22, fontWeight: '800', marginBottom: 8 },
  messageText: { color: '#ccc', fontSize: 13, fontStyle: 'italic', marginBottom: 12, lineHeight: 18 },

  acceptBtn: { backgroundColor: GOLD, borderRadius: 12, paddingVertical: 14, alignItems: 'center' },
  acceptBtnText: { color: BLACK, fontSize: 14, fontWeight: '800' },
});
