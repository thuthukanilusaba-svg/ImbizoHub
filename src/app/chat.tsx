// app/chat.tsx
// Chat screen — messaging is unconditionally free, no message limit or lock.
// The unlock fee (paid in unlock.tsx) now gates "Arrange deal" — i.e. the
// moment a buyer wants to start Meet & Pay or book delivery — instead of
// gating chat itself. This reflects the actual moment of buying intent
// rather than charging before any signal of interest exists.
// Contact-info blocking in chat STILL applies even though chat is free,
// since otherwise buyer/seller could just swap phone numbers here and
// complete the deal off-platform without ever paying the arrange-deal fee.
//
// UPDATED (product decision): Wanted-tab (item-request) chats now work
// exactly like listing chats — free to chat with ANY responder
// immediately, the moment they respond, not just the one the buyer
// eventually accepts. Previously this chat was entirely unreachable
// until AFTER the buyer had already accepted a response and paid the 5%
// commission, meaning buyer and seller could never actually talk before
// committing — no chance to ask questions, clarify details, or build
// trust before money changed hands. That's now backwards from every
// other chat type in the app.
//
// The correct model, confirmed to mirror listing chats exactly:
//   - Chat is reachable and free with any individual responder, the
//     moment they submit a response — no separate "start chat" action
//     needed.
//   - Contact info stays BLOCKED in that chat until THIS SPECIFIC
//     response is accepted and the 5% commission is paid for it — same
//     protection listing chats give the unlock fee, just checked
//     per-response instead of per-listing-deposit.
//   - "Arrange deal" (Meet & Collect / Book delivery) only becomes
//     available once accepted+paid; before that, the buyer's header
//     button routes to wanted-responses.tsx to actually accept (and
//     pay for) this or another response, mirroring how a listing
//     buyer's "Arrange deal" routes to unlock.tsx before that fee is
//     paid.
//
// This required rethinking depositPaid/chatUnlocked for item-request
// chats specifically: unlike a listing (where the SELLER inherently has
// full messaging rights on their own listing regardless of any given
// buyer's payment status), NEITHER side of an item-request chat has an
// inherent "rights" shortcut — a buyer chatting with an unaccepted
// responder has exactly as much access as that responder chatting back,
// no more. Both depositPaid and chatUnlocked for these chats are now the
// same single value: has THIS specific response (looked up by
// item_request_id + whichever side is the responder in this
// conversation) been accepted. See checkRole() below for how that's
// resolved per-conversation, mirroring the exact same "whichever side is
// the buyer in THIS conversation" pattern already used for listing
// chats' chatUnlocked check.
//
// FIX (real bug, found during a full-app review pass): containsContactInfo()
// was checked unconditionally in sendMessage() with no exception for an
// already-unlocked/paid chat — meaning the block never actually turned
// off, contradicting the warning text shown to users ("isn't allowed
// BEFORE chat is unlocked... use Meet & Pay to safely exchange contact
// info"), which clearly implies sharing becomes fine after payment.
// Product decision: the warning text was correct, the code wasn't — a
// genuinely paid/unlocked chat should allow contact info, since at that
// point ImbizoHub has already been paid for this deal and there's no
// remaining incentive gap to protect.

import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, AppState, KeyboardAvoidingView, Modal, Platform, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { DELIVERY_BOOKING_ENABLED, DELIVERY_PAUSED_MESSAGE, DELIVERY_PAUSED_TITLE } from '../../lib/featureFlags';
import {
  notifyAgreedToMeet,
  notifyMeetPayPinGenerated,
  notifyNewMessage,
  notifyTransactionConfirmed
} from '../../lib/notifications';
import { supabase } from '../../lib/supabase';
import { useWebKeyboardInset } from '../../lib/useWebKeyboardInset';

const GOLD = '#B8860B';
const BLACK = '#1A1A18';
const DARK = '#2a2a2a';
const GREY = '#AAAAAA';

function parsePgTimestamp(value: string): number {
  const normalized = value
    .replace(' ', 'T')
    .replace(/([+-]\d{2})$/, '$1:00');
  return new Date(normalized).getTime();
}

