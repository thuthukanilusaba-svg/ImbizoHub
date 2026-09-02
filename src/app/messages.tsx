// app/messages.tsx
// Inbox — lists all conversations for the logged-in user, grouped by
// listing + the other participant (since multiple buyers can message the
// same seller about the same listing, grouping by listing_id alone would
// incorrectly merge separate conversations together).
//
// NEW: added the shared bottom nav (Home/Browse/+/Messages/Dashboard/Profile)
// for consistency with Home, Explore, and Dealer — this screen previously
// had no bottom nav at all, only a "‹ Back" header, which meant there was
// no way to jump to Home/Browse/Post/Dashboard/Profile from here without
// first going back.
//
// FIX (found during a full-app review pass — a real, significant gap):
// this screen only ever knew about two chat identities, listing_id and
// request_id. chat.tsx and the messages table both gained a THIRD
// identity today — item_request_id, for Wanted-tab conversations — but
// this inbox was never updated to match. The old filtering logic
// (`if (!msg.listing_id && !msg.request_id) continue;`) silently
// discarded every Wanted-tab message, meaning a buyer who paid the 3%
// commission and unlocked chat with a seller would NEVER see that
// conversation in their main Messages tab — only reachable by going
// back through wanted-responses.tsx each time. Fixed by extending the
// exact same pattern already used for request_id to also cover
// item_request_id throughout: the select, the Conversation type, the
// grouping key, the title lookup, and the tap-to-open routing.
//
// FIX: bottom nav now accounts for the device's own safe-area inset
// (gesture bar / nav buttons) instead of a hardcoded paddingBottom,
// which was overlapping with the system navigation on some phones.

import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import BottomNav from '../../components/BottomNav';
import { supabase } from '../../lib/supabase';

const GOLD = '#B8860B';
const BLACK = '#1A1A18';
const DARK = '#2a2a2a';
const GREY = '#AAAAAA';

type Conversation = {
  key: string;
  listingId: number | null;
  requestId: string | null;
  itemRequestId: string | null;
  otherId: string;
  lastText: string;
  lastAt: string;
  listingTitle: string;
  otherName: string;
};

