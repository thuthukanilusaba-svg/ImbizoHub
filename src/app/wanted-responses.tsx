// app/wanted-responses.tsx
// Buyer views responses to their "wanted" post and can now chat with
// any responder immediately (see chat.tsx's item-request handling), or
// accept one — paying a small 5% commission (capped at $15, floored at
// $1.50 — see COMMISSION_CAP/MIN below) to unlock contact info and
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
//
// NEW 22 Oct 2026 — the account prompt for anonymous askers.
//
// This screen was already the one place in the Wanted flow that let an
// anonymous owner in, and that was right: the whole pitch of the app is
// "ask for it and sellers come to you", and making someone sign up
// before they can see whether anyone came is asking them to pay for a
// promise. What was missing was the other half — once a seller HAS
// named a price, nothing asked them to keep it.
//
// So the prompt is triggered by responses.length > 0, not by being
// anonymous. No offers, no ask. It sits above the list and never
// covers it: the prices stay readable without an account, because
// seeing that it worked is the only argument for signing up that is
// actually true.
//
// Two things had to be verified before promising "you won't lose
// this", since a promise the app can't keep costs more than the
// signup is worth. Every route out of an anonymous session does carry
// the data: register.tsx's email path calls auth.updateUser(), which
// upgrades the same uid in place so item_requests.user_id never moves;
// login.tsx and lib/oauth.ts (both the native and the web return trip)
// capture the anonymous id first and call merge_anonymous_session(),
// which re-points item_requests, item_responses and messages. Checked
// in the deployed function, not assumed.
//
// Reaching this screen at all also depended on two fixes made the same
// day: _layout.tsx had no tap route for the 'new_wanted_response' push,
// and my-wanted-posts.tsx — the only link to here — turned anonymous
// sessions away before it fetched anything.

import { useLocalSearchParams, useRouter } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator, FlatList, Image, Platform, StyleSheet,
  Text, TouchableOpacity, View,
} from 'react-native';
import PhotoZoomViewer from '../../components/PhotoZoomViewer';
import { extractFunctionError } from '../../lib/paymentError';
import { formatPrice } from '../../lib/money';
import { supabase } from '../../lib/supabase';

const GOLD = '#B8860B';
const BLACK = '#1A1A18';
const DARK = '#2a2a2a';
const GREY = '#AAAAAA';
const GREEN = '#4fc96e';

const POLL_INTERVAL_MS = 2000;
const POLL_MAX_ATTEMPTS = 20;

