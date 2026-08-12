// app/wanted-responses.tsx
// Buyer views responses to their "wanted" post and can now chat with
// any responder immediately (see chat.tsx's item-request handling), or
// accept one — paying a small 5% commission to unlock contact info and
// fulfillment (Meet & Collect / delivery) with that seller — same
// unlock-fee-style pattern as unlock.tsx, just for the Wanted flow
// instead of a regular listing.
//
// NEW: "💬 Chat" button added to each response card — closes a real
// gap. chat.tsx was updated to allow chatting with any responder before
// acceptance (contact info still protected until accepted+paid), but
// nothing anywhere actually navigated a buyer INTO that chat before
// this. This is that entry point.
//
// CORRECTED (my earlier pass here was wrong): handleAccept() computed
// the commission at 5% (response.price * 0.05). I flagged that as a
// bug because post-wanted.tsx's own note said 3% — but 5% was a
// deliberate decision, and the note simply hadn't been updated to
// match yet. I reverted the working number based on a text mismatch
// without checking whether the mismatch pointed the other way.
// Restored to 0.05; post-wanted.tsx's note corrected to say 5%
// instead of reverting this again.
//
// FIX: "Confirm and unlock chat" button label updated — chat is no
// longer what accepting unlocks (it's already reachable via the new
// Chat button above). What accepting actually does now is unlock
// contact info and fulfillment options, so the label says that instead.
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
const POLL_MAX_ATTEMPTS = 20;

// NEW: launch promotion — accepting a response is free until Jan 31,
// 2027, same window as every other promo built today. See
// accept-response-free-promo/index.ts for the full reasoning.
const FREE_PROMO_END = new Date('2027-01-31T23:59:59Z');
const isPromoActive = () => new Date() < FREE_PROMO_END;

export default function WantedResponsesScreen() {
  const router = useRouter();
  const { request_id } = useLocalSearchParams<{ request_id: string }>();

  const [loading, setLoading] = useState(true);
  const [request, setRequest] = useState<any>(null);
  const [responses, setResponses] = useState<any[]>([]);
  const [myId, setMyId] = useState('');
  const [myEmail, setMyEmail] = useState('');
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

  function handleChat(response: any) {
    router.push(`/chat?item_request_id=${request_id}&receiver_id=${response.responder_id}`);
  }

  // NEW: free-promo accept path — calls accept-response-free-promo
  // directly, no Paynow checkout. Kept fully separate from
  // handleAccept() below, same reasoning as every other promo path
  // built today — handleAccept() itself is completely untouched and
  // ready to take over immediately once the promo ends Feb 1.
  async function handleAcceptFree(response: any) {
    if (!request || request.user_id !== myId) return;

    setError('');
    setAcceptingId(response.id);

    const { data, error: fnError } = await supabase.functions.invoke('accept-response-free-promo', {
      body: {
        item_request_id: request_id,
        item_response_id: response.id,
        buyer_id: myId,
        seller_id: response.responder_id,
      },
    });

    setAcceptingId(null);

    if (fnError || data?.error) {
      setError(fnError?.message || data?.error || 'Could not accept this response. Please try again.');
      return;
    }

    router.replace(`/chat?item_request_id=${request_id}&receiver_id=${response.responder_id}&openDeal=1`);
  }

  async function handleAccept(response: any) {
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
      router.replace(`/chat?item_request_id=${request_id}&receiver_id=${response.responder_id}&openDeal=1`);
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
          const isAccepted = item.status === 'accepted';
          return (
            <View style={styles.card}>
              <Text style={styles.sellerName}>{item.responder_name}</Text>
              <Text style={styles.priceLabel}>Their price</Text>
              <Text style={styles.priceValue}>${item.price}</Text>
              {item.message ? <Text style={styles.messageText}>"{item.message}"</Text> : null}

              <TouchableOpacity
                style={styles.chatBtn}
                onPress={() => handleChat(item)}
              >
                <Text style={styles.chatBtnText}>💬 Chat with {item.responder_name}</Text>
              </TouchableOpacity>

              {isAccepted ? (
                <View style={styles.acceptedBadge}>
                  <Text style={styles.acceptedBadgeText}>✓ Accepted</Text>
                </View>
              ) : (
                <TouchableOpacity
                  style={[styles.acceptBtn, (isAccepting || verifying) && { opacity: 0.6 }]}
                  onPress={() => (isPromoActive() ? handleAcceptFree(item) : handleAccept(item))}
                  disabled={isAccepting || verifying}
                >
                  {isAccepting ? (
                    <ActivityIndicator color={BLACK} />
                  ) : verifying && acceptingId === null ? (
                    <ActivityIndicator color={BLACK} />
                  ) : isPromoActive() ? (
                    <Text style={styles.acceptBtnText}>Accept free — launch promo</Text>
                  ) : (
                    <Text style={styles.acceptBtnText}>Accept — unlock contact info</Text>
                  )}
                </TouchableOpacity>
              )}
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

  chatBtn: { borderRadius: 12, paddingVertical: 13, alignItems: 'center', marginBottom: 10, borderWidth: 1, borderColor: GOLD },
  chatBtnText: { color: GOLD, fontSize: 13, fontWeight: '700' },

  acceptBtn: { backgroundColor: GOLD, borderRadius: 12, paddingVertical: 14, alignItems: 'center' },
  acceptBtnText: { color: BLACK, fontSize: 14, fontWeight: '800' },

  acceptedBadge: { backgroundColor: '#1a2a1a', borderRadius: 12, paddingVertical: 14, alignItems: 'center', borderWidth: 0.5, borderColor: '#2a4a2a' },
  acceptedBadgeText: { color: GREEN, fontSize: 14, fontWeight: '700' },
});
