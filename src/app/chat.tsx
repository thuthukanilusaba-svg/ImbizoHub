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
//
// This required a real distinction the old `depositPaid` flag didn't
// make: `depositPaid` is set to true immediately for the OWNER (seller)
// of a listing, regardless of whether THIS BUYER has actually paid yet —
// it's a "do I have full messaging rights" flag, not "has money actually
// changed hands for this specific conversation." Gating contact-info
// directly on depositPaid would have let a seller share their number
// before any buyer ever paid. `chatUnlocked` (new) is computed
// separately and correctly for both directions: for a listing chat, it
// checks listing_deposits for whichever side is the BUYER in this
// specific conversation (receiver_id if I'm the seller, myId if I'm the
// buyer) — not just "am I the seller." For request/item-request chats,
// payment already happened before the chat was ever reachable, so it's
// unconditionally true, same as depositPaid already was for those.
//
// THIRD IDENTITY BRANCH ADDED (item_request_id): the Wanted tab. Buyer
// posts a want, sellers respond with a price, buyer accepts one and pays
// a 3% commission (wanted-responses.tsx) — that payment is what unlocks
// this chat in the first place, so unlike listing chats there is no
// SEPARATE "Arrange deal" fee gate here; the commission already paid to
// reach this screen IS the unlock. "Arrange deal" is hidden for these
// chats, same as it's hidden for van-hire (request_id) chats, since
// neither needs the listing-specific unlock-fee flow.
//
// NOT YET BUILT in this pass: a dedicated fulfillment-arrangement entry
// point for item-request chats (choosing Delivery vs Meet & Collect,
// per ImbizoHub_Wanted_Tab_Spec.md Section 2 step 5). For now these
// chats support free messaging only; buyer and seller coordinate
// fulfillment in plain conversation until that's built. This mirrors how
// the "Arrange deal" modal itself was added incrementally.

import { useLocalSearchParams, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Modal, Platform, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  notifyMeetPayPinGenerated,
  notifyNewMessage,
  notifyTransactionConfirmed
} from '../../lib/notifications';
import { supabase } from '../../lib/supabase';

const GOLD = '#B8860B';
const BLACK = '#1A1A18';
const DARK = '#2a2a2a';
const GREY = '#AAAAAA';

function generatePin(): string {
  return Math.floor(1000 + Math.random() * 9000).toString();
}

// FIX: real bug found via direct DB inspection — pin_expires_at is
// genuinely correct in the database (confirmed: a freshly-generated PIN
// showed ~764 seconds remaining via a raw SQL check), yet the app
// displayed "Expired" for it anyway. Root cause: Postgres's default
// text rendering for timestamptz is "2026-07-29 19:59:01.885+00" — a
// SPACE instead of 'T', and a 2-digit offset instead of the full
// "+00:00". JavaScript's native `Date` constructor is only guaranteed
// by spec to parse strict ISO 8601; this space-separated, short-offset
// variant is technically non-standard, and different JS engines handle
// it inconsistently — some parse it fine, others silently return an
// Invalid Date, whose getTime() is NaN. Every downstream comparison
// against NaN is false, so `secondsLeft > 0` was always false — showing
// "Expired" regardless of the real, correct time in the database.
//
// This normalizes the string into a form every engine reliably parses
// before handing it to `new Date(...)`, rather than trusting the native
// parser with an ambiguous format.
function parsePgTimestamp(value: string): number {
  const normalized = value
    .replace(' ', 'T')
    .replace(/([+-]\d{2})$/, '$1:00'); // "+00" -> "+00:00", "-05" -> "-05:00"
  return new Date(normalized).getTime();
}

