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
  const [dealModal, setDealModal] = useState(false);
  const openDealHandled = useRef(false);
  const isBuyerRoleRef = useRef(false);

  const [itemIsPhysical, setItemIsPhysical] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function init() {
      const { data: { session } } = await supabase.auth.getSession();
      const uid = session?.user?.id ?? '';
      if (cancelled) return;
      setMyId(uid);

      const { owner, sellerIsDealerPro: isDealerProSeller, itemResponseAccepted } = await checkRole(uid);
      if (cancelled) return;

      await fetchOtherPersonName();
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

      await fetchMessages(uid);
      await loadExistingMeetPaySession(uid);

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

  async function fetchOtherPersonName() {
    if (!receiver_id) return;
    const { data } = await supabase
      .from('profiles')
      .select('full_name')
      .eq('id', receiver_id as string)
      .maybeSingle();
    if (data?.full_name) setOtherPersonName(data.full_name);
  }

  async function checkRole(uid: string): Promise<{ owner: boolean; sellerIsDealerPro: boolean; itemResponseAccepted: boolean }> {
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

      const responderIdForThisChat = owner ? (receiver_id as string) : uid;
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

      return { owner, sellerIsDealerPro: false, itemResponseAccepted: responseStatus === 'accepted' };
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
        return { owner, sellerIsDealerPro: false, itemResponseAccepted: false };
      }
      return { owner: false, sellerIsDealerPro: false, itemResponseAccepted: false };
    }

    if (!listing_id) return { owner: false, sellerIsDealerPro: false, itemResponseAccepted: false };
    const parsedId = parseInt(listing_id as string);
    const { data: listing, error } = await supabase
      .from('listings')
      .select('user_id, price')
      .eq('id', parsedId)
      .maybeSingle();
    if (listing) {
      const owner = uid === listing.user_id;
      setIsOwnerOfListing(owner);
      isBuyerRoleRef.current = !owner;
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

      return { owner, sellerIsDealerPro: isDealerPro, itemResponseAccepted: false };
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

  async function loadExistingMeetPaySession(currentUserId: string) {
    const referenceId = isItemRequestChat ? item_request_id : listing_id;
    if (!referenceId) return;

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
      const pin = generatePin();
      const expiresAt = new Date(Date.now() + 15 * 60 * 1000);

      const { data, error } = await supabase
        .from('meetpay_sessions')
        .insert({
          type: isItemRequestChat ? 'item_request' : 'listing',
          reference_id: isItemRequestChat ? String(item_request_id) : String(listing_id),
          buyer_id: myId,
          seller_id: receiver_id,
          pin,
          pin_expires_at: expiresAt.toISOString(),
          amount: isItemRequestChat ? null : listingPrice,
          status: 'pending',
        })
        .select()
        .maybeSingle();

      if (error) { setPinError(error.message); return; }
      setSession(data);

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

      {isBuyerRole && !depositPaid && !isRequestChat && (
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
                <Text style={styles.modalBody}>
                  {isBuyerRole
                    ? (isItemRequestChat ? 'You confirmed you received the item.' : 'You confirmed the deal with the buyer.')
                    : (isItemRequestChat ? 'The buyer confirmed receipt. Thank you for using ImbizoHub safely.' : 'The seller confirmed receipt. Thank you for using ImbizoHub safely.')}
                </Text>
                <TouchableOpacity
                  style={styles.modalBtn}
                  onPress={() => {
                    setMeetPayModal(false);
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