function getInitials(name: string): string {
  if (!name) return '👤';
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export default function MessagesScreen() {
  const router = useRouter();
  const params = useLocalSearchParams();
  // Optional filter — set when arriving from a specific listing (e.g. a
  // seller tapping "Message buyers" on their own listing.tsx), so the
  // inbox only shows conversations tied to that listing. Absent for the
  // normal Messages tab, which shows everything as before.
  const listingIdFilter = params.listing_id ? String(params.listing_id) : null;
  const [loading, setLoading] = useState(true);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [myId, setMyId] = useState('');
  // NEW: same role flags as home.tsx/explore.tsx/dealer.tsx, to
  // conditionally show the Dashboard tab in the bottom nav.
  const [showDashboardTab, setShowDashboardTab] = useState(false);
  // NEW: true when there's no real account (no session, or an anonymous
  // one) — shows an inline explanation + register prompt instead of a
  // silent redirect. See loadConversations() for the full reasoning.
  const [needsAccount, setNeedsAccount] = useState(false);

  useEffect(() => { loadConversations(); loadUserRole(); }, []);

  async function loadConversations() {
    setLoading(true);
    const { data: { user } } = await supabase.auth.getUser();

    // FIX (product decision, following the same principle as post.tsx):
    // an inbox is inherently a "come back and find my history" feature —
    // a claim of permanence an anonymous session structurally can't back
    // up (no recovery if the browser session is lost). Chatting itself
    // stays anonymous-friendly (chat.tsx is unchanged); it's specifically
    // the CONCEPT of "my inbox, everything in one place, I can always
    // find it" that needs a real account.
    //
    // Previously this hard-redirected to /login with zero explanation —
    // jarring, and pointed at the wrong screen (login.tsx is for an
    // EXISTING account; someone here is very possibly anonymous with no
    // account at all yet). Now shows an inline prompt explaining why,
    // instead of a silent redirect, and correctly points to /register.
    //
    // Because register.tsx's anonymous-to-real conversion (fixed earlier
    // today — uses updateUser() to convert the SAME session rather than
    // signUp() replacing it) preserves the same user id, an anonymous
    // user who registers right from this prompt does NOT lose any
    // existing conversations — they'll immediately appear in this exact
    // inbox afterward. This turns the account requirement into a
    // genuine, honest value proposition instead of an arbitrary wall.
    if (!user || user.is_anonymous) {
      setNeedsAccount(true);
      setLoading(false);
      return;
    }

    setMyId(user.id);

    // FIX: added item_request_id to the select — was previously missing
    // entirely, meaning Wanted-tab conversations had no way to even be
    // considered below.
    const { data: messages, error } = await supabase
      .from('messages')
      .select('listing_id, request_id, item_request_id, sender_id, receiver_id, text, created_at')
      .or(`sender_id.eq.${user.id},receiver_id.eq.${user.id}`)
      .order('created_at', { ascending: false });

    if (error || !messages) {
      console.log('loadConversations error:', error?.message);
      setLoading(false);
      return;
    }

    // Group by (listing_id OR request_id OR item_request_id) + the OTHER
    // person's id, keeping only the most recent message per group
    // (messages are already sorted desc). A message belongs to exactly
    // one of the three — trip-request chats (van hire) use request_id,
    // Wanted-tab chats use item_request_id, and neither has an
    // associated marketplace listing.
    const grouped = new Map<string, Conversation>();
    for (const msg of messages) {
      if (!msg.sender_id || !msg.receiver_id) continue;
      // FIX: was `if (!msg.listing_id && !msg.request_id) continue;` —
      // silently discarded every Wanted-tab message, since those have
      // neither listing_id nor request_id set, only item_request_id.
      if (!msg.listing_id && !msg.request_id && !msg.item_request_id) continue;
      const otherId = msg.sender_id === user.id ? msg.receiver_id : msg.sender_id;
      const key = msg.listing_id
        ? `listing_${msg.listing_id}_${otherId}`
        : msg.request_id
          ? `request_${msg.request_id}_${otherId}`
          : `item_request_${msg.item_request_id}_${otherId}`;
      if (!grouped.has(key)) {
        grouped.set(key, {
          key,
          listingId: msg.listing_id ?? null,
          requestId: msg.request_id ?? null,
          itemRequestId: msg.item_request_id ?? null,
          otherId,
          lastText: msg.text,
          lastAt: msg.created_at,
          listingTitle: '',
          otherName: '',
        });
      }
    }

    const convoList = Array.from(grouped.values());

    if (convoList.length > 0) {
      const listingIds = [...new Set(convoList.filter((c) => c.listingId).map((c) => c.listingId as number))];
      const requestIds = [...new Set(convoList.filter((c) => c.requestId).map((c) => c.requestId as string))];
      // FIX: fetch item_requests titles too, same pattern as requests.
      const itemRequestIds = [...new Set(convoList.filter((c) => c.itemRequestId).map((c) => c.itemRequestId as string))];
      const otherIds = [...new Set(convoList.map((c) => c.otherId))];

      const [{ data: listings }, { data: requests }, { data: itemRequests }, { data: profiles }] = await Promise.all([
        listingIds.length > 0
          ? supabase.from('listings').select('id, title').in('id', listingIds)
          : Promise.resolve({ data: [] as any[] }),
        requestIds.length > 0
          ? supabase.from('requests').select('id, pickup, destination').in('id', requestIds)
          : Promise.resolve({ data: [] as any[] }),
        itemRequestIds.length > 0
          ? supabase.from('item_requests').select('id, title').in('id', itemRequestIds)
          : Promise.resolve({ data: [] as any[] }),
        supabase.from('profiles').select('id, full_name').in('id', otherIds),
      ]);

      const listingMap: Record<number, string> = {};
      (listings ?? []).forEach((l: any) => { listingMap[l.id] = l.title; });

      const requestMap: Record<string, string> = {};
      (requests ?? []).forEach((r: any) => { requestMap[r.id] = `${r.pickup} → ${r.destination}`; });

      // FIX: title lookup for Wanted-tab conversations.
      const itemRequestMap: Record<string, string> = {};
      (itemRequests ?? []).forEach((ir: any) => { itemRequestMap[ir.id] = ir.title; });

      const profileMap: Record<string, string> = {};
      (profiles ?? []).forEach((p: any) => { profileMap[p.id] = p.full_name; });

      for (const c of convoList) {
        c.listingTitle = c.listingId
          ? (listingMap[c.listingId] || 'Listing')
          : c.requestId
            ? (requestMap[c.requestId] || 'Trip request')
            : (itemRequestMap[c.itemRequestId as string] || 'Wanted item');
        c.otherName = profileMap[c.otherId] || '';
      }
    }

    setConversations(convoList);
    setLoading(false);
  }

  async function loadUserRole() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    // UPDATED (product decision): was account_type === 'seller' — see
    // index.tsx's matching fix for the full reasoning. Now driven by
    // whether this person has actually posted a listing.
    const { count: listingCount } = await supabase
      .from('listings')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', user.id);

    const hasPostedListing = (listingCount ?? 0) > 0;

    const { data: operator } = await supabase
      .from('delivery_operators')
      .select('registration_paid, registration_expires_at')
      .eq('user_id', user.id)
      .maybeSingle();

    const isActiveOperator = !!(
      operator?.registration_paid &&
      operator?.registration_expires_at &&
      new Date(operator.registration_expires_at).getTime() > Date.now()
    );

    setShowDashboardTab(hasPostedListing || isActiveOperator);
  }

  function formatTime(dateStr: string) {
    const date = new Date(dateStr);
    const now = new Date();
    const isToday = date.toDateString() === now.toDateString();
    if (isToday) {
      return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }
    return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  }

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={GOLD} />
      </View>
    );
  }

  if (needsAccount) {
    return (
      <View style={styles.container}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))} style={styles.backBtn}>
            <Text style={styles.backText}><Text style={styles.backArrow}>‹</Text> Back</Text>
          </TouchableOpacity>
          <Text style={styles.heading}>Messages</Text>
        </View>
        <View style={styles.needsAccountCard}>
          <Text style={styles.needsAccountIcon}>💬</Text>
          <Text style={styles.needsAccountTitle}>Keep all your conversations in one place</Text>
          <Text style={styles.needsAccountBody}>
            You can chat with any seller without an account — but creating a free one lets you
            come back anytime and see every conversation together, right here.
          </Text>
          <TouchableOpacity style={styles.needsAccountBtn} onPress={() => router.push('/register')}>
            <Text style={styles.needsAccountBtnText}>Create free account</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => router.push('/login')}>
            <Text style={styles.needsAccountLoginLink}>Already have an account? Sign in</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  const visibleConversations = listingIdFilter
    ? conversations.filter((c) => String(c.listingId) === listingIdFilter)
    : conversations;

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))} style={styles.backBtn}>
          <Text style={styles.backText}><Text style={styles.backArrow}>‹</Text> Back</Text>
        </TouchableOpacity>
        <Text style={styles.heading}>Messages</Text>
      </View>

      {listingIdFilter && (
        <View style={styles.filterBanner}>
          <Text style={styles.filterBannerText} numberOfLines={1}>
            Showing conversations for: {visibleConversations[0]?.listingTitle || 'this listing'}
          </Text>
          <TouchableOpacity onPress={() => router.replace('/messages')}>
            <Text style={styles.filterBannerClear}>Show all</Text>
          </TouchableOpacity>
        </View>
      )}

      {visibleConversations.length === 0 ? (
        <View style={styles.emptyState}>
          <Text style={styles.emptyIcon}>💬</Text>
          <Text style={styles.emptyTitle}>
            {listingIdFilter ? 'No conversations for this listing yet' : 'No conversations yet'}
          </Text>
          <Text style={styles.emptyBody}>
            {listingIdFilter
              ? "No buyers have messaged about this listing yet — they'll show up here once they do."
              : "Message a seller from any listing to start a conversation — it'll show up here."}
          </Text>
        </View>
      ) : (
        <ScrollView style={styles.listContainer} contentContainerStyle={styles.list}>
          {visibleConversations.map((c) => (
            <TouchableOpacity
              key={c.key}
              style={styles.convoRow}
              onPress={() => {
                // FIX: added the item_request_id case — previously
                // tapping a Wanted-tab conversation (had this screen
                // even been showing them, which it wasn't) would have
                // incorrectly fallen into the request_id branch, opening
                // chat.tsx with the wrong identity entirely.
                if (c.listingId) {
                  router.push(`/chat?listing_id=${c.listingId}&receiver_id=${c.otherId}`);
                } else if (c.requestId) {
                  router.push(`/chat?request_id=${c.requestId}&receiver_id=${c.otherId}`);
                } else {
                  router.push(`/chat?item_request_id=${c.itemRequestId}&receiver_id=${c.otherId}`);
                }
              }}
            >
              <View style={styles.avatar}>
                <Text style={styles.avatarText}>{getInitials(c.otherName)}</Text>
              </View>
              <View style={styles.convoBody}>
                <View style={styles.convoTopRow}>
                  <Text style={styles.convoName} numberOfLines={1}>
                    {c.otherName || 'ImbizoHub user'}
                  </Text>
                  <Text style={styles.convoTime}>{formatTime(c.lastAt)}</Text>
                </View>
                <Text style={styles.convoListing} numberOfLines={1}>{c.listingTitle}</Text>
                <Text style={styles.convoPreview} numberOfLines={1}>{c.lastText}</Text>
              </View>
            </TouchableOpacity>
          ))}
        </ScrollView>
      )}

      <BottomNav active="messages" showDashboardTab={showDashboardTab} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#111111' },
  center: { flex: 1, backgroundColor: '#111', alignItems: 'center', justifyContent: 'center' },

  header: { padding: 20, paddingTop: 56, backgroundColor: BLACK, borderBottomWidth: 0.5, borderBottomColor: DARK },
  backBtn: { marginBottom: 12 },
  backText: { color: GREY, fontSize: 14 },
  // NEW: bigger than the label text so the '‹' glyph reads clearly — direct product decision ("back symbol too small").
  backArrow: { fontSize: 20 },
  heading: { fontSize: 22, fontWeight: '800', color: '#fff' },

  filterBanner: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: '#3a2800', paddingHorizontal: 16, paddingVertical: 10, borderBottomWidth: 0.5, borderBottomColor: DARK },
  filterBannerText: { color: GOLD, fontSize: 12, fontWeight: '600', flex: 1, marginRight: 10 },
  filterBannerClear: { color: GOLD, fontSize: 12, fontWeight: '800', textDecorationLine: 'underline' },

  emptyState: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 40, paddingBottom: 100 },

  needsAccountCard: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  needsAccountIcon: { fontSize: 48, marginBottom: 20 },
  needsAccountTitle: { color: '#fff', fontSize: 18, fontWeight: '800', textAlign: 'center', marginBottom: 12 },
  needsAccountBody: { color: GREY, fontSize: 13, textAlign: 'center', lineHeight: 20, marginBottom: 28 },
  needsAccountBtn: { backgroundColor: GOLD, borderRadius: 14, paddingVertical: 16, paddingHorizontal: 40, marginBottom: 16 },
  needsAccountBtnText: { color: BLACK, fontSize: 15, fontWeight: '800' },
  needsAccountLoginLink: { color: GREY, fontSize: 13 },
  emptyIcon: { fontSize: 48, marginBottom: 16 },
  emptyTitle: { color: '#fff', fontSize: 16, fontWeight: '700', marginBottom: 8 },
  emptyBody: { color: GREY, fontSize: 13, textAlign: 'center', lineHeight: 19 },

  // FIX (reported 1 Sep 2026: "a person should scroll up and down for
  // message in both instances"). The ScrollView had only
  // `contentContainerStyle` and no `style` of its own. A ScrollView
  // carries no flex by default, so inside this column — header, optional
  // filter banner, list, BottomNav — it took its height from its content
  // rather than from the space left between the header and the nav. Up
  // to one screenful that looks right; past it the list just extends
  // beyond the viewport, the bottom rows and BottomNav go off-screen,
  // and nothing scrolls, because as far as the ScrollView is concerned
  // its content already fits inside it.
  //
  // `flex: 1` bounds it to the remaining space, and it is that bound —
  // content taller than container — that makes a list scrollable at all.
  // Same fix and same cause as operator-requests.tsx and
  // my-wanted-posts.tsx, which had it on their FlatLists.
  listContainer: { flex: 1 },
  list: { padding: 16, paddingBottom: 100 },
  convoRow: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: BLACK, borderRadius: 14, padding: 14, marginBottom: 10, borderWidth: 0.5, borderColor: '#333' },
  avatar: { width: 46, height: 46, borderRadius: 23, backgroundColor: GOLD, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  avatarText: { color: BLACK, fontSize: 15, fontWeight: '800' },
  convoBody: { flex: 1, minWidth: 0 },
  convoTopRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 2 },
  convoName: { color: '#fff', fontSize: 14, fontWeight: '700', flex: 1, marginRight: 8 },
  convoTime: { color: GREY, fontSize: 11 },
  convoListing: { color: GOLD, fontSize: 11, marginBottom: 2 },
  convoPreview: { color: GREY, fontSize: 12 },

});