// Derive initials from a full name for avatar display.
// Falls back to a generic person icon if no name is available.
function getInitials(name: string): string {
  if (!name) return '👤';
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export default function ChatScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { listing_id, receiver_id, openDeal, request_id, item_request_id } = useLocalSearchParams();
  // A chat is about exactly one of: a marketplace listing (listing_id), a
  // van-hire trip request (request_id), or a Wanted-tab item request
  // (item_request_id) — three separate identity models with separate
  // "who is the other person" semantics:
  //   listings.user_id is the seller
  //   requests.user_id is the customer who posted the trip, chatting with
  //     whichever operator they're paired with
  //   item_requests.user_id is the buyer who posted the want, chatting
  //     with whichever responder (seller) they accepted
  // Exactly one of these three should be present per navigation.
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
  // NEW: Dealer Pro benefit — buyers never pay the unlock fee on a
  // listing owned by an active Pro subscriber. Fetched alongside the
  // listing itself in checkRole() below, used to short-circuit
  // depositPaid/chatUnlocked to true for the buyer side without ever
  // needing a listing_deposits row. See unlock.tsx's matching bypass
  // and enforce_contact_info_block()'s widened server-side check —
  // this client-side flag is a convenience only, not the real
  // enforcement.
  const [sellerIsDealerPro, setSellerIsDealerPro] = useState(false);
  const [contactWarning, setContactWarning] = useState(false);
  // NEW: dedicated error slot for anonymous sign-in failures during
  // sendMessage() — kept separate from pinError (which belongs to the
  // Meet & Pay PIN flow) rather than reusing an unrelated field.
  const [sendError, setSendError] = useState('');
  const [otherPersonName, setOtherPersonName] = useState('');

  const [depositChecked, setDepositChecked] = useState(false);
  const [depositPaid, setDepositPaid] = useState(false);
  // NEW: see the top-of-file FIX comment — this is deliberately separate
  // from depositPaid, which means "do I personally have full messaging
  // rights" (true immediately for a listing's owner) rather than "has
  // money genuinely changed hands for THIS conversation." Contact-info
  // gating needs the latter, checked correctly for whichever side is the
  // buyer in this specific chat.
  const [chatUnlocked, setChatUnlocked] = useState(false);
  const [dealModal, setDealModal] = useState(false);
  const openDealHandled = useRef(false);

  // NEW: for item-request (Wanted) chats, whether the accepted response
  // is a physical item (deliverable via delivery-booking.tsx) or a
  // service (e.g. "a builder" — nothing to courier). Fetched alongside
  // checkRole() below. Irrelevant/unused for listing and trip-request
  // chats.
  const [itemIsPhysical, setItemIsPhysical] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function init() {
      const { data: { session } } = await supabase.auth.getSession();
      const uid = session?.user?.id ?? '';
      if (cancelled) return;
      setMyId(uid);

      const { owner, sellerIsDealerPro: isDealerProSeller } = await checkRole(uid);
      if (cancelled) return;

      await fetchOtherPersonName();
      if (cancelled) return;

      // NEW: Dealer Pro benefit — checked first, before the existing
      // owner/request-type branches, so a Pro seller's buyers never see
      // the unlock-fee warning bar or need a listing_deposits row at
      // all. See unlock.tsx's matching bypass and
      // enforce_contact_info_block()'s widened server-side check — this
      // is a convenience shortcut on top of the real DB-level check,
      // not a replacement for it.
      if (owner) {
        setDepositPaid(true);
      } else if (isDealerProSeller) {
        setDepositPaid(true);
      } else if (isRequestChat || isItemRequestChat) {
        // No arrange-deal fee concept for trip-request chats OR
        // item-request (Wanted) chats — both reach this screen only
        // after their own separate payment already happened (quotes.tsx's
        // 10% deposit for van hire, wanted-responses.tsx's 3% commission
        // for Wanted), so there's nothing further to unlock here. Treat
        // as "paid" so the "chat is free, unlock fee" warning bar (which
        // is listing-specific) doesn't show for either.
        setDepositPaid(true);
      } else {
        const paid = await checkDepositPaid(uid);
        if (cancelled) return;
        setDepositPaid(paid);
      }

      // NEW: chatUnlocked — see top-of-file FIX comment. Computed
      // independently of depositPaid's owner-convenience shortcut.
      if (isDealerProSeller) {
        setChatUnlocked(true);
      } else if (isRequestChat || isItemRequestChat) {
        // Payment already happened before this chat was ever reachable
        // (quotes.tsx / wanted-responses.tsx) — genuinely unlocked.
        setChatUnlocked(true);
      } else if (listing_id) {
        // Whichever side is the BUYER in this specific conversation —
        // if I'm the owner (seller), the buyer is the other participant
        // (receiver_id); if I'm not the owner, I am the buyer (uid).
        const buyerIdForThisChat = owner ? (receiver_id as string) : uid;
        if (buyerIdForThisChat) {
          const unlocked = await checkDepositPaid(buyerIdForThisChat);
          if (cancelled) return;
          setChatUnlocked(unlocked);
        }
      }

      setDepositChecked(true);

      await fetchMessages(uid);
      await loadExistingMeetPaySession(uid);

      // Channel name is unique per conversation (listing/request/item-
      // request + the two participants) instead of a shared static
      // "messages" name. Using a static name across every mount of this
      // screen meant re-navigating into chat (e.g. chat -> unlock -> back
      // to chat via router.replace(...&openDeal=1)) could try to attach a
      // second set of .on() callbacks to an already-subscribed channel
      // object with the same name, throwing "cannot add postgres_changes
      // callbacks for realtime:messages after subscribe()". A unique name
      // per conversation instance avoids collisions BETWEEN DIFFERENT
      // conversations, but on its own doesn't protect against the SAME
      // conversation's channel surviving a re-mount of this screen (e.g.
      // Expo Router keeping this screen instance alive across a
      // back/forward navigation instead of fully unmounting it, so this
      // effect's own cleanup below never got a chance to run). Since the
      // name is deterministic per conversation, re-running this effect
      // for the same conversation would otherwise try to .on() a channel
      // that's already subscribed and throw the exact same error.
      //
      // FIX: defensively look up and remove any channel already
      // registered under this exact name before creating a fresh one,
      // rather than assuming our own cleanup always ran first.
      if (!cancelled && (listing_id || request_id || item_request_id) && receiver_id && uid) {
        const convoKey = isItemRequestChat
          ? `item-${item_request_id}`
          : isRequestChat
            ? `req-${request_id}`
            : `listing-${listing_id}`;
        const channelName = `messages-${convoKey}-${receiver_id}-${uid}`;

        const staleChannels = supabase.getChannels().filter((ch) => ch.topic?.includes(channelName));
        staleChannels.forEach((ch) => supabase.removeChannel(ch));

        const channel = supabase
          .channel(channelName)
          .on('postgres_changes', {
            event: 'INSERT', schema: 'public', table: 'messages',
          }, (payload) => {
            const msg = payload.new;
            const belongsToThisConvo = isItemRequestChat
              ? item_request_id && msg.item_request_id === item_request_id
              : isRequestChat
                ? request_id && msg.request_id === request_id
                : listing_id && msg.listing_id === parseInt(listing_id as string);
            if (
              belongsToThisConvo &&
              (msg.sender_id === receiver_id || msg.receiver_id === receiver_id ||
               msg.sender_id === uid || msg.receiver_id === uid)
            ) {
              // Dedupe guard: the sender's own client already appended
              // this message optimistically in sendMessage() above — if
              // this realtime echo is for our own just-sent message,
              // skip re-adding it rather than showing it twice.
              setMessages((prev) => (prev.some((m) => m.id === msg.id) ? prev : [...prev, msg]));
              // Notify if the message is from the other person (not from me)
              if (msg.sender_id !== uid) {
                notifyNewMessage(
                  'ImbizoHub',
                  msg.text,
                  isItemRequestChat ? String(item_request_id) : isRequestChat ? String(request_id) : String(listing_id)
                );
              }
            }
          })
          .subscribe();

        channelRef.current = channel;
      }
    }

    init();

    return () => {
      cancelled = true;
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current);
        channelRef.current = null;
      }
    };
  }, []);

  const channelRef = useRef<any>(null);

  useEffect(() => {
    if (!session?.pin_expires_at || session.status !== 'pending') return;

    // FIX: secondsLeft starts at 0 (its useState default) and previously
    // only got its real value from setInterval's first tick, a full
    // second later — so right after generating (or regenerating) a
    // brand new PIN, the screen briefly showed "Expired" (secondsLeft
    // still 0) even though the PIN was genuinely fresh with ~15 minutes
    // left. Computing the real remaining time immediately here, before
    // the interval even starts, closes that gap — the correct time now
    // shows the instant a session exists, not a second later.
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

  // If we just arrived here after paying the unlock fee, open the deal
  // modal automatically instead of making the buyer tap "Arrange deal" again.
  useEffect(() => {
    if (isRequestChat || isItemRequestChat) return;
    if (openDeal === '1' && depositChecked && depositPaid && !isOwnerOfListing && !openDealHandled.current) {
      openDealHandled.current = true;
      setDealModal(true);
    }
  }, [openDeal, depositChecked, depositPaid, isOwnerOfListing]);

  async function fetchOtherPersonName() {
    if (!receiver_id) return;
    const { data } = await supabase
      .from('profiles')
      .select('full_name')
      .eq('id', receiver_id as string)
      .maybeSingle();
    if (data?.full_name) setOtherPersonName(data.full_name);
  }

  // NEW: return type widened from plain boolean to also carry
  // sellerIsDealerPro directly, alongside setting the state of the same
  // name. React state updates aren't visible synchronously even after
  // an await in the same function — init() below needs this value
  // immediately, in the same tick it computes depositPaid/chatUnlocked,
  // so it's returned directly rather than relying on a state read that
  // would still show the stale pre-fetch value at that point.
  async function checkRole(uid: string): Promise<{ owner: boolean; sellerIsDealerPro: boolean }> {
    if (isItemRequestChat) {
      // Item-request (Wanted) chat: "owner" here means the buyer who
      // posted the want (as opposed to the seller/responder they
      // accepted). No arrange-deal fee flow for these — the 3%
      // commission in wanted-responses.tsx already gated access before
      // this screen was ever reached. What's still needed here, though,
      // is fulfillment: delivery or in-person collection. Fetch the
      // accepted response's is_physical_item flag so the deal modal
      // below knows whether "Book delivery" applies at all (a service
      // like "a builder" can't be couriered).
      if (!item_request_id) return { owner: false, sellerIsDealerPro: false };
      const { data: req } = await supabase
        .from('item_requests')
        .select('user_id')
        .eq('id', item_request_id as string)
        .maybeSingle();

      const { data: acceptedResponse } = await supabase
        .from('item_responses')
        .select('is_physical_item')
        .eq('item_request_id', item_request_id as string)
        .eq('status', 'accepted')
        .maybeSingle();
      if (acceptedResponse) setItemIsPhysical(acceptedResponse.is_physical_item);

      if (req) {
        const owner = uid === req.user_id;
        setIsOwnerOfListing(owner);
        return { owner, sellerIsDealerPro: false };
      }
      return { owner: false, sellerIsDealerPro: false };
    }

    if (isRequestChat) {
      // Trip-request chat: "owner" here means the customer who posted the
      // trip request (as opposed to the operator bidding on it). There's
      // no arrange-deal fee flow for these — quotes.tsx already handles
      // the 10% deposit before a buyer ever reaches this screen — so we
      // don't need a price for the Meet & Pay modal here.
      if (!request_id) return { owner: false, sellerIsDealerPro: false };
      const { data: req } = await supabase
        .from('requests')
        .select('user_id')
        .eq('id', request_id as string)
        .maybeSingle();
      if (req) {
        const owner = uid === req.user_id;
        setIsOwnerOfListing(owner);
        return { owner, sellerIsDealerPro: false };
      }
      return { owner: false, sellerIsDealerPro: false };
    }

    if (!listing_id) return { owner: false, sellerIsDealerPro: false };
    const parsedId = parseInt(listing_id as string);
    const { data: listing, error } = await supabase
      .from('listings')
      .select('user_id, price')
      .eq('id', parsedId)
      .maybeSingle();
    if (listing) {
      const owner = uid === listing.user_id;
      setIsOwnerOfListing(owner);
      setListingPrice(listing.price);

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

      return { owner, sellerIsDealerPro: isDealerPro };
    }
    return { owner: false, sellerIsDealerPro: false };
  }

  // Reads whether the unlock fee has been paid, for a given buyer id, on
  // this listing.
  //
  // UPDATED: now takes buyerId as a parameter instead of always using the
  // logged-in user's own id — needed so chatUnlocked (see top-of-file FIX
  // comment) can check "has the ACTUAL BUYER of this conversation paid"
  // correctly from either side (seller checking on behalf of their
  // buyer, or the buyer checking on their own behalf). The original
  // depositPaid call site (uid, i.e. "am I, the caller, paid up")
  // continues to work exactly as before — only a rename of the parameter,
  // not a behavior change for that existing call.
  //
  // NOTE: this used to also fire notifyUnlockFeeReceived() when the check
  // came back true, guarded by `!depositPaid`. That guard compared against
  // the depositPaid *state*, which is still at its initial value (false)
  // the very first time this runs on mount — so the guard was always true
  // on every fresh visit to this screen, not just the first time the fee
  // was ever paid. Net effect: a buyer who paid last week and simply
  // reopens this chat would re-trigger the "fee received" notification to
  // the seller every single time. This function only ever takes a
  // one-off snapshot of current status on mount (there's no polling), so
  // it has no reliable way to tell "just paid" apart from "paid a while
  // ago." That distinction belongs at the moment the payment itself
  // completes — in paynow-webhook, right after the insert into
  // listing_deposits succeeds — not here. The notification call has been
  // removed from this read-only check accordingly.
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

  async function loadExistingMeetPaySession(currentUserId: string) {
    // FIX: previously exited immediately if there was no listing_id —
    // meaning this never ran at all for item-request (Wanted/Meet &
    // Collect) conversations, since openMeetPay() also creates sessions
    // keyed by item_request_id, not just listing_id (see the type/
    // reference_id branch there). Reopening the modal in a Wanted chat
    // would never find the existing pending session, only ever create
    // a fresh duplicate one. Reference id now matches whichever type
    // this conversation actually is.
    const referenceId = isItemRequestChat ? item_request_id : listing_id;
    if (!referenceId) return;

    // FIX (real bug, found while chasing a "PIN always shows expired"
    // report): this previously filtered ONLY by reference_id — the
    // listing (or item request) — with no check for WHICH buyer/seller
    // pair the session belongs to. On a listing that's been used for
    // Meet & Pay testing by more than one buyer, this could load a
    // completely unrelated session (someone else's PIN, possibly long
    // expired) into state. Worse than just a wrong display: once
    // `session` is set to anything at all, openMeetPay()'s
    // `if (isBuyerRole && !session)` check for generating a brand new
    // PIN never fires again — so a buyer stuck with the wrong loaded
    // session could never actually create their own, no matter how
    // many times they tried.
    // Scoping to (buyer_id, seller_id) matching the two actual people
    // in THIS conversation, in either role, fixes both problems.
    //
    // Takes currentUserId as a parameter rather than reading the
    // component's `myId` state directly — at the point this is called
    // during initial mount, setMyId() has been called moments earlier
    // in the same render cycle but the state itself hasn't updated yet
    // (React state updates apply on the next render, not immediately),
    // so reading `myId` here would silently use its stale initial
    // value ('') instead of the real signed-in user id.
    const { data } = await supabase
      .from('meetpay_sessions')
      .select('*')
      .eq('reference_id', String(referenceId))
      .or(`and(buyer_id.eq.${currentUserId},seller_id.eq.${receiver_id}),and(buyer_id.eq.${receiver_id},seller_id.eq.${currentUserId})`)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (data) {
      setSession(data);
      if (data.status === 'confirmed') setConfirmed(true);
    }
  }

  const fetchMessages = async (uid: string) => {
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

    const otherId = receiver_id as string | undefined;
    const filtered = (data ?? []).filter((m: any) =>
      !otherId ||
      (m.sender_id === uid && m.receiver_id === otherId) ||
      (m.sender_id === otherId && m.receiver_id === uid)
    );

    setMessages(filtered);
    setLoading(false);
  };

  // Widened to catch two evasions beyond the original structural
  // patterns, mirrored exactly in enforce_contact_info_block() —
  // see widen-enforce-contact-info-block.sql. Keep both in sync.
  function containsContactInfo(message: string): boolean {
    const cleaned = message.toLowerCase();

    // Normalize spelled-out digits ("zero seven one nine nine" -> "07199")
    // and at/dot word substitutions ("name at gmail dot com" -> "name@gmail.com")
    // before running the original checks against the result.
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

    // NEW: fully-concatenated obfuscation with no separators at all
    // ("mplalaethigmaildotcom") — nothing above can catch this since
    // there's nothing to normalize. Strip ALL whitespace and look for
    // a provider name immediately followed by a TLD-like token.
    const stripped = cleaned.replace(/\s+/g, '');
    const providerPattern = /(gmail|yahoo|hotmail|outlook|icloud|protonmail)(dot)?(com|co\w{0,3}|net|org)/i;
    if (providerPattern.test(stripped)) return true;

    return false;
  }

  const sendMessage = async () => {
    if (!text.trim()) return;

    // FIX: now skipped entirely once chatUnlocked is true — see
    // top-of-file FIX comment. Previously this check ran unconditionally
    // regardless of payment status, contradicting the warning text's own
    // promise that sharing becomes fine once the chat is unlocked.
    if (!chatUnlocked && containsContactInfo(text)) {
      setContactWarning(true);
      setTimeout(() => setContactWarning(false), 4000);
      return;
    }

    let { data: { session } } = await supabase.auth.getSession();

    // FIX (product direction correction): browsing AND chatting should
    // both be fully free, no login required at all — an account is only
    // needed at the actual payment/deal moment (unlock fee, Wanted
    // commission, professional registrations). The earlier version of
    // this fix redirected to /login here, which was too strong: it
    // turned "send a message" into a hard login wall, which is exactly
    // what deters casual browsers from ever engaging.
    //
    // Supabase's anonymous sign-in gives the visitor a real (but
    // identity-free) session automatically — no email, no password —
    // so sender_id still has a valid, real auth.users id to attach to
    // this message, without asking them to create an account just to
    // say "is this still available?". Requires "Allow anonymous
    // sign-ins" to be enabled in Supabase Auth settings.
    //
    // This anonymous session persists in this browser (same
    // persistSession/autoRefreshToken config as any other session, per
    // lib/supabase.ts), so it's only created once per browser, not once
    // per message.
    if (!session) {
      const { data, error } = await supabase.auth.signInAnonymously();
      if (error) {
        console.log('Anonymous sign-in failed:', error.message);
        setSendError('Couldn\'t send — please check your connection and try again.');
        return;
      }
      session = data.session;
      setMyId(session?.user?.id ?? '');
    }

    if (!session) return;

    setSendError('');
    // FIX (message-visibility bug): previously this only inserted and
    // relied on the realtime channel's echo (below) to actually show the
    // message on screen. That channel is only created if `uid` was
    // already set when this screen first mounted — but a brand-new,
    // never-messaged-before buyer has no session yet at mount time, so
    // the channel setup block gets skipped entirely (see the `uid`
    // check around the .channel(...) call above). The message WAS
    // reaching the database fine; it just never appeared on the
    // sender's own screen, which looked identical to "nothing happened"
    // from the buyer's side — and, in turn, meant nothing was ever live
    // for the other party to be notified about either.
    //
    // Fix: request the inserted row back (.select().single()) and add
    // it to local state directly, regardless of whether a realtime
    // channel exists. This makes sending correct even when the
    // realtime channel never got wired up, and doesn't depend on
    // fixing that timing gap separately.
    const { data: sentMessage, error: insertError } = await supabase
      .from('messages')
      .insert({
        text: text.trim(),
        sender_id: session.user.id,
        receiver_id: receiver_id || null,
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

    // Dedupe guard: if a realtime channel DOES also exist for this
    // sender (e.g. a returning buyer, or the seller side), its INSERT
    // echo (see the .on('postgres_changes', ...) handler above) is
    // itself deduped by id, so adding it here first is safe either way.
    if (sentMessage) {
      setMessages((prev) => (prev.some((m) => m.id === sentMessage.id) ? prev : [...prev, sentMessage]));
    }

    setText('');
    setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 100);
  };

  async function goToUnlock() {
    router.push(
      `/unlock?listing_id=${listing_id}&seller_id=${receiver_id}&price=${listingPrice ?? ''}`
    );
  }

  // NEW: normalizes "which side is the buyer" across chat types.
  // isOwnerOfListing means different things depending on context — for a
  // regular listing it's the SELLER (they list it), but for an
  // item-request (Wanted) chat it's the BUYER (they posted the want).
  // Meet & Pay's PIN flow always needs to know which side generates the
  // PIN (buyer) vs confirms it (seller/responder) — isBuyerRole gives
  // that answer correctly for both contexts, without changing what
  // isOwnerOfListing itself means elsewhere (rating role assignment,
  // etc., which intentionally still uses the raw value).
  const isBuyerRole = isItemRequestChat ? isOwnerOfListing : !isOwnerOfListing;

  function handleArrangeDealPress() {
    if (!isBuyerRole) {
      // Confirm-PIN role (seller for listings, responder for an accepted
      // Wanted match) — go straight to the PIN-entry side of Meet & Pay.
      openMeetPay();
      return;
    }
    if (isItemRequestChat) {
      // The Wanted buyer always gets to CHOOSE fulfillment (delivery vs.
      // meet & collect) here — unlike a regular listing's buyer flow,
      // there's no separate unlock-fee gate to check, since payment
      // already happened via the 3% commission before this screen was
      // ever reachable.
      setDealModal(true);
      return;
    }
    // Regular listing, buyer role.
    if (depositPaid) { setDealModal(true); return; }
    goToUnlock();
  }

  async function openMeetPay() {
    if (!depositPaid) return;
    setPinError('');
    setMeetPayModal(true);

    if (isBuyerRole && !session) {
      const pin = generatePin();
      const expiresAt = new Date(Date.now() + 15 * 60 * 1000);

      // FIX: this used to hardcode type: 'listing' and
      // reference_id: String(listing_id) unconditionally. That was only
      // ever safe because openMeetPay() was previously unreachable from
      // item-request chats (the header button was hidden for them
      // entirely) — now that Wanted matches can reach Meet & Collect too,
      // this must branch by chat type, or an item-request session would
      // be recorded against a null listing_id under the wrong type.
      const { data, error } = await supabase
        .from('meetpay_sessions')
        .insert({
          type: isItemRequestChat ? 'item_request' : 'listing',
          reference_id: isItemRequestChat ? String(item_request_id) : String(listing_id),
          buyer_id: myId,
          seller_id: receiver_id,
          pin,
          pin_expires_at: expiresAt.toISOString(),
          // No listing price applies to a Wanted match — the item's
          // price was already settled directly between buyer and seller,
          // outside the app. This PIN exists purely to confirm the
          // handover happened, not to record a payment amount.
          amount: isItemRequestChat ? null : listingPrice,
          status: 'pending',
        })
        .select()
        .maybeSingle();

      if (error) { setPinError(error.message); return; }
      setSession(data);

      // Local notification — shows on THIS device (the buyer's) only,
      // so it's just immediate on-screen feedback that the PIN was
      // created, not a way to reach the seller. The seller is notified
      // for real by notify-meetpay-event, an Edge Function invoked by a
      // DB trigger on this same meetpay_sessions insert (see
      // notify-meetpay-event-trigger.sql) — same split responsibility
      // paynow-webhook already uses for payment events: the acting
      // client shows its own local feedback, the server sends the real
      // cross-device push to the other party.
      notifyMeetPayPinGenerated(isItemRequestChat ? 'this item' : 'this listing');
    }
  }

  async function regeneratePin() {
    if (!session) return;
    const pin = generatePin();
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000);

    const { data, error } = await supabase
      .from('meetpay_sessions')
      .update({ pin, pin_generated_at: new Date().toISOString(), pin_expires_at: expiresAt.toISOString() })
      .eq('id', session.id)
      .select()
      .maybeSingle();

    if (error) { setPinError(error.message); return; }
    setSession(data);
  }

  async function handleConfirmPin() {
    setPinError('');
    if (enteredPin.length !== 4) { setPinError('Enter the 4-digit PIN.'); return; }
    if (!session) { setPinError('No active session found.'); return; }
    if (secondsLeft === 0) { setPinError('This PIN has expired. Ask the buyer to refresh.'); return; }
    if (enteredPin !== session.pin) { setPinError('Incorrect PIN.'); return; }

    setConfirming(true);
    const { error } = await supabase
      .from('meetpay_sessions')
      .update({ status: 'confirmed', confirmed_at: new Date().toISOString(), confirmed_by: myId })
      .eq('id', session.id);
    setConfirming(false);

    if (error) { setPinError(error.message); return; }
    setConfirmed(true);

    // Local notification — shows on THIS device (the confirmer's) only.
    // The buyer is notified for real by notify-meetpay-event, triggered
    // server-side off this same status='confirmed' update — see the
    // matching comment in openMeetPay() above.
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
    // FIX (real bug, reported directly by the person testing the app):
    // the keyboard covered the message input every time someone typed —
    // nothing in this screen previously accounted for the keyboard at
    // all. KeyboardAvoidingView pushes the whole layout up (iOS) or
    // resizes it (Android) so the input row stays visible above the
    // keyboard instead of being hidden underneath it. behavior differs
    // by platform since 'padding' is the standard iOS approach while
    // Android generally does better with 'height'.
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <StatusBar style="light" />

      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <TouchableOpacity onPress={() => router.back()}>
            <Text style={styles.backBtn}>←</Text>
          </TouchableOpacity>
          <View style={styles.avatarWrap}>
            <View style={styles.avatar}>
              <Text style={styles.avatarText}>{getInitials(otherPersonName)}</Text>
            </View>
            <View style={styles.onlineDot} />
          </View>
          <View>
            <Text style={styles.sellerName}>{otherPersonName || 'ImbizoHub Chat'}</Text>
            <Text style={styles.onlineStatus}>Online now</Text>
          </View>
        </View>
        {/* NEW: report entry point, always available regardless of chat
            type (listing/request/item-request) — listing.tsx's own
            report link only covers the regular-listing case; this
            covers Wanted and van-hire chats too, which have no listing
            detail screen to report from at all. */}
        <View style={styles.headerRight}>
          {!isRequestChat && (listing_id || isItemRequestChat) && (
            <TouchableOpacity
              style={styles.meetPayHeaderBtn}
              onPress={handleArrangeDealPress}
            >
              <Text style={styles.meetPayHeaderIcon}>🔒</Text>
              <Text style={styles.meetPayHeaderText}>
                {isBuyerRole ? 'Arrange deal' : 'Confirm PIN'}
              </Text>
            </TouchableOpacity>
          )}
          {receiver_id && (
            <TouchableOpacity
              style={styles.reportIconBtn}
              onPress={() => router.push(
                `/report-user?user_id=${receiver_id}&name=${encodeURIComponent(otherPersonName || '')}&context=chat`
              )}
            >
              <Text style={styles.reportIconText}>⚑</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>

      {!isOwnerOfListing && !depositPaid && (
        <View style={styles.warningBar}>
          <Text style={styles.warningIcon}>💬</Text>
          <Text style={styles.warningText}>
            Chat is free — you'll only pay a small fee when you're ready to arrange Meet & Pay or delivery.
          </Text>
        </View>
      )}

      {contactWarning && (
        <View style={styles.contactWarningBar}>
          <Text style={styles.contactWarningText}>
            ⚠️ Sharing phone numbers or emails in chat isn't allowed before chat is unlocked. Use Meet & Pay to safely exchange contact info.
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
          showsVerticalScrollIndicator={false}
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

      {/* Deal arrangement modal — buyer chooses Meet & Pay or Book Delivery */}
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
                    // No payment happens at this step — the price was
                    // already settled directly between buyer and seller.
                    // The PIN here is purely a handover confirmation, for
                    // both sides' records.
                    ? 'Meet in person, hand over the item, and confirm with a PIN. Best for same-city arrangements.'
                    : 'Meet the seller in person, inspect the item, and confirm with a PIN. Best for same-city trades.'}
                </Text>
              </View>
              <Text style={styles.dealOptionArrow}>›</Text>
            </TouchableOpacity>

            {/* Delivery is only offered for item-request chats when the
                accepted response was flagged as a physical item — a
                service (e.g. "a builder") has nothing to courier. For
                regular listing chats, always offered as before. */}
            {(!isItemRequestChat || itemIsPhysical) && (
              <TouchableOpacity
                style={styles.dealOption}
                onPress={() => {
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
                    A registered driver delivers the item to you. $5 within city · $10 intercity. + $2 booking fee.
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
                <Text style={styles.modalBody}>
                  {isBuyerRole
                    ? (isItemRequestChat ? 'You confirmed you received the item.' : 'You confirmed the deal with the buyer.')
                    : (isItemRequestChat ? 'The buyer confirmed receipt. Thank you for using ImbizoHub safely.' : 'The seller confirmed receipt. Thank you for using ImbizoHub safely.')}
                </Text>
                <TouchableOpacity
                  style={styles.modalBtn}
                  onPress={() => {
                    setMeetPayModal(false);
                    // Navigate to rating screen. reviewee_id is
                    // receiver_id regardless of role — it already
                    // represents "the other participant in this chat"
                    // from either role's perspective. `role` uses
                    // isBuyerRole (not the raw isOwnerOfListing) since
                    // "owner" flips meaning between a listing chat
                    // (seller) and an item-request chat (buyer) — using
                    // the raw value here would have labeled an
                    // item-request buyer as "seller" on their own rating.
                    router.push(
                      `/rating?session_id=${session?.id}&reviewee_id=${receiver_id}&role=${isBuyerRole ? 'buyer' : 'seller'}&listing_id=${listing_id}`
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
              <>
                <Text style={styles.modalTitle}>{isItemRequestChat ? 'Meet & Collect' : 'Meet & Pay'}</Text>
                <Text style={styles.modalBody}>
                  {isItemRequestChat
                    ? 'Show this PIN to the seller once you\'ve collected the item and you\'re ready to confirm.'
                    : 'Show this PIN to the seller once you\'ve inspected the item and you\'re ready to complete the deal.'}
                </Text>

                {pinError ? <Text style={styles.modalError}>⚠️ {pinError}</Text> : null}

                {session && (
                  <>
                    <View style={styles.pinCard}>
                      <Text style={styles.pinLabel}>Your PIN</Text>
                      <Text style={styles.pinDisplay}>{session.pin}</Text>
                      <Text style={[styles.pinTimer, secondsLeft < 60 && { color: '#ff8a8a' }]}>
                        {secondsLeft > 0 ? `Expires in ${formatTime(secondsLeft)}` : 'Expired'}
                      </Text>
                    </View>

                    {/* FIX: was gated behind secondsLeft === 0, so a buyer
                        who wanted a fresh PIN before the old one expired
                        (plans changed, showed it to the wrong person,
                        whatever the reason) had no way to get one — stuck
                        either waiting out the full 15 minutes or using a
                        PIN they no longer wanted valid. regeneratePin()
                        already just updates this same session row's pin/
                        pin_expires_at regardless of the old PIN's state,
                        so there's no reason to withhold the button while
                        it's still technically valid — the old PIN simply
                        stops working the moment a new one's generated. */}
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
            ) : (
              <>
                <Text style={styles.modalTitle}>Confirm with PIN</Text>
                <Text style={styles.modalBody}>
                  Ask the buyer for their 4-digit PIN to confirm this transaction is complete.
                </Text>

                {pinError ? <Text style={styles.modalError}>⚠️ {pinError}</Text> : null}

                {!session ? (
                  <View style={styles.waitingBox}>
                    <ActivityIndicator color={GOLD} style={{ marginBottom: 10 }} />
                    <Text style={styles.waitingText}>Waiting for buyer to generate a PIN...</Text>
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
                        : <Text style={styles.modalBtnText}>Confirm transaction</Text>
                      }
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
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },
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
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
  modalSheet: { backgroundColor: BLACK, borderTopLeftRadius: 22, borderTopRightRadius: 22, padding: 24, paddingBottom: 40 },
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