function getInitials(name: string): string {
  if (!name) return '👤';
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export default function ChatScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  // 0 on native and on any browser without visualViewport; see the hook.
  const webKeyboardInset = useWebKeyboardInset();
  const { listing_id, receiver_id, openDeal, request_id, item_request_id } = useLocalSearchParams();
  const isRequestChat = !listing_id && !item_request_id && !!request_id;
  const isItemRequestChat = !listing_id && !request_id && !!item_request_id;
  const [messages, setMessages] = useState<any[]>([]);
  const [text, setText] = useState('');
  const [loading, setLoading] = useState(true);
  const [myId, setMyId] = useState<string>('');
  const scrollRef = useRef<ScrollView>(null);

  const [isOwnerOfListing, setIsOwnerOfListing] = useState(false);
  const [meetPayModal, setMeetPayModal] = useState(false);
  const [session, setSession] = useState<any>(null);
  const [enteredPin, setEnteredPin] = useState('');
  const [pinError, setPinError] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState(0);
  const [listingPrice, setListingPrice] = useState<number | null>(null);
  const [sellerIsDealerPro, setSellerIsDealerPro] = useState(false);
  const [contactWarning, setContactWarning] = useState(false);
  const [sendError, setSendError] = useState('');
  const [otherPersonName, setOtherPersonName] = useState('');

  const [depositChecked, setDepositChecked] = useState(false);
  const [depositPaid, setDepositPaid] = useState(false);
  const [chatUnlocked, setChatUnlocked] = useState(false);
  // FIX (real bug, found while investigating whether van-hire chat
  // actually works for meetups): the operator's only entry point into
  // a request_id chat is tapping their "quote accepted" push
  // notification, which deep-links to `/chat?request_id=...` with NO
  // receiver_id (see _layout.tsx's notification router — it only has
  // request_id in the notification payload to begin with). Every piece
  // of message logic below keyed off the raw receiver_id route param,
  // so arriving without one meant: no realtime subscription (gated on
  // receiver_id), no name shown in the header, and — the serious part —
  // any message the operator sent got inserted with receiver_id: null,
  // which the CUSTOMER's own fetchMessages() then silently filtered out
  // (it matches strictly on sender/receiver id pairs), so the customer
  // would simply never see it. checkRole() below resolves the missing
  // id from data this screen already has read access to (the request's
  // owner, and the accepted quote's operator) and stores it here so
  // every downstream call — including ones that fire later, like the
  // AppState foreground refetch — has a real id to use.
  const [resolvedReceiverId, setResolvedReceiverId] = useState<string | undefined>(receiver_id as string | undefined);
  const [dealModal, setDealModal] = useState(false);
  // Re-entry guard for sendMessage. Confirmed against real data rather
  // than theorised: messages 54 and 55 were an identical "hello" from
  // the same sender 292 MICROSECONDS apart. A human double-tap is
  // 100ms+, so that was one user action invoking the handler twice.
  //
  // sendMessage is wired to two things — onSubmitEditing on the
  // TextInput and onPress on the send button — with nothing stopping
  // both from running. It clears the input via setText('') only AFTER
  // its awaits resolve, so a second invocation in the same tick still
  // sees the old `text` in its closure, passes the !text.trim() check,
  // and inserts a second identical row.
  //
  // A ref, not state: state updates are async and batched, so a state
  // flag would not be visible to a second call in the same tick, which
  // is precisely the window being closed here.
  const isSendingRef = useRef(false);
  const openDealHandled = useRef(false);
  const isBuyerRoleRef = useRef(false);
  const sessionChannelRef = useRef<any>(null);
  const newSessionChannelRef = useRef<any>(null);

  // Van-hire only. The accepted quote's id, which is what meetpay.tsx
  // keys a van_hire session on (reference_id).
  //
  // Why this lives in the chat: trip completion is mutual — both the
  // customer and the driver have to confirm — but the customer's only
  // route to that screen was a modal inside quotes.tsx, and tapping
  // 'Chat with operator' navigated away from it. Getting back meant
  // returning to the quote card and reopening it, which reads as
  // 'redo the whole thing'. Meanwhile the driver had no route at all.
  //
  // The chat is where both people already are when a trip wraps up, and
  // it is the one screen both of them can always reach, so the button
  // belongs here. meetpay.tsx works out on its own which side you are,
  // so the same pill serves both without branching.
  const [listingSold, setListingSold] = useState(false);
  const [acceptedQuoteId, setAcceptedQuoteId] = useState<string | null>(null);
  // Which side of the trip the person reading this chat is on. The pill
  // is shown to both, and each side describes the same event in its own
  // terms — the passenger received a service, the driver finished a job.
  const [iAmTheOperator, setIAmTheOperator] = useState(false);

  const [itemIsPhysical, setItemIsPhysical] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function init() {
      const { data: { session } } = await supabase.auth.getSession();
      const uid = session?.user?.id ?? '';
      if (cancelled) return;
      setMyId(uid);

      const { owner, sellerIsDealerPro: isDealerProSeller, itemResponseAccepted, resolvedOtherId } = await checkRole(uid);
      if (cancelled) return;

      // See the resolvedReceiverId state declaration above for the full
      // reasoning. Use a local variable (not just the state setter) so
      // everything else in this same init() run — which executes before
      // React has applied the state update — gets the resolved id too.
      const effectiveReceiverId = (receiver_id as string | undefined) || resolvedOtherId;
      if (effectiveReceiverId && effectiveReceiverId !== receiver_id) {
        setResolvedReceiverId(effectiveReceiverId);
      }

      await fetchOtherPersonName(effectiveReceiverId);
      if (cancelled) return;

      if (isItemRequestChat) {
        setDepositPaid(itemResponseAccepted);
        setChatUnlocked(itemResponseAccepted);
      } else if (owner) {
        setDepositPaid(true);
      } else if (isDealerProSeller) {
        setDepositPaid(true);
      } else if (isRequestChat) {
        setDepositPaid(true);
      } else {
        const paid = await checkDepositPaid(uid);
        if (cancelled) return;
        setDepositPaid(paid);
      }

      if (!isItemRequestChat) {
        if (isDealerProSeller) {
          setChatUnlocked(true);
        } else if (isRequestChat) {
          setChatUnlocked(true);
        } else if (listing_id) {
          const buyerIdForThisChat = owner ? (receiver_id as string) : uid;
          if (buyerIdForThisChat) {
            const unlocked = await checkDepositPaid(buyerIdForThisChat);
            if (cancelled) return;
            setChatUnlocked(unlocked);
          }
        }
      }

      setDepositChecked(true);

      await fetchMessages(uid, effectiveReceiverId);
      // FIX: pass the RESOLVED id, not the raw (possibly missing) route
      // param — see loadExistingMeetPaySession()'s own comment.
      await loadExistingMeetPaySession(uid, effectiveReceiverId);
      if (!cancelled) subscribeToNewMeetPaySession(uid, effectiveReceiverId);

      // FIX: this used to also require `effectiveReceiverId`, which
      // meant that whenever the other party could not be resolved — an
      // entry point that passes no receiver_id (see _layout.tsx's
      // notification router), a wanted post whose response isn't
      // 'accepted' yet, a lookup that returned nothing — the chat
      // opened with NO realtime subscription at all and silently stayed
      // that way. The snapshot fetch still ran, so the screen looked
      // fine on open and simply never updated again: exactly the
      // "not two-way, not real-time" symptom.
      //
      // Nothing about the subscription actually needs otherId. The
      // channel listens to every messages INSERT and filters in the
      // handler, which already accepts a row when uid is either the
      // sender or the receiver — so with otherId undefined it still
      // matches this user's own conversations, just without the extra
      // narrowing. Missing the other party's id is a reason to filter
      // less precisely, never a reason to stop listening.
      if (!cancelled && (listing_id || request_id || item_request_id) && uid) {
        const convoKey = isItemRequestChat
          ? `item-${item_request_id}`
          : isRequestChat
            ? `req-${request_id}`
            : `listing-${listing_id}`;
        const channelName = `messages-${convoKey}-${effectiveReceiverId ?? 'any'}-${uid}`;

        subscribeToMessages(channelName, uid, effectiveReceiverId);
      }
    }

    // FIX (real bug, reported: "messages are not going through" — the
    // sender sees their own message, the other party's already-open
    // chat never gets it): there was a genuine race between the
    // fetchMessages() snapshot above and this channel actually going
    // live. subscribe() returns immediately, but the websocket
    // handshake completing — the point postgres_changes actually starts
    // pushing events — happens some time after that, and
    // loadExistingMeetPaySession()'s extra await between the snapshot
    // and this call widened the gap further. Any message the other
    // party sent inside that window was in neither the snapshot nor
    // caught by realtime, and since Postgres Changes never backfills
    // (only pushes events after a channel is truly subscribed), it
    // just never arrived until something else forced a resync
    // (backgrounding the app, leaving and reopening the chat).
    //
    // Fixed two ways, both handled by the channel's own status callback
    // rather than a separate polling loop — this keeps delivery
    // genuinely event-driven, not degraded to "check every few
    // seconds":
    //   1. Once the channel reports SUBSCRIBED (truly listening now),
    //      do ONE reconciling fetchMessages() call to pick up anything
    //      sent during the gap. fetchMessages() already does a full
    //      state replace, so this can't duplicate anything already
    //      shown.
    //   2. If the channel reports CHANNEL_ERROR/TIMED_OUT (a dropped
    //      connection), resubscribe automatically with capped
    //      exponential backoff instead of leaving the chat silently
    //      unable to receive anything for the rest of the session.
    function subscribeToMessages(channelName: string, uid: string, otherId: string | undefined, attempt = 0) {
      if (cancelled) return;

      const staleChannels = supabase.getChannels().filter((ch) => ch.topic?.includes(channelName));
      staleChannels.forEach((ch) => supabase.removeChannel(ch));

      const channel = supabase
        .channel(channelName)
        .on('postgres_changes', {
          event: 'INSERT', schema: 'public', table: 'messages',
        }, (payload) => {
          const msg = payload.new;
          // FIX (separate, provable bug found in the same pass): the
          // request_id branch compared a NUMBER to a STRING. messages
          // .request_id is bigint, so the realtime payload carries a
          // number, while the route param is always a string — and
          // 123 === "123" is false. Van-hire request chats therefore
          // rejected every single realtime message. The listing branch
          // avoided this only because it happened to parseInt first;
          // item_request_id is a uuid so both sides were already
          // strings.
          //
          // Comparing as strings handles uuid, bigint and int
          // identically, so this class of mismatch cannot come back the
          // next time a chat type is added.
          const belongsToThisConvo = isItemRequestChat
            ? !!item_request_id && String(msg.item_request_id) === String(item_request_id)
            : isRequestChat
              ? !!request_id && String(msg.request_id) === String(request_id)
              : !!listing_id && String(msg.listing_id) === String(listing_id);
          if (
            belongsToThisConvo &&
            (msg.sender_id === otherId || msg.receiver_id === otherId ||
             msg.sender_id === uid || msg.receiver_id === uid)
          ) {
            setMessages((prev) => (prev.some((m) => m.id === msg.id) ? prev : [...prev, msg]));
            if (msg.sender_id !== uid) {
              notifyNewMessage(
                'ImbizoHub',
                msg.text,
                isItemRequestChat ? String(item_request_id) : isRequestChat ? String(request_id) : String(listing_id)
              );
            }
          }
        })
        .subscribe((status) => {
          if (cancelled) return;
          if (status === 'SUBSCRIBED') {
            fetchMessages(uid, otherId);
          } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
            const delay = Math.min(30000, 2000 * Math.pow(2, attempt));
            setTimeout(() => {
              if (!cancelled) subscribeToMessages(channelName, uid, otherId, attempt + 1);
            }, delay);
          }
        });

      channelRef.current = channel;
    }

    init();

    return () => {
      cancelled = true;
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current);
        channelRef.current = null;
      }
      if (sessionChannelRef.current) {
        supabase.removeChannel(sessionChannelRef.current);
        sessionChannelRef.current = null;
      }
      if (newSessionChannelRef.current) {
        supabase.removeChannel(newSessionChannelRef.current);
        newSessionChannelRef.current = null;
      }
    };
  }, []);

  const channelRef = useRef<any>(null);

  useEffect(() => {
    if (!session?.pin_expires_at || session.status !== 'pending') return;

    const computeRemaining = () =>
      Math.max(0, Math.floor((parsePgTimestamp(session.pin_expires_at) - Date.now()) / 1000));

    setSecondsLeft(computeRemaining());

    const interval = setInterval(() => {
      const remaining = computeRemaining();
      setSecondsLeft(remaining);
      if (remaining === 0) clearInterval(interval);
    }, 1000);
    return () => clearInterval(interval);
  }, [session]);

  useEffect(() => {
    if (isRequestChat) return;
    if (openDeal === '1' && depositChecked && depositPaid && isBuyerRoleRef.current && !openDealHandled.current) {
      openDealHandled.current = true;
      setDealModal(true);
    }
  }, [openDeal, depositChecked, depositPaid]);

  // FIX (real bug, reported: "some messages do not come through
  // especially if the other phone is not active"): there was no
  // AppState handling anywhere in this screen. Mobile OSes routinely
  // suspend JS execution and can silently drop the realtime websocket
  // while the app is backgrounded or the phone is locked — the message
  // itself lands in the database fine, but with the socket dead there's
  // no INSERT event to receive it, and with no resync-on-return logic
  // either, `messages` just sits stale until something else happens to
  // remount this whole screen (force-quitting and reopening the app,
  // for instance). A plain re-fetch on foreground is the standard fix
  // for exactly this: it doesn't matter whether the realtime channel
  // silently died in the background, this always reconciles against
  // whatever's actually in the database. fetchMessages() already does a
  // full replace (setMessages(filtered), not an append), so calling it
  // again here is safe and can't duplicate anything.
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'active' && myId) {
        fetchMessages(myId);
      }
    });
    return () => subscription.remove();
  }, [myId]);

  // Re-checked on every focus, not only when the screen mounts. A quote
  // is normally accepted while this chat is already open on the other
  // party's device, so a lookup that ran once left the operator with no
  // "Confirm trip" pill and no indication that anything had changed.
  useFocusEffect(
    useCallback(() => {
      if (!isRequestChat || !request_id) { setAcceptedQuoteId(null); return; }
      let cancelled = false;
      (async () => {
        const { data } = await supabase
          .from('quotes')
          .select('id, operator_id')
          .eq('request_id', request_id as string)
          .eq('status', 'accepted')
          .maybeSingle();
        if (!cancelled) {
          setAcceptedQuoteId(data?.id ?? null);
          // The accepted quote already names the operator, so working
          // out which side this reader is on costs no extra query.
          setIAmTheOperator(!!data && !!myId && data.operator_id === myId);
        }
      })();
      return () => { cancelled = true; };
    }, [isRequestChat, request_id, myId])
  );

  async function fetchOtherPersonName(idOverride?: string) {
    const id = idOverride || (receiver_id as string | undefined) || resolvedReceiverId;
    if (!id) return;
    const { data } = await supabase
      .from('profiles')
      .select('full_name')
      .eq('id', id)
      .maybeSingle();
    if (data?.full_name) setOtherPersonName(data.full_name);
  }

  async function checkRole(uid: string): Promise<{ owner: boolean; sellerIsDealerPro: boolean; itemResponseAccepted: boolean; resolvedOtherId?: string }> {
    if (isItemRequestChat) {
      if (!item_request_id) return { owner: false, sellerIsDealerPro: false, itemResponseAccepted: false };
      const { data: req } = await supabase
        .from('item_requests')
        .select('user_id')
        .eq('id', item_request_id as string)
        .maybeSingle();

      if (!req) return { owner: false, sellerIsDealerPro: false, itemResponseAccepted: false };

      const owner = uid === req.user_id;
      setIsOwnerOfListing(owner);
      isBuyerRoleRef.current = owner;

      // FIX (real bug, same class as the van-hire request_id fix above:
      // "meetpay/handoff modal stuck on 'waiting' forever"): the
      // 'wanted_match' push notification deep-links to
      // `/chat?item_request_id=...` with no receiver_id (see
      // _layout.tsx's notification router) — same gap as request_id
      // chats had. Resolved the same way: when I'm the responder
      // (seller) and arrived without one, the buyer is unambiguous —
      // it's the post's own owner, already fetched above. When I'm the
      // owner (buyer) and arrived without one, fall back to whichever
      // response is actually accepted — the only one there's a live
      // chat with.
      let resolvedOtherId: string | undefined;
      if (!receiver_id) {
        if (!owner) {
          resolvedOtherId = req.user_id;
        } else {
          const { data: acceptedResponse } = await supabase
            .from('item_responses')
            .select('responder_id')
            .eq('item_request_id', item_request_id as string)
            .eq('status', 'accepted')
            .maybeSingle();
          resolvedOtherId = acceptedResponse?.responder_id;
        }
      }

      const responderIdForThisChat = owner ? ((receiver_id as string) || resolvedOtherId) : uid;
      let responseStatus: string | null = null;
      if (responderIdForThisChat) {
        const { data: response } = await supabase
          .from('item_responses')
          .select('status, is_physical_item')
          .eq('item_request_id', item_request_id as string)
          .eq('responder_id', responderIdForThisChat)
          .maybeSingle();
        if (response) {
          setItemIsPhysical(response.is_physical_item);
          responseStatus = response.status;
        }
      }

      return { owner, sellerIsDealerPro: false, itemResponseAccepted: responseStatus === 'accepted', resolvedOtherId };
    }

    if (isRequestChat) {
      if (!request_id) return { owner: false, sellerIsDealerPro: false, itemResponseAccepted: false };
      const { data: req } = await supabase
        .from('requests')
        .select('user_id')
        .eq('id', request_id as string)
        .maybeSingle();
      if (req) {
        const owner = uid === req.user_id;
        setIsOwnerOfListing(owner);
        isBuyerRoleRef.current = !owner;

        // FIX: see the resolvedReceiverId state declaration up top for
        // the full reasoning — only need to look this up at all when
        // the route didn't already give us a receiver_id (the
        // customer's own "Chat with operator" button always does).
        let resolvedOtherId: string | undefined;
        if (!receiver_id) {
          if (owner) {
            // I'm the customer, arrived some other way than the normal
            // button (e.g. a stale/bookmarked link) — the other party
            // is whichever operator's quote actually won.
            const { data: acceptedQuote } = await supabase
              .from('quotes')
              .select('operator_id')
              .eq('request_id', request_id as string)
              .eq('status', 'accepted')
              .maybeSingle();
            resolvedOtherId = acceptedQuote?.operator_id;
          } else {
            // I'm the operator, arrived via the "quote accepted" push
            // notification — the other party is the request's owner.
            resolvedOtherId = req.user_id;
          }
        }

        return { owner, sellerIsDealerPro: false, itemResponseAccepted: false, resolvedOtherId };
      }
      return { owner: false, sellerIsDealerPro: false, itemResponseAccepted: false };
    }

    if (!listing_id) return { owner: false, sellerIsDealerPro: false, itemResponseAccepted: false };
    const parsedId = parseInt(listing_id as string);
    const { data: listing, error } = await supabase
      .from('listings')
      // status is read so this screen knows when the item has been
      // sold. Without it, a buyer already in a chat kept being offered
      // the paid unlock after the seller marked the item sold — the
      // listing page hides that button, but this screen never knew.
      .select('user_id, price, status')
      .eq('id', parsedId)
      .maybeSingle();
    if (listing) {
      const owner = uid === listing.user_id;
      setIsOwnerOfListing(owner);
      isBuyerRoleRef.current = !owner;
      setListingPrice(listing.price);
      setListingSold(listing.status === 'sold');

      const { data: sellerProfile } = await supabase
        .from('profiles')
        .select('dealer_pro_active, dealer_pro_expires_at')
        .eq('id', listing.user_id)
        .maybeSingle();

      const isDealerPro = !!(
        sellerProfile?.dealer_pro_active &&
        sellerProfile?.dealer_pro_expires_at &&
        new Date(sellerProfile.dealer_pro_expires_at).getTime() > Date.now()
      );
      setSellerIsDealerPro(isDealerPro);

      // FIX (real bug, reported: "Confirm sale and handover" stuck
      // forever on "Waiting for the buyer to arrange the deal" — same
      // missing-receiver_id class as the two fixes above, for the most
      // common chat type in the app): the "New message" and "unlock"
      // push notifications deep-link to `/chat?listing_id=...` with no
      // receiver_id at all (see _layout.tsx's notification router). A
      // buyer arriving this way is unambiguous — the seller is just the
      // listing's own owner, already fetched above. A SELLER arriving
      // this way is genuinely ambiguous — the same listing can have
      // several different buyers messaging about it — so this falls
      // back to whichever buyer they most recently exchanged a message
      // with on this listing, which is reliably the conversation that
      // actually triggered the notification they just tapped.
      let resolvedOtherId: string | undefined;
      if (!receiver_id) {
        if (!owner) {
          resolvedOtherId = listing.user_id;
        } else {
          const { data: lastMsg } = await supabase
            .from('messages')
            .select('sender_id, receiver_id')
            .eq('listing_id', parsedId)
            .or(`sender_id.eq.${uid},receiver_id.eq.${uid}`)
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle();
          if (lastMsg) {
            resolvedOtherId = lastMsg.sender_id === uid ? lastMsg.receiver_id : lastMsg.sender_id;
          }
        }
      }

      return { owner, sellerIsDealerPro: isDealerPro, itemResponseAccepted: false, resolvedOtherId };
    }
    return { owner: false, sellerIsDealerPro: false, itemResponseAccepted: false };
  }

  async function checkDepositPaid(buyerId: string): Promise<boolean> {
    if (!listing_id || !buyerId) {
      return false;
    }
    const parsedId = parseInt(listing_id as string);

    const { data, error } = await supabase
      .from('listing_deposits')
      .select('id, status')
      .eq('listing_id', parsedId)
      .eq('buyer_id', buyerId)
      .eq('status', 'paid')
      .limit(1)
      .maybeSingle();

    if (error) {
      console.log('Unlock fee check failed:', error.message);
      return false;
    }

    return !!data;
  }

  // FIX (real bug, part of the same "stuck on waiting forever" report):
  // this used to filter on the raw `receiver_id` route param directly —
  // which is exactly the param that's missing/wrong on every
  // notification-deep-link entry point fixed above in checkRole(). Now
  // takes the RESOLVED id explicitly instead of quietly closing over
  // the possibly-empty route param, so a session created by the other
  // party is actually found even when this visit started from a push
  // notification.
  async function loadExistingMeetPaySession(currentUserId: string, otherId?: string) {
    const referenceId = isItemRequestChat ? item_request_id : listing_id;
    if (!referenceId || !otherId) return;

    const { data } = await supabase
      .from('meetpay_sessions')
      .select('*')
      .eq('reference_id', String(referenceId))
      .or(`and(buyer_id.eq.${currentUserId},seller_id.eq.${otherId}),and(buyer_id.eq.${otherId},seller_id.eq.${currentUserId})`)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (data) {
      setSession(data);
      if (data.status === 'confirmed') setConfirmed(true);
      // NEW: realtime sync (mirrors meetpay.tsx's subscribeToSession) —
      // without this, whichever side didn't just trigger the change (the
      // buyer waiting on the seller's PIN, or the seller waiting on the
      // buyer's confirmation) would have no way to find out except
      // backing out of the modal and reopening it.
      subscribeToSession(data.id);
    }
  }

  // NEW (part of the same "stuck on waiting forever" fix): even with a
  // correct otherId, loadExistingMeetPaySession() above only runs ONCE,
  // at mount. If the OTHER party creates the session AFTER this screen
  // is already open — the normal case, since arranging a deal is rarely
  // instant — there was no live subscription watching for that INSERT
  // (subscribeToSession() only ever subscribes to UPDATEs on a session
  // id this side already knows), so the side that didn't just create it
  // had no way to find out short of leaving and reopening the whole
  // chat screen. This listens from the moment the screen opens, so a
  // session created any time after is picked up live, no reopen needed.
  function subscribeToNewMeetPaySession(currentUserId: string, otherId?: string) {
    const referenceId = isItemRequestChat ? item_request_id : listing_id;
    if (!referenceId || !otherId) return;

    if (newSessionChannelRef.current) {
      supabase.removeChannel(newSessionChannelRef.current);
      newSessionChannelRef.current = null;
    }

    const channel = supabase
      .channel(`chat-meetpay-new-${referenceId}-${currentUserId}`)
      .on('postgres_changes', {
        event: 'INSERT', schema: 'public', table: 'meetpay_sessions',
        // postgres_changes filters can only compare one column — this
        // narrows to the right listing/item_request, but the same
        // reference_id can have sessions for OTHER buyer/seller pairs
        // (a listing can have several different buyers), so the pair
        // itself is verified client-side below before accepting it.
        filter: `reference_id=eq.${String(referenceId)}`,
      }, (payload) => {
        const row = payload.new as any;
        if (!row) return;
        const belongsToThisPair =
          (row.buyer_id === currentUserId && row.seller_id === otherId) ||
          (row.seller_id === currentUserId && row.buyer_id === otherId);
        if (belongsToThisPair) {
          setSession(row);
          if (row.status === 'confirmed') setConfirmed(true);
          subscribeToSession(row.id);
        }
      })
      .subscribe();

    newSessionChannelRef.current = channel;
  }

  function subscribeToSession(sessionId: string) {
    if (sessionChannelRef.current) {
      supabase.removeChannel(sessionChannelRef.current);
      sessionChannelRef.current = null;
    }

    const channel = supabase
      .channel(`chat-meetpay-session-${sessionId}`)
      .on('postgres_changes', {
        event: 'UPDATE', schema: 'public', table: 'meetpay_sessions',
        filter: `id=eq.${sessionId}`,
      }, (payload) => {
        if (payload.new) {
          setSession(payload.new);
          if ((payload.new as any).status === 'confirmed') setConfirmed(true);
        }
      })
      .subscribe();

    sessionChannelRef.current = channel;
  }

  const fetchMessages = async (uid: string, idOverride?: string) => {
    if (!listing_id && !request_id && !item_request_id) { setLoading(false); return; }

    let query = supabase.from('messages').select('*');
    query = isItemRequestChat
      ? query.eq('item_request_id', item_request_id as string)
      : isRequestChat
        ? query.eq('request_id', request_id as string)
        : query.eq('listing_id', parseInt(listing_id as string));

    const { data, error } = await query.order('created_at', { ascending: true });

    if (error) {
      console.log('fetchMessages error:', error.message);
      setLoading(false);
      return;
    }

    // FIX: falls back through idOverride (passed directly by init()/
    // subscribeToMessages before the resolvedReceiverId state update
    // has actually applied) then resolvedReceiverId (for later callers
    // like the AppState foreground refetch, which have no override to
    // pass) — see the resolvedReceiverId state declaration up top.
    const otherId = idOverride || (receiver_id as string | undefined) || resolvedReceiverId;
    const filtered = (data ?? []).filter((m: any) =>
      !otherId ||
      (m.sender_id === uid && m.receiver_id === otherId) ||
      (m.sender_id === otherId && m.receiver_id === uid)
    );

    setMessages(filtered);
    setLoading(false);
  };

  function containsContactInfo(message: string): boolean {
    const cleaned = message.toLowerCase();

    const NUMBER_WORDS: Record<string, string> = {
      zero: '0', oh: '0', one: '1', two: '2', three: '3', four: '4',
      five: '5', six: '6', seven: '7', eight: '8', nine: '9',
    };
    let normalized = cleaned;
    for (const [word, digit] of Object.entries(NUMBER_WORDS)) {
      normalized = normalized.replace(new RegExp(`\\b${word}\\b`, 'g'), digit);
    }
    normalized = normalized
      .replace(/\s*\(at\)\s*|\s*\[at\]\s*|\s+at\s+/g, '@')
      .replace(/\s*\(dot\)\s*|\s*\[dot\]\s*|\s+dot\s+/g, '.');

    const emailPattern = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i;
    if (emailPattern.test(normalized)) return true;

    const digitsOnly = normalized.replace(/[^0-9]/g, '');
    if (digitsOnly.length >= 7) {
      const phonePattern = /(\+?\d[\s-]?){7,}/;
      if (phonePattern.test(normalized)) return true;
    }

    const contactWords = /(whatsapp|call me|text me|reach me|my number|contact me)/i;
    if (contactWords.test(normalized) && /\d{4,}/.test(normalized)) return true;

    const stripped = cleaned.replace(/\s+/g, '');
    const providerPattern = /(gmail|yahoo|hotmail|outlook|icloud|protonmail)(dot)?(com|co\w{0,3}|net|org)/i;
    if (providerPattern.test(stripped)) return true;

    return false;
  }

  const sendMessage = async () => {
    // See isSendingRef's declaration for the evidence behind this.
    if (isSendingRef.current) return;

    if (!text.trim()) return;

    if (!chatUnlocked && containsContactInfo(text)) {
      setContactWarning(true);
      setTimeout(() => setContactWarning(false), 4000);
      return;
    }

    // FIX (real bug, matching a directly reported "messages vanish
    // mid-conversation" issue): this used to call
    // supabase.auth.getSession() fresh, every single time a message
    // was sent — a known Supabase gotcha. If this client hasn't fully
    // finished restoring a persisted session from storage yet (a real
    // timing race, especially right after the app is backgrounded and
    // resumed, or on a fast cold start straight into a chat via a
    // deep link/notification), getSession() can momentarily return
    // null even though a valid anonymous session already exists on
    // this device. That null incorrectly triggered
    // signInAnonymously() again, minting a BRAND NEW anonymous
    // identity mid-conversation. Every message sent before that point
    // then permanently stopped matching this screen's own sender/
    // receiver filter (myId no longer equals the id those earlier
    // messages were sent under), making them vanish from view for
    // BOTH sides — even though they were, and still are, safely
    // sitting untouched in the database the whole time. This is a
    // display/filtering bug, not real data loss.
    //
    // Fix: trust the component's own myId state first — already
    // established once, correctly, when this screen first loaded (see
    // init() above) — rather than re-querying getSession() on every
    // single send and risking this exact race repeatedly. Only falls
    // back to a fresh check/sign-in if myId is genuinely still empty.

    // Held for the whole round trip, not just the insert: the awaits
    // below (getSession / signInAnonymously) are part of the same
    // window, and finally{} guarantees the flag clears on every exit
    // path — including the four early returns inside.
    isSendingRef.current = true;
    try {
      let currentUid = myId;

      if (!currentUid) {
        const { data: { session: existingSession } } = await supabase.auth.getSession();
        if (existingSession) {
          currentUid = existingSession.user.id;
          setMyId(currentUid);
        } else {
          const { data, error } = await supabase.auth.signInAnonymously();
          if (error) {
            console.log('Anonymous sign-in failed:', error.message);
            setSendError('Couldn\'t send — please check your connection and try again.');
            return;
          }
          currentUid = data.session?.user?.id ?? '';
          setMyId(currentUid);
        }
      }

      if (!currentUid) return;

      setSendError('');
      const { data: sentMessage, error: insertError } = await supabase
        .from('messages')
        .insert({
          text: text.trim(),
          sender_id: currentUid,
          // FIX: was `receiver_id || null` — the raw route param. For an
          // operator arriving via the "quote accepted" push notification
          // (no receiver_id in that deep link), this silently inserted
          // receiver_id: null on every message they sent, which the
          // customer's own fetchMessages() then filtered out entirely —
          // see the resolvedReceiverId state declaration up top for the
          // full trace. resolvedReceiverId covers that case; falls back
          // to the raw param first since it's already correct whenever
          // present (the customer's own entry point always sets it).
          receiver_id: (receiver_id as string | undefined) || resolvedReceiverId || null,
          listing_id: !isRequestChat && !isItemRequestChat && listing_id ? parseInt(listing_id as string) : null,
          request_id: isRequestChat ? request_id : null,
          item_request_id: isItemRequestChat ? item_request_id : null,
        })
        .select()
        .single();

      if (insertError) {
        console.log('sendMessage insert failed:', insertError.message);
        setSendError('Couldn\'t send: ' + insertError.message);
        return;
      }

      if (sentMessage) {
        setMessages((prev) => (prev.some((m) => m.id === sentMessage.id) ? prev : [...prev, sentMessage]));
      }

      setText('');
      setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 100);
    } finally {
      isSendingRef.current = false;
    }
  };

  async function goToUnlock() {
    router.push(
      `/unlock?listing_id=${listing_id}&seller_id=${receiver_id}&price=${listingPrice ?? ''}`
    );
  }

  function goToWantedResponses() {
    router.push(`/wanted-responses?request_id=${item_request_id}`);
  }

  const isBuyerRole = isItemRequestChat ? isOwnerOfListing : !isOwnerOfListing;
  isBuyerRoleRef.current = isBuyerRole;

  function handleArrangeDealPress() {
    if (isItemRequestChat) {
      if (!isBuyerRole) {
        openMeetPay();
        return;
      }
      if (depositPaid) { setDealModal(true); return; }
      goToWantedResponses();
      return;
    }
    if (!isBuyerRole) {
      openMeetPay();
      return;
    }
    if (depositPaid) { setDealModal(true); return; }
    goToUnlock();
  }

  async function openMeetPay() {
    if (!depositPaid) return;
    setPinError('');
    setMeetPayModal(true);

    if (isBuyerRole && !session) {
      // FIX (part of the delivery_bookings/meetpay_sessions RPC
      // redesign): this used to insert the session directly from the
      // client, generating and setting the PIN itself and trusting its
      // own buyer_id/seller_id params. That direct insert path had no
      // restriction preventing a buyer from inserting a session
      // pre-marked status='confirmed', or fabricating buyer_id/seller_id
      // entirely. create_meetpay_session() now derives both parties
      // server-side from the real listing/item_request/quote records.
      //
      // CHANGED (PIN-role reversal): create_meetpay_session() no longer
      // generates a PIN at all — the buyer just arranges the deal here.
      // Both parties meet in person first; once they're happy, the
      // SELLER generates the PIN (see regeneratePin(), now seller-only)
      // and the buyer enters it to confirm. So no PIN exists yet at this
      // point, and there's nothing to notify about.
      const { data, error } = await supabase.rpc('create_meetpay_session', {
        p_type: isItemRequestChat ? 'item_request' : 'listing',
        p_reference_id: isItemRequestChat ? String(item_request_id) : String(listing_id),
        p_amount: isItemRequestChat ? null : listingPrice,
      });

      if (error) { setPinError(error.message); return; }
      setSession(data);
      subscribeToSession(data.id);
    } else if (session) {
      subscribeToSession(session.id);
    } else {
      // NEW (belt-and-braces, same reasoning as elsewhere in this app):
      // the live subscribeToNewMeetPaySession() listener set up in
      // init() should already catch a session the other party creates
      // while this screen is open — but if that channel silently
      // dropped (e.g. the app was backgrounded a long time and
      // reconnected wrong, a real possibility with realtime
      // websockets), reopening this modal re-queries fresh instead of
      // trusting possibly-stale local state forever.
      const otherId = resolvedReceiverId || (receiver_id as string | undefined);
      if (otherId) loadExistingMeetPaySession(myId, otherId);
    }
  }

  // NEW (meetpay_seller_agreed_step migration): formal middle step
  // between "buyer arranged the deal" and "seller generates the PIN" —
  // the seller taps this once they're genuinely willing to go through
  // with the meetup. agree_to_meetpay() checks server-side that the
  // caller is this session's seller and that it's still pending, same
  // guard pattern regenerate_meetpay_pin() below already uses.
  async function agreeToMeet() {
    if (!session) return;
    setPinError('');

    const { data, error } = await supabase.rpc('agree_to_meetpay', {
      p_session_id: session.id,
    });

    if (error) { setPinError(error.message); return; }
    setSession(data);

    // Local-device-only reminder for the seller. TRIMMED (deliberate
    // simplification, meetpay_seller_agreed_trim_push migration): this
    // event does NOT also push to the buyer's device the way PIN
    // generation/confirmation do — the buyer instead picks it up
    // through the realtime subscription already set up in init()
    // (subscribeToSession / subscribeToNewMeetPaySession), which is
    // free once a session exists and covers the common case (buyer has
    // the chat open). The gap this accepts: no OS-level push if the
    // buyer's app is closed when the seller agrees — considered an
    // acceptable trade for skipping a second edge-function branch and
    // DB trigger for a smaller step than PIN generation or final
    // confirmation.
    notifyAgreedToMeet(isItemRequestChat ? 'this item' : 'this listing');
  }

  // CHANGED (PIN-role reversal): regenerate_meetpay_pin() now requires
  // the caller to be the session's SELLER (previously the buyer) — see
  // the reverse_meetpay_pin_roles migration. This is now how the seller
  // generates the very first PIN too, not just a refresh: the PIN is
  // null from session creation onward until the seller calls this.
  async function regeneratePin() {
    if (!session) return;

    // FIX: was a direct, unguarded update to `pin`/`pin_expires_at` —
    // regenerate_meetpay_pin() now checks server-side that the caller is
    // genuinely this session's seller and that the session is still
    // pending before generating a new PIN.
    const { data, error } = await supabase.rpc('regenerate_meetpay_pin', {
      p_session_id: session.id,
    });

    if (error) { setPinError(error.message); return; }
    setSession(data);

    // Local-device-only reminder for the seller who just generated it —
    // see lib/notifications.ts for why this can't reach the buyer's
    // device directly.
    notifyMeetPayPinGenerated(isItemRequestChat ? 'this item' : 'this listing');
  }

  // CHANGED (PIN-role reversal): confirm_meetpay_pin() now requires the
  // caller to be the session's BUYER (previously the seller) — the
  // buyer is the one entering the PIN the seller just showed them, to
  // confirm they received the goods.
  async function handleConfirmPin() {
    setPinError('');
    if (enteredPin.length !== 4) { setPinError('Enter the 4-digit PIN.'); return; }
    if (!session) { setPinError('No active session found.'); return; }
    if (secondsLeft === 0) { setPinError('This PIN has expired. Ask the seller for a new one.'); return; }
    if (enteredPin !== session.pin) { setPinError('Incorrect PIN.'); return; }

    setConfirming(true);
    // FIX (part of the delivery_bookings/meetpay_sessions RPC redesign):
    // this used to be a direct .update() guarded only by whatever
    // .eq()s this specific query happened to include — real protection,
    // but only as strong as "the official app always sends this exact
    // query." confirm_meetpay_pin() now makes the buyer-only + PIN
    // match + not-expired checks the database's own problem, the same
    // pattern confirm_delivery_pin() already uses in dealer.tsx.
    const { data, error } = await supabase.rpc('confirm_meetpay_pin', {
      p_session_id: session.id,
      p_entered_pin: enteredPin,
    });
    setConfirming(false);

    if (error) {
      setPinError(error.message || 'This PIN just changed — ask the seller for the current one and try again.');
      return;
    }
    setSession(data);
    setConfirmed(true);

    notifyTransactionConfirmed('this listing');
  }

  function formatTime(s: number) {
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${m}:${sec.toString().padStart(2, '0')}`;
  }

  if (!depositChecked) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={GOLD} />
      </View>
    );
  }

  return (
    // KeyboardAvoidingView still does the work in the native apps. On the
    // website it is inert — the browser emits no keyboard events — so the
    // padding below is what keeps the message input above the keyboard
    // there. Both are harmless where the other applies: the inset is
    // always 0 on native, and the component is a plain View on web.
    <KeyboardAvoidingView
      style={[styles.container, webKeyboardInset > 0 && { paddingBottom: webKeyboardInset }]}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <StatusBar style="light" />

      <View style={styles.header}>
        <View style={styles.headerLeft}>
          {/* FIX (real user report: "the back tab is not reacting"):
              plain router.back() has nothing to go back to when this
              screen is the first thing on the stack — and chat.tsx is
              the deep-link destination for 11 different push
              notification types (see _layout.tsx's notification
              response handler: message, unlock, wanted_match,
              trip_deposit, meetpay, etc. all router.push('/chat...')).
              Tapping a notification to cold-launch the app lands here
              with no screen behind it, so the back arrow silently did
              nothing. Falls back to the conversations list instead. */}
          <TouchableOpacity onPress={() => (router.canGoBack() ? router.back() : router.replace('/messages'))}>
            <Text style={styles.backBtn}>‹</Text>
          </TouchableOpacity>
          <View style={styles.avatarWrap}>
            <View style={styles.avatar}>
              <Text style={styles.avatarText}>{getInitials(otherPersonName)}</Text>
            </View>
            <View style={styles.onlineDot} />
          </View>
          {/* NEW: flex:1 + minWidth:0 so this column actually shrinks
              instead of pushing the "Confirm sale" pill off-screen —
              neither View nor Text shrinks by default in RN. Belt-and-
              braces alongside the wording trim above: a long name alone
              could still reproduce the same overflow without this. */}
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={styles.sellerName} numberOfLines={1} ellipsizeMode="tail">
              {otherPersonName || 'ImbizoHub Chat'}
            </Text>
            <Text style={styles.onlineStatus}>Online now</Text>
          </View>
        </View>
        <View style={styles.headerRight}>
          {/* Van-hire: the same pill, routed to the dedicated mutual-
              confirmation screen instead of the in-chat PIN modal.
              Only appears once a quote has actually been accepted —
              before that there is no trip to confirm. Shown to BOTH
              sides; meetpay.tsx decides which half you are confirming. */}
          {isRequestChat && acceptedQuoteId && (
            <TouchableOpacity
              style={styles.meetPayHeaderBtn}
              onPress={() => router.push(`/meetpay?type=van_hire&reference_id=${acceptedQuoteId}`)}
            >
              <Text style={styles.meetPayHeaderIcon}>🔒</Text>
              <Text style={styles.meetPayHeaderText}>
                {iAmTheOperator ? 'Trip completed' : 'Service delivered'}
              </Text>
            </TouchableOpacity>
          )}
          {!isRequestChat && (listing_id || isItemRequestChat) && (
            <TouchableOpacity
              style={styles.meetPayHeaderBtn}
              onPress={handleArrangeDealPress}
            >
              <Text style={styles.meetPayHeaderIcon}>🔒</Text>
              <Text style={styles.meetPayHeaderText}>
                {/* CHANGED (PIN-role reversal): the seller no longer
                    confirms a PIN — they generate one, after meeting the
                    buyer and both being happy. */}
                {/* CHANGED (wording, real feedback: "would it be not
                    confusing to read meet and sell/pay" — seller-only):
                    was 'Meet & Pay', the shared feature name, then
                    briefly 'Generate handoff PIN', then 'Confirm sale
                    and handover'. TRIMMED to just 'Confirm sale' —
                    the longer version was overflowing off-screen next
                    to a long buyer/seller name in the header (headerLeft
                    and this pill don't shrink by default in RN), which
                    is the actual bug being fixed here; shorter wording
                    everywhere this label appears ('across the board',
                    per direct product decision) is a cheaper fix than
                    reworking the header layout. The seller's actual
                    button inside this flow still says "Generate PIN",
                    and the buyer is still the one who literally enters
                    the PIN to confirm (see confirm_meetpay_pin() and
                    handleConfirmPin() below) — this pill label is just
                    the entry point's name. Text-only change: no logic,
                    PIN flow, or rating eligibility touched. */}
                {isBuyerRole ? 'Arrange deal' : 'Confirm sale'}
              </Text>
            </TouchableOpacity>
          )}
          {(receiver_id || resolvedReceiverId) && (
            <TouchableOpacity
              style={styles.reportIconBtn}
              onPress={() => router.push(
                `/report-user?user_id=${receiver_id || resolvedReceiverId}&name=${encodeURIComponent(otherPersonName || '')}&context=chat`
              )}
            >
              <Text style={styles.reportIconText}>⚑</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>

      {/* A sold item must not keep advertising a paid unlock. The
          listing page already refuses (it shows "This item has been
          sold" instead of an action), but a buyer already sitting in
          the chat never saw that page again — so this was the one
          surface still inviting someone to pay for something gone. */}
      {listingSold && !isRequestChat && (
        <View style={styles.warningBar}>
          <Text style={styles.warningIcon}>🔒</Text>
          <Text style={styles.warningText}>
            This item has been marked as sold. You can still message each other,
            but there is nothing left to unlock.
          </Text>
        </View>
      )}

      {isBuyerRole && !depositPaid && !isRequestChat && !listingSold && (
        <View style={styles.warningBar}>
          <Text style={styles.warningIcon}>💬</Text>
          <Text style={styles.warningText}>
            {isItemRequestChat
              ? 'Chat is free — accept this response (and pay the small commission) when you\'re ready to unlock contact info and arrange collection or delivery.'
              : 'Chat is free — you\'ll only pay a small fee when you\'re ready to arrange Meet & Pay or delivery.'}
          </Text>
        </View>
      )}

      {contactWarning && (
        <View style={styles.contactWarningBar}>
          <Text style={styles.contactWarningText}>
            ⚠️ Sharing phone numbers or emails in chat isn't allowed until this deal is confirmed. {isItemRequestChat ? 'Accept and pay to unlock contact info.' : 'Use Meet & Pay to safely exchange contact info.'}
          </Text>
        </View>
      )}

      {sendError ? (
        <View style={styles.contactWarningBar}>
          <Text style={styles.contactWarningText}>⚠️ {sendError}</Text>
        </View>
      ) : null}

      {loading ? (
        <ActivityIndicator color={GOLD} style={{ marginTop: 40 }} />
      ) : (
        <ScrollView
          ref={scrollRef}
          style={styles.messages}
          onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: true })}
        >
          <View style={styles.dateStamp}>
            <Text style={styles.dateText}>Today</Text>
          </View>

          {messages.length === 0 && (
            <Text style={{ color: GREY, textAlign: 'center', marginTop: 20 }}>
              {isOwnerOfListing
                ? 'No messages yet.'
                : 'No messages yet. Try asking if it\u2019s still available or negotiable.'}
            </Text>
          )}

          {messages.map((msg) => {
            const isMine = msg.sender_id === myId;
            return (
              <View key={msg.id} style={[styles.msgRow, isMine && styles.msgRowMine]}>
                {!isMine && (
                  <View style={styles.msgAvatar}>
                    <Text style={styles.msgAvatarText}>{getInitials(otherPersonName)}</Text>
                  </View>
                )}
                <View style={styles.bubble}>
                  <View style={isMine ? styles.bubbleBuyer : styles.bubbleSeller}>
                    <Text style={isMine ? styles.bubbleTextBuyer : styles.bubbleTextSeller}>
                      {msg.text}
                    </Text>
                  </View>
                  <Text style={[styles.msgTime, isMine && styles.msgTimeMine]}>
                    {new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    {isMine ? ' · ✓✓' : ''}
                  </Text>
                </View>
              </View>
            );
          })}

          <View style={{ height: 80 }} />
        </ScrollView>
      )}

      <View style={[styles.inputRow, { paddingBottom: 10 + insets.bottom }]}>
        <Text style={styles.attachIcon}>📎</Text>
        <TextInput
          style={styles.inputBar}
          placeholder="Type a message..."
          placeholderTextColor="#555"
          value={text}
          onChangeText={setText}
          onSubmitEditing={sendMessage}
        />
        <TouchableOpacity style={styles.sendBtn} onPress={sendMessage}>
          <Text style={styles.sendIcon}>➤</Text>
        </TouchableOpacity>
      </View>

      <Modal visible={dealModal} animationType="slide" transparent onRequestClose={() => setDealModal(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalSheet}>
            <Text style={styles.modalTitle}>Arrange the deal</Text>
            <Text style={styles.modalBody}>
              {isItemRequestChat
                ? 'How would you like to receive this?'
                : 'How would you like to complete this transaction?'}
            </Text>

            <TouchableOpacity
              style={styles.dealOption}
              onPress={() => { setDealModal(false); openMeetPay(); }}
            >
              <View style={styles.dealOptionIcon}>
                <Text style={{ fontSize: 28 }}>🤝</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.dealOptionTitle}>
                  {isItemRequestChat ? 'Meet & Collect' : 'Meet & Pay'}
                </Text>
                <Text style={styles.dealOptionDesc}>
                  {isItemRequestChat
                    ? 'Meet in person, hand over the item, and confirm with a PIN. Best for same-city arrangements.'
                    : 'Meet the seller in person, inspect the item, and confirm with a PIN. Best for same-city trades.'}
                </Text>
              </View>
              <Text style={styles.dealOptionArrow}>›</Text>
            </TouchableOpacity>

            {(!isItemRequestChat || itemIsPhysical) && (
              <TouchableOpacity
                style={styles.dealOption}
                onPress={() => {
                  // NEW: Book & Deliver is paused for new bookings — see
                  // lib/featureFlags.ts's own header comment for why.
                  // Keeps the option visible (per product decision) but
                  // explains it's temporary instead of silently doing
                  // nothing or navigating to a broken/empty flow.
                  if (!DELIVERY_BOOKING_ENABLED) {
                    setDealModal(false);
                    Alert.alert(DELIVERY_PAUSED_TITLE, DELIVERY_PAUSED_MESSAGE);
                    return;
                  }
                  setDealModal(false);
                  const deliveryParams = isItemRequestChat
                    ? `item_request_id=${item_request_id}&seller_id=${receiver_id}`
                    : `listing_id=${listing_id}&seller_id=${receiver_id}&listing_price=${listingPrice ?? 0}`;
                  router.push(`/delivery-booking?${deliveryParams}`);
                }}
              >
                <View style={styles.dealOptionIcon}>
                  <Text style={{ fontSize: 28 }}>📦</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.dealOptionTitle}>Book delivery</Text>
                  <Text style={styles.dealOptionDesc}>
                    A registered driver delivers the item to you. Rate depends on item size — see next screen.
                  </Text>
                </View>
                <Text style={styles.dealOptionArrow}>›</Text>
              </TouchableOpacity>
            )}

            <TouchableOpacity style={styles.cancelLink} onPress={() => setDealModal(false)}>
              <Text style={styles.cancelLinkText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      <Modal visible={meetPayModal} animationType="slide" transparent onRequestClose={() => setMeetPayModal(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalSheet}>

            {confirmed ? (
              <View style={{ alignItems: 'center', paddingVertical: 10 }}>
                <Text style={{ fontSize: 56, marginBottom: 16 }}>✅</Text>
                <Text style={styles.modalTitle}>Transaction confirmed!</Text>
                {/* CHANGED (PIN-role reversal): the buyer is now the
                    one who performs the confirming action (entering the
                    seller's PIN); the seller receives it passively. */}
                <Text style={styles.modalBody}>
                  {isBuyerRole
                    ? (isItemRequestChat ? 'You confirmed you received the item.' : 'You confirmed you received the goods.')
                    : (isItemRequestChat ? 'The buyer confirmed receipt. Thank you for using ImbizoHub safely.' : 'The buyer confirmed receipt. Thank you for using ImbizoHub safely.')}
                </Text>
                {/* FIX (real bug, found during a thorough review):
                    this used to always interpolate listing_id
                    directly, even for item-request (Wanted-tab)
                    chats — where listing_id is genuinely undefined,
                    producing the literal string "listing_id=undefined"
                    in the URL rather than an empty value. dealModal's
                    delivery-booking link, a few functions away in this
                    same file, already correctly branches on
                    isItemRequestChat for the exact same distinction;
                    this spot just hadn't gotten the same treatment. */}
                <TouchableOpacity
                  style={styles.modalBtn}
                  onPress={() => {
                    setMeetPayModal(false);
                    const ratingListingParam = isItemRequestChat ? '' : (listing_id ?? '');
                    router.push(
                      `/rating?session_id=${session?.id}&reviewee_id=${receiver_id}&role=${isBuyerRole ? 'buyer' : 'seller'}&listing_id=${ratingListingParam}`
                    );
                  }}
                >
                  <Text style={styles.modalBtnText}>⭐ Rate this transaction</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.cancelLink} onPress={() => setMeetPayModal(false)}>
                  <Text style={styles.cancelLinkText}>Skip for now</Text>
                </TouchableOpacity>
              </View>
            ) : isBuyerRole ? (
              // CHANGED (PIN-role reversal): the buyer arranged the deal
              // (created the session) but no longer generates a PIN —
              // they meet the seller first, and once the seller
              // generates a PIN, the buyer enters it here to confirm
              // they received the goods.
              // CHANGED (wording, buyer-only — completes the pairing
              // with the seller's "Confirm sale and handover" modal:
              // was 'Meet & Collect'/'Meet & Pay', the shared feature
              // name — this modal is specifically the buyer's
              // PIN-entry/confirm screen, so it now says what the buyer
              // is actually doing here. The initial "Arrange deal"
              // chooser (a few screens back, where they pick Meet & Pay
              // vs delivery) is intentionally left unchanged — it's
              // naming two different options in a menu, not a single
              // confirm action, so "Confirm handover" wouldn't fit
              // there. Text-only.
              <>
                <Text style={styles.modalTitle}>Confirm handover</Text>
                <Text style={styles.modalBody}>
                  {session?.pin
                    ? 'Enter the PIN the seller shows you once you\'ve inspected the item and you\'re both happy to complete the deal.'
                    : session?.seller_agreed_at
                      // NEW (meetpay_seller_agreed_step): the seller has
                      // committed to the meetup — different wording from
                      // the plain "still waiting" state below, since
                      // there's now something concrete to act on
                      // (coordinating a time), not just waiting blind.
                      ? 'The seller agreed to meet! Coordinate a time in chat, then wait for them to show you the PIN.'
                      : 'Meet the seller in person first. Once you\'re both happy, ask them to generate a PIN so you can confirm here.'}
                </Text>

                {pinError ? <Text style={styles.modalError}>⚠️ {pinError}</Text> : null}

                {!session || !session.pin ? (
                  <View style={styles.waitingBox}>
                    <ActivityIndicator color={GOLD} style={{ marginBottom: 10 }} />
                    <Text style={styles.waitingText}>
                      {session?.seller_agreed_at
                        ? 'Waiting for the seller to generate a PIN...'
                        : 'Waiting for the seller to agree to meet...'}
                    </Text>
                  </View>
                ) : (
                  <>
                    <TextInput
                      style={styles.pinInput}
                      value={enteredPin}
                      onChangeText={(t) => setEnteredPin(t.replace(/[^0-9]/g, '').slice(0, 4))}
                      placeholder="0000"
                      placeholderTextColor="#555"
                      keyboardType="number-pad"
                      maxLength={4}
                    />
                    <TouchableOpacity
                      style={[styles.modalBtn, (confirming || enteredPin.length !== 4) && { opacity: 0.5 }]}
                      onPress={handleConfirmPin}
                      disabled={confirming || enteredPin.length !== 4}
                    >
                      {confirming
                        ? <ActivityIndicator color={BLACK} />
                        : <Text style={styles.modalBtnText}>Confirm handover</Text>
                      }
                    </TouchableOpacity>
                  </>
                )}

                <TouchableOpacity style={styles.cancelLink} onPress={() => setMeetPayModal(false)}>
                  <Text style={styles.cancelLinkText}>Close</Text>
                </TouchableOpacity>
              </>
            ) : (
              // CHANGED (PIN-role reversal): the seller no longer
              // confirms the buyer's PIN — once they've met the buyer
              // and both are happy, the seller generates the PIN here
              // and shows it to the buyer, who enters it to confirm.
              // CHANGED (wording, seller-only — see the matching header
              // pill comment above): was 'Meet & Collect'/'Meet & Pay',
              // then 'Generate handoff PIN', then 'Confirm sale and
              // handover', now trimmed to 'Confirm sale' — kept in
              // sync with the header pill that opens this exact modal.
              // Text-only.
              <>
                <Text style={styles.modalTitle}>Confirm sale</Text>
                <Text style={styles.modalBody}>
                  {!session
                    ? 'Waiting for the buyer to arrange the deal.'
                    // NEW (meetpay_seller_agreed_step): the middle step —
                    // a session exists but this seller hasn't yet
                    // committed to the meetup.
                    : !session.seller_agreed_at
                      ? 'The buyer wants to arrange a meetup. Once you\'re genuinely ready to go through with it, agree to meet — then coordinate a time in chat.'
                      : 'Once you\'ve met the buyer and you\'re both happy, generate a PIN and show it to them to confirm they received the goods.'}
                </Text>

                {pinError ? <Text style={styles.modalError}>⚠️ {pinError}</Text> : null}

                {!session ? (
                  <View style={styles.waitingBox}>
                    <ActivityIndicator color={GOLD} style={{ marginBottom: 10 }} />
                    <Text style={styles.waitingText}>Waiting for the buyer to arrange the deal...</Text>
                  </View>
                ) : !session.seller_agreed_at ? (
                  <TouchableOpacity style={styles.modalBtn} onPress={agreeToMeet}>
                    <Text style={styles.modalBtnText}>Agree to meet</Text>
                  </TouchableOpacity>
                ) : !session.pin ? (
                  <TouchableOpacity style={styles.modalBtn} onPress={regeneratePin}>
                    <Text style={styles.modalBtnText}>Generate PIN</Text>
                  </TouchableOpacity>
                ) : (
                  <>
                    <View style={styles.pinCard}>
                      <Text style={styles.pinLabel}>Your PIN</Text>
                      <Text style={styles.pinDisplay}>{session.pin}</Text>
                      <Text style={[styles.pinTimer, secondsLeft < 60 && { color: '#ff8a8a' }]}>
                        {secondsLeft > 0 ? `Expires in ${formatTime(secondsLeft)}` : 'Expired'}
                      </Text>
                    </View>

                    <TouchableOpacity style={styles.regenBtn} onPress={regeneratePin}>
                      <Text style={styles.regenBtnText}>
                        {secondsLeft === 0 ? 'Generate new PIN' : 'Get a new PIN'}
                      </Text>
                    </TouchableOpacity>
                  </>
                )}

                <TouchableOpacity style={styles.cancelLink} onPress={() => setMeetPayModal(false)}>
                  <Text style={styles.cancelLinkText}>Close</Text>
                </TouchableOpacity>
              </>
            )}

          </View>
        </View>
      </Modal>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#111111' },
  center: { flex: 1, backgroundColor: '#111', alignItems: 'center', justifyContent: 'center' },
  header: { backgroundColor: BLACK, padding: 16, paddingTop: 50, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  // NEW: flexShrink/minWidth so headerLeft actually compresses instead
  // of overflowing the row (RN views don't shrink by default) — see the
  // header JSX comment where this is paired with the name's
  // numberOfLines. headerRight stays flexShrink:0 so the pill keeps its
  // full size and headerLeft gives way instead.
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: 10, flexShrink: 1, minWidth: 0 },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: 8, flexShrink: 0 },
  reportIconBtn: { width: 34, height: 34, borderRadius: 17, backgroundColor: DARK, alignItems: 'center', justifyContent: 'center' },
  reportIconText: { color: '#888', fontSize: 14 },
  backBtn: { color: '#fff', fontSize: 22 },
  avatarWrap: { position: 'relative' },
  avatar: { width: 38, height: 38, backgroundColor: GOLD, borderRadius: 19, alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: BLACK, fontSize: 14, fontWeight: '800' },
  onlineDot: { position: 'absolute', bottom: 0, right: 0, width: 10, height: 10, backgroundColor: '#4A90D9', borderRadius: 5, borderWidth: 2, borderColor: BLACK },
  sellerName: { color: '#fff', fontSize: 14, fontWeight: '700' },
  onlineStatus: { color: '#4A90D9', fontSize: 11 },
  meetPayHeaderBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: DARK, borderRadius: 20, paddingHorizontal: 12, paddingVertical: 7, borderWidth: 1, borderColor: GOLD },
  meetPayHeaderIcon: { fontSize: 13 },
  meetPayHeaderText: { color: GOLD, fontSize: 12, fontWeight: '700' },
  warningBar: { backgroundColor: '#1a1a2e', padding: 8, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', gap: 8, borderBottomWidth: 0.5, borderBottomColor: '#333' },
  warningIcon: { fontSize: 14 },
  warningText: { color: '#8888ff', fontSize: 11, flex: 1 },
  contactWarningBar: { backgroundColor: '#3a1a1a', padding: 10, paddingHorizontal: 16, borderBottomWidth: 0.5, borderBottomColor: '#5a2a2a' },
  contactWarningText: { color: '#ff8a8a', fontSize: 11, lineHeight: 16 },
  messages: { flex: 1, backgroundColor: '#111', padding: 16 },
  dateStamp: { alignItems: 'center', marginBottom: 16 },
  dateText: { color: '#444', fontSize: 10, backgroundColor: '#1a1a1a', paddingHorizontal: 10, paddingVertical: 3, borderRadius: 20 },
  msgRow: { flexDirection: 'row', gap: 8, marginBottom: 14, alignItems: 'flex-end' },
  msgRowMine: { justifyContent: 'flex-end' },
  msgAvatar: { width: 28, height: 28, backgroundColor: GOLD, borderRadius: 14, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  msgAvatarText: { color: BLACK, fontSize: 10, fontWeight: '800' },
  bubble: { maxWidth: '70%' },
  bubbleSeller: { backgroundColor: DARK, borderRadius: 14, borderBottomLeftRadius: 2, padding: 10, borderWidth: 0.5, borderColor: '#333' },
  bubbleBuyer: { backgroundColor: GOLD, borderRadius: 14, borderBottomRightRadius: 2, padding: 10 },
  bubbleTextSeller: { color: '#fff', fontSize: 13, lineHeight: 20 },
  bubbleTextBuyer: { color: BLACK, fontSize: 13, lineHeight: 20 },
  msgTime: { color: '#444', fontSize: 10, marginTop: 3 },
  msgTimeMine: { textAlign: 'right' },
  inputRow: { backgroundColor: BLACK, padding: 10, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', gap: 10, borderTopWidth: 0.5, borderTopColor: DARK },
  attachIcon: { fontSize: 20, color: GREY },
  inputBar: { flex: 1, backgroundColor: DARK, borderRadius: 24, padding: 10, paddingHorizontal: 16, borderWidth: 0.5, borderColor: '#333', color: '#fff', fontSize: 13 },
  sendBtn: { width: 40, height: 40, backgroundColor: GOLD, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  sendIcon: { color: BLACK, fontSize: 18 },
  lockedInputRow: { backgroundColor: BLACK, padding: 16, paddingBottom: 30, flexDirection: 'row', alignItems: 'center', gap: 12, borderTopWidth: 0.5, borderTopColor: DARK },
  lockedIcon: { fontSize: 22 },
  lockedTitle: { color: '#fff', fontSize: 13, fontWeight: '700' },
  lockedSubtitle: { color: GREY, fontSize: 11, marginTop: 2 },
  lockedBtn: { backgroundColor: GOLD, borderRadius: 12, paddingHorizontal: 16, paddingVertical: 10 },
  lockedBtnText: { color: BLACK, fontSize: 13, fontWeight: '800' },
  modalOverlay: { flex: 1, width: '100%', backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end', alignItems: 'center' },
  modalSheet: { width: '100%', maxWidth: 640, alignSelf: 'center', backgroundColor: BLACK, borderTopLeftRadius: 22, borderTopRightRadius: 22, padding: 24, paddingBottom: 40 },
  modalTitle: { fontSize: 20, fontWeight: '800', color: '#fff', marginBottom: 8, textAlign: 'center' },
  modalBody: { fontSize: 13, color: GREY, textAlign: 'center', lineHeight: 19, marginBottom: 20 },
  modalError: { color: '#ff8a8a', fontSize: 13, textAlign: 'center', marginBottom: 14 },
  pinCard: { backgroundColor: '#111', borderRadius: 16, padding: 24, alignItems: 'center', marginBottom: 16, borderWidth: 1, borderColor: GOLD },
  pinLabel: { fontSize: 11, color: GREY, marginBottom: 8 },
  pinDisplay: { fontSize: 44, fontWeight: '800', color: GOLD, letterSpacing: 10 },
  pinTimer: { fontSize: 12, color: GREY, marginTop: 10 },
  regenBtn: { backgroundColor: DARK, borderRadius: 12, paddingVertical: 13, alignItems: 'center', marginBottom: 8 },
  regenBtnText: { color: GOLD, fontWeight: '700', fontSize: 13 },
  waitingBox: { backgroundColor: '#111', borderRadius: 14, padding: 28, alignItems: 'center', borderWidth: 0.5, borderColor: '#333' },
  waitingText: { fontSize: 13, color: GREY, textAlign: 'center' },
  pinInput: {
    backgroundColor: '#111', borderRadius: 12, fontSize: 32, fontWeight: '800',
    color: '#fff', textAlign: 'center', letterSpacing: 14, paddingVertical: 16,
    borderWidth: 1, borderColor: '#444', marginBottom: 16,
  },
  modalBtn: { backgroundColor: GOLD, borderRadius: 14, paddingVertical: 15, alignItems: 'center' },
  modalBtnText: { color: BLACK, fontSize: 15, fontWeight: '800' },
  cancelLink: { alignItems: 'center', paddingVertical: 12, marginTop: 4 },
  cancelLinkText: { color: GREY, fontSize: 13 },

  dealOption: { flexDirection: 'row', alignItems: 'center', gap: 14, backgroundColor: DARK, borderRadius: 14, padding: 16, marginBottom: 10, borderWidth: 0.5, borderColor: '#333' },
  dealOptionIcon: { width: 48, height: 48, backgroundColor: '#1a1a1a', borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  dealOptionTitle: { color: '#fff', fontSize: 14, fontWeight: '700', marginBottom: 3 },
  dealOptionDesc: { color: GREY, fontSize: 11, lineHeight: 16 },
  dealOptionArrow: { color: GOLD, fontSize: 22 },
});