// FIX (real gap, found while comparing this fee against unlock.tsx's):
// this commission was a flat 5% with NO cap and NO floor — unlike
// unlock.tsx's structurally identical "pay to unlock contact info" fee,
// which is capped at $15 and floored at $1.50. A buyer requesting
// something expensive through Wanted (sourcing a car, a bulk order)
// would owe an unbounded commission just to unlock a seller's contact
// info — e.g. $150 to unlock a $3,000 want, when the same action on a
// regular listing costs at most $15 regardless of price. This file's
// own top comment already said this was meant to be the "same
// unlock-fee-style pattern as unlock.tsx" — the cap/floor just never
// actually got added. Now mirrors unlock.tsx's UNLOCK_FEE_CAP/MIN
// exactly, both here and in create-payment's server-side validation
// (which must match or every non-promo accept would be rejected as
// "Incorrect amount").
const COMMISSION_PCT = 0.05;
const COMMISSION_CAP = 15;
const COMMISSION_MIN = 1.50;

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
  // An anonymous owner is allowed to READ this screen and always has
  // been (that is deliberate — see handleAcceptFree's comment). What
  // they cannot do is act: chat, or accept. Tracked here so the prompt
  // below can say so once, up front, instead of letting them discover
  // it by tapping a button that bounces them to /register.
  const [isAnonymous, setIsAnonymous] = useState(false);

  // Which attached photo is open full-screen, or null. See the card below.
  const [zoomPhoto, setZoomPhoto] = useState<string | null>(null);
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
    setIsAnonymous(!!user.is_anonymous);

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
    // DELIBERATELY NOT GUARDED ON is_anonymous, unlike the two accept
    // paths below.
    //
    // I added a guard here earlier today on the assumption that
    // chat.tsx turns anonymous users away anyway and this would just
    // say so sooner. That was wrong — I asserted it in a comment
    // without checking. chat.tsx contains no is_anonymous check at
    // all, and the messages table's RLS (messages_insert_own,
    // sender_id = auth.uid()) permits an anonymous sender, because an
    // anonymous session holds the `authenticated` role like any other.
    // Anonymous chat works today and has all along.
    //
    // So the guard would have been a new restriction dressed up as a
    // fix, and it would have blocked the only thing on this screen
    // that can turn an offer into a deal. Accepting is gated because
    // it commits someone to money and a counterparty who can't be
    // rated or traced. Talking is not. The prompt above does the
    // asking; it is not this function's job to enforce it.
    router.push(`/chat?item_request_id=${request_id}&receiver_id=${response.responder_id}`);
  }

  // NEW: free-promo accept path — calls accept-response-free-promo
  // directly, no Paynow checkout. Kept fully separate from
  // handleAccept() below, same reasoning as every other promo path
  // built today — handleAccept() itself is completely untouched and
  // ready to take over immediately once the promo ends Feb 1.
  async function handleAcceptFree(response: any) {
    if (!request || request.user_id !== myId) return;

    // FIX (real bug, found during a final pre-submission review):
    // neither this function nor handleAccept() below had ANY check
    // for user.is_anonymous — only an ownership check. Given
    // post-wanted.tsx deliberately allows posting a want anonymously,
    // an anonymous session could legitimately reach this screen to
    // view their own responses (fine, matches the rest of the app),
    // but could then go on to actually accept a response and commit
    // to a real financial relationship — paying a real commission, or
    // claiming this free-promo path — while still fully anonymous.
    // That's exactly the scenario every other payment/accept flow in
    // the app explicitly guards against (unlock.tsx, quotes.tsx,
    // feature-listing-pay.tsx, etc.). Added the same check here.
    const { data: { user } } = await supabase.auth.getUser();
    if (!user || user.is_anonymous) {
      router.push('/register');
      return;
    }

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
      setError(await extractFunctionError(fnError, data, 'Could not accept this response. Please try again.'));
      return;
    }

    router.replace(`/chat?item_request_id=${request_id}&receiver_id=${response.responder_id}&openDeal=1`);
  }

  async function handleAccept(response: any) {
    if (!request || request.user_id !== myId) return;

    // FIX: same missing check as handleAcceptFree() above — see that
    // function's comment for the full reasoning.
    const { data: { user } } = await supabase.auth.getUser();
    if (!user || user.is_anonymous) {
      router.push('/register');
      return;
    }

    setError('');
    setAcceptingId(response.id);

    // FIX: was `parseFloat((response.price * 0.05).toFixed(2))` — no
    // cap, no floor. See COMMISSION_CAP/MIN's declaration above.
    const rawCommission = response.price * COMMISSION_PCT;
    const commission = parseFloat(
      Math.max(Math.min(rawCommission, COMMISSION_CAP), COMMISSION_MIN).toFixed(2)
    );

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
      setError(await extractFunctionError(fnError, data, 'Could not start payment. Please try again.'));
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
          <Text style={styles.backText}><Text style={styles.backArrow}>‹</Text> Back</Text>
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
        <Text style={styles.backText}><Text style={styles.backArrow}>‹</Text> Back</Text>
      </TouchableOpacity>

      <Text style={styles.heading}>Responses to your want</Text>
      {request ? <Text style={styles.subheading}>{request.title}</Text> : null}

      {error ? (
        <View style={styles.errorBox}><Text style={styles.errorText}>⚠️ {error}</Text></View>
      ) : null}

      {/* The ask, placed where the value is. Shown only once a seller
          has actually named a price — an anonymous asker with no
          responses yet gets the plain empty state and is left alone.
          Deliberately above the list and not over it: the prices stay
          readable without an account, because being able to see that
          the app worked is the entire argument for signing up. */}
      {isAnonymous && responses.length > 0 ? (
        <View style={styles.anonPrompt}>
          <Text style={styles.anonPromptTitle}>
            {responses.length === 1 ? 'You have an offer 🎉' : `You have ${responses.length} offers 🎉`}
          </Text>
          <Text style={styles.anonPromptBody}>
            Go ahead and chat — you don't need an account for that. But you posted this
            without one, so {responses.length === 1 ? 'this offer lives' : 'these offers live'} only on this
            phone. A free account keeps {responses.length === 1 ? 'it' : 'them'}, and you'll need one to accept.
          </Text>
          <TouchableOpacity style={styles.anonPromptBtn} onPress={() => router.push('/register')}>
            <Text style={styles.anonPromptBtnText}>Create free account</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => router.push('/login')}>
            <Text style={styles.anonPromptLink}>Already have an account? Sign in</Text>
          </TouchableOpacity>
        </View>
      ) : null}

      <FlatList
        data={responses}
        keyExtractor={(item) => item.id}
        style={styles.listContainer}
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
              <Text style={styles.priceValue}>${formatPrice(item.price)}</Text>
              {item.message ? <Text style={styles.messageText}>"{item.message}"</Text> : null}

              {/* FIX (reported 1 Sep 2026: "pictures attached did not go to
                  the recipient"). They did go — browse-wanted.tsx uploads
                  the photo and stores it on item_responses.photo_url, and
                  there is a real photo sitting on a real response in the
                  database right now. This screen, the ONLY place a buyer
                  ever sees responses, simply never rendered it. The seller
                  took a picture of the item, the app saved it, and nobody
                  could look at it.

                  Tappable and full-screen on tap, using the same viewer
                  listing.tsx uses: a thumbnail is not enough to judge
                  whether a second-hand item is in the condition claimed,
                  which is the entire reason for attaching one. */}
              {item.photo_url ? (
                <TouchableOpacity
                  activeOpacity={0.85}
                  onPress={() => setZoomPhoto(item.photo_url)}
                  style={styles.photoWrap}
                >
                  <Image source={{ uri: item.photo_url }} style={styles.photo} resizeMode="cover" />
                  <Text style={styles.photoHint}>Tap to enlarge</Text>
                </TouchableOpacity>
              ) : null}

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

      {/* Same viewer listing.tsx uses, so an attached photo behaves the
          same way everywhere in the app. */}
      <PhotoZoomViewer
        photos={zoomPhoto ? [zoomPhoto] : []}
        imageIndex={0}
        visible={!!zoomPhoto}
        onRequestClose={() => setZoomPhoto(null)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#111111', paddingTop: Platform.OS === 'ios' ? 56 : 40, paddingHorizontal: 20 },
  center: { flex: 1, backgroundColor: '#111', alignItems: 'center', justifyContent: 'center' },

  backBtn: { marginBottom: 16 },
  backText: { color: GREY, fontSize: 14 },
  // NEW: bigger than the label text so the '‹' glyph reads clearly — direct product decision ("back symbol too small").
  backArrow: { fontSize: 20 },
  heading: { fontSize: 22, fontWeight: '800', color: '#fff', marginBottom: 4 },
  subheading: { fontSize: 13, color: GREY, marginBottom: 20 },

  errorBox: { backgroundColor: '#3a1a1a', borderRadius: 10, padding: 12, marginBottom: 16 },
  errorText: { color: '#ff8a8a', fontSize: 13 },

  // Matches my-wanted-posts.tsx's prompt deliberately — the same person
  // may see both on the way here from a notification, and two different
  // treatments of the same message reads as two different messages.
  // Rounded here rather than full-bleed because this screen has its own
  // horizontal padding on the container.
  anonPrompt: {
    backgroundColor: '#201a08', borderRadius: 14, borderWidth: 0.5, borderColor: '#3d3214',
    padding: 16, marginBottom: 16,
  },
  anonPromptTitle: { color: '#fff', fontSize: 15, fontWeight: '800', marginBottom: 6 },
  anonPromptBody: { color: '#ddd', fontSize: 12.5, lineHeight: 18, marginBottom: 14 },
  anonPromptBtn: { backgroundColor: GOLD, borderRadius: 12, paddingVertical: 13, alignItems: 'center', marginBottom: 10 },
  anonPromptBtnText: { color: BLACK, fontSize: 13.5, fontWeight: '800' },
  anonPromptLink: { color: GREY, fontSize: 12, textAlign: 'center' },

  // FIX (reported 1 Sep 2026: "a person should scroll up and down for
  // message in both instances"). The FlatList had no `style`, only
  // `contentContainerStyle`, so React Native sized it to its full
  // content height instead of the screen space left below the heading.
  // With two responses on the screenshot that is invisible; with enough
  // responses to overflow one screen the lower cards — and the Accept
  // button on them — cannot be reached at all, because the list does not
  // believe it is overflowing.
  //
  // Identical fix to operator-requests.tsx and my-wanted-posts.tsx.
  // Worth noting the pattern: every list in this app written without a
  // `style` prop has eventually turned out to have this bug, and it only
  // ever shows up once there is real data.
  listContainer: { flex: 1 },
  list: { paddingBottom: 40 },
  emptyText: { color: GREY, fontSize: 13, textAlign: 'center', marginTop: 40 },

  card: { backgroundColor: BLACK, borderRadius: 14, padding: 18, marginBottom: 14, borderWidth: 0.5, borderColor: '#333' },
  sellerName: { color: '#fff', fontSize: 15, fontWeight: '700', marginBottom: 8 },
  priceLabel: { color: GREY, fontSize: 11 },
  priceValue: { color: GOLD, fontSize: 22, fontWeight: '800', marginBottom: 8 },
  photoWrap: { marginBottom: 12 },
  photo: { width: '100%', height: 180, borderRadius: 12, backgroundColor: '#222' },
  photoHint: { color: GREY, fontSize: 11, marginTop: 6, textAlign: 'center' },
  messageText: { color: '#ccc', fontSize: 13, fontStyle: 'italic', marginBottom: 12, lineHeight: 18 },

  chatBtn: { borderRadius: 12, paddingVertical: 13, alignItems: 'center', marginBottom: 10, borderWidth: 1, borderColor: GOLD },
  chatBtnText: { color: GOLD, fontSize: 13, fontWeight: '700' },

  acceptBtn: { backgroundColor: GOLD, borderRadius: 12, paddingVertical: 14, alignItems: 'center' },
  acceptBtnText: { color: BLACK, fontSize: 14, fontWeight: '800' },

  acceptedBadge: { backgroundColor: '#1a2a1a', borderRadius: 12, paddingVertical: 14, alignItems: 'center', borderWidth: 0.5, borderColor: '#2a4a2a' },
  acceptedBadgeText: { color: GREEN, fontSize: 14, fontWeight: '700' },
});
