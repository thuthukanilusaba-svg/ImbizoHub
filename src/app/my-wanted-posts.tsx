// app/my-wanted-posts.tsx
// "My Wanted Posts" — lists everything the current user has posted under
// "Looking for something specific?", with a response count on each, and
// links into wanted-responses.tsx to view and accept offers.
//
// FIX (real gap, not a quick patch): posting a want (post-wanted.tsx)
// and browsing/responding to OTHERS' wants (browse-wanted.tsx) both
// worked, but there was no screen anywhere for the person who POSTED a
// want to track their own posts or discover that responses had come in.
// wanted-responses.tsx already existed and worked correctly once you
// were on it, but nothing in the app linked to it — no "My Wanted
// Posts" list, no entry in profile.tsx's quick links. This screen and
// the accompanying profile.tsx link close that gap, matching the same
// pattern buyer-deliveries.tsx used to close an equivalent gap on the
// delivery side.
//
// REVERSED 22 Oct 2026 — THIS SCREEN LOCKED THE ONLY PERSON IT WAS
// FOR OUT OF THE ONLY THING IT DOES.
//
// It used to refuse anonymous sessions outright: the is_anonymous
// check fired BEFORE any fetch, so an anonymous asker saw a generic
// "create an account to keep track" pitch and nothing else, ever. Two
// problems with that, and the second is the expensive one.
//
// First, it was never a real restriction. RLS already lets an
// anonymous owner read exactly this data — item_requests is
// select-all, and item_responses_select_owner_or_responder matches on
// ir.user_id = auth.uid() regardless of whether that uid is anonymous.
// The data was reachable the whole time; only this screen said no.
//
// Second, and this is why it mattered: wanted-responses.tsx — the
// screen that shows the actual prices sellers sent back — correctly
// allows anonymous owners and always has. But this list is the only
// thing in the app that links to it. So an anonymous asker could be
// sent a real offer, and had no route to it from anywhere. On 22 Oct
// someone posted "Garment steamer" anonymously. If a seller had
// replied that evening, the reply would have been sitting in the
// database, visible to nobody.
//
// The old justification was that "come back and find my history"
// needs a durable account. That is true of a NEW phone and false of
// THIS one — the anonymous session persists in local storage, and
// every sign-up path merges its data into the real account (register
// upgrades the same uid in place; login.tsx and lib/oauth.ts both
// call merge_anonymous_session). So the honest version is not a wall
// before the value, it is a prompt beside it, which is what this
// screen now does.
//
// The prompt is deliberately triggered by an OFFER EXISTING, not by
// being anonymous. Asking someone to sign up before anything has
// happened is asking them to pay for a promise. Asking once a real
// seller has named a real price is asking them to keep something they
// can see.
//
// FIX (same bug class already caught in browse-wanted.tsx today): the
// FlatList's contentContainerStyle used `gap: 14` — a documented
// cross-platform reliability quirk, not something to trust at list
// boundaries. This screen doesn't have a footer component (so the
// specific trigger from that earlier bug isn't present here), but it's
// the same underlying fragile pattern, already proven unreliable
// elsewhere in this codebase. Replaced with marginBottom on the card
// style itself, matching the already-established, proven fix.

import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator, FlatList, Platform, RefreshControl,
  StyleSheet, Text, TouchableOpacity, View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { formatPrice } from '../../lib/money';
import { supabase } from '../../lib/supabase';
import { reportHandledError } from '../../lib/crashReporter';

const GOLD = '#B8860B';
const BLACK = '#1A1A18';
const DARK = '#2a2a2a';
const GREY = '#AAAAAA';
const GREEN = '#4fc96e';

type WantedPost = {
  id: string;
  title: string;
  category: string;
  budget_min: number | null;
  budget_max: number | null;
  location: string;
  status: string;
  created_at: string;
  responseCount: number;
};

function budgetLabel(min: number | null, max: number | null): string | null {
  if (min == null && max == null) return null;
  if (min != null && max != null) return `$${formatPrice(min)} – $${formatPrice(max)}`;
  if (min != null) return `$${formatPrice(min)}+`;
  return `Up to $${formatPrice(max)}`;
}

export default function MyWantedPostsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [posts, setPosts] = useState<WantedPost[]>([]);
  // Only for a genuinely absent session now — see top-of-file comment.
  // An anonymous session is no longer turned away here.
  const [needsAccount, setNeedsAccount] = useState(false);
  // Anonymous owner: everything below still renders, with a prompt on
  // top once there is something worth keeping.
  const [isAnonymous, setIsAnonymous] = useState(false);
  // Which card is mid-request, and which card is asking "are you sure".
  // Both keyed by post id so two cards can never be in the same state at
  // once, and so a slow network cannot leave the wrong card spinning.
  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<{ id: string; action: 'close' | 'delete' } | null>(null);
  const [actionError, setActionError] = useState('');

  useEffect(() => { fetchMyPosts(); }, []);

  async function fetchMyPosts() {
    const { data: { user } } = await supabase.auth.getUser();
    // No session at all — nothing to look up, and no uid to look it up
    // by. This is the only case that still stops here. An anonymous
    // session has a real uid and real rows under it, so it carries on
    // past this point like any other owner. See top-of-file comment.
    if (!user) {
      setNeedsAccount(true);
      setLoading(false);
      return;
    }
    setIsAnonymous(!!user.is_anonymous);

    const { data: requests } = await supabase
      .from('item_requests')
      .select('id, title, category, budget_min, budget_max, location, status, created_at')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false });

    if (!requests || requests.length === 0) {
      setPosts([]);
      setLoading(false);
      return;
    }

    const ids = requests.map((r: any) => r.id);
    const { data: responses } = await supabase
      .from('item_responses')
      .select('item_request_id')
      .in('item_request_id', ids);

    const countMap: Record<string, number> = {};
    (responses ?? []).forEach((r: any) => {
      countMap[r.item_request_id] = (countMap[r.item_request_id] ?? 0) + 1;
    });

    setPosts(requests.map((r: any) => ({ ...r, responseCount: countMap[r.id] ?? 0 })));
    setLoading(false);
  }

  async function handleRefresh() {
    setRefreshing(true);
    await fetchMyPosts();
    setRefreshing(false);
  }

  // Every value item_requests_status_check permits gets a label here.
  // The fallthrough returns the raw column value, which renders as
  // lowercase 'cancelled' beside a properly cased 'Matched' — the same
  // bug already fixed once for 'expired'.
  function statusLabel(status: string) {
    if (status === 'matched') return 'Matched';
    if (status === 'open') return 'Open';
    // Set by notify-stale-wants when a buyer leaves offers unanswered
    // for 14 days.
    if (status === 'expired') return 'Expired';
    // What "Close this post" writes. Called Closed rather than
    // Cancelled because nothing was cancelled — the person simply
    // stopped looking, and 'Cancelled' reads like a deal fell through.
    if (status === 'cancelled') return 'Closed';
    if (status === 'fulfilled') return 'Fulfilled';
    if (status === 'withdrawn_by_admin') return 'Removed';
    return status;
  }

  function statusColor(status: string) {
    if (status === 'matched') return GREEN;
    if (status === 'open') return GOLD;
    return GREY;
  }

  // A post is still the owner's to act on while it is live. Once it is
  // closed, fulfilled, expired or pulled by an admin there is nothing
  // left to do to it, and offering buttons that only ever fail is worse
  // than offering none.
  function isLive(status: string) {
    return status === 'open' || status === 'matched';
  }

  // ---- Owner actions --------------------------------------------------
  //
  // NO Alert.alert. react-native-web ignores its buttons array entirely
  // (the bug that made the chat attachment menu look dead), and this
  // screen is used from a desktop browser as well as a phone. The
  // confirmation is an inline strip on the card instead — two taps,
  // identical on both platforms. Same reasoning as DeclineControl in
  // chat.tsx.
  async function closePost(id: string) {
    setBusyId(id);
    const { error } = await supabase
      .from('item_requests')
      .update({ status: 'cancelled' })
      .eq('id', id);
    setBusyId(null);
    setConfirm(null);
    if (error) {
      reportHandledError('my-wanted-posts.close', error, { id });
      setActionError('Could not close that post: ' + error.message);
      return;
    }
    setActionError('');
    fetchMyPosts();
  }

  // DELETE IS ONLY OFFERED WHILE THERE ARE NO RESPONSES, and the reason
  // is in the schema: item_responses has ON DELETE CASCADE on this row.
  // Deleting a post that sellers have replied to destroys their replies
  // with no warning to them — someone who rang a supplier for a quote
  // would find their work simply gone. Closing keeps the history and
  // costs the owner nothing, so a post with responses can only be
  // closed. The count is re-checked on the server side of this call by
  // nothing at all, so the guard below is the only one — keep it.
  async function deletePost(id: string) {
    setBusyId(id);
    const { error } = await supabase.from('item_requests').delete().eq('id', id);
    setBusyId(null);
    setConfirm(null);
    if (error) {
      reportHandledError('my-wanted-posts.delete', error, { id });
      setActionError('Could not delete that post: ' + error.message);
      return;
    }
    setActionError('');
    fetchMyPosts();
  }

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={GOLD} />
      </View>
    );
  }

  // NEW: inline prompt, matching messages.tsx's own pattern exactly —
  // see top-of-file comment.
  if (needsAccount) {
    return (
      <View style={styles.container}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()}>
            <Text style={styles.backText}><Text style={styles.backArrow}>‹</Text> Back</Text>
          </TouchableOpacity>
          <Text style={styles.heading}>What I'm looking for</Text>
        </View>
        <View style={styles.needsAccountCard}>
          <Text style={styles.needsAccountIcon}>🔍</Text>
          <Text style={styles.needsAccountTitle}>Keep track of everything you're looking for</Text>
          <Text style={styles.needsAccountBody}>
            You can post a want without an account — but creating a free one lets you come back
            anytime and see all your posts and responses together, right here.
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

  // Offers across every post this person has open. The prompt below
  // keys off this rather than off being anonymous: see top-of-file.
  const totalOffers = posts.reduce((sum, p) => sum + p.responseCount, 0);

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()}>
          <Text style={styles.backText}><Text style={styles.backArrow}>‹</Text> Back</Text>
        </TouchableOpacity>
        <Text style={styles.heading}>What I'm looking for</Text>
        <Text style={styles.subheading}>
          {posts.length} thing{posts.length !== 1 ? 's' : ''} — tap one to see who replied
        </Text>
      </View>

      {/* THE ASK, AT THE ONLY MOMENT IT IS EARNED.
          Anonymous AND at least one seller has replied with a price.
          Before an offer exists this says nothing at all — an empty
          list has no claim on anybody's email address. What it must
          never become is a wall: everything below stays tappable, and
          the offers themselves are readable without signing up. */}
      {isAnonymous && totalOffers > 0 ? (
        <View style={styles.anonPrompt}>
          <Text style={styles.anonPromptTitle}>
            {totalOffers === 1
              ? 'Someone has sent you a price 🎉'
              : `${totalOffers} sellers have sent you a price 🎉`}
          </Text>
          <Text style={styles.anonPromptBody}>
            You posted without an account, so {totalOffers === 1 ? 'this offer lives' : 'these offers live'} only
            on this phone — a new phone, or a cleared app, and {totalOffers === 1 ? "it's" : "they're"} gone.
            A free account keeps {totalOffers === 1 ? 'it' : 'them'}, and you'll need one to accept.
          </Text>
          <TouchableOpacity style={styles.anonPromptBtn} onPress={() => router.push('/register')}>
            <Text style={styles.anonPromptBtnText}>Create free account — keep my offers</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => router.push('/login')}>
            <Text style={styles.anonPromptLink}>Already have an account? Sign in</Text>
          </TouchableOpacity>
        </View>
      ) : null}

      {actionError ? (
        <View style={styles.errorBanner}>
          <Text style={styles.errorBannerText}>{actionError}</Text>
        </View>
      ) : null}

      <FlatList
        data={posts}
        keyExtractor={(item) => item.id}
        style={styles.listContainer}
        contentContainerStyle={[styles.list, { paddingBottom: 16 + insets.bottom }]}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={GOLD} />}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyEmoji}>🔍</Text>
            <Text style={styles.emptyText}>You haven't posted anything yet.</Text>
            <Text style={styles.emptySubtext}>Post what you're looking for and sellers will respond with a price.</Text>
            <TouchableOpacity style={styles.postBtn} onPress={() => router.push('/post-wanted')}>
              <Text style={styles.postBtnText}>+ Post what you need</Text>
            </TouchableOpacity>
          </View>
        }
        renderItem={({ item }) => {
          const budget = budgetLabel(item.budget_min, item.budget_max);
          const confirming = confirm;
          return (
            <TouchableOpacity
              style={styles.card}
              activeOpacity={0.85}
              onPress={() => router.push(`/wanted-responses?request_id=${item.id}`)}
            >
              <View style={styles.cardTop}>
                <Text style={styles.cardTitle} numberOfLines={1}>{item.title}</Text>
                <View style={[styles.statusBadge, { borderColor: statusColor(item.status) }]}>
                  <Text style={[styles.statusBadgeText, { color: statusColor(item.status) }]}>
                    {statusLabel(item.status)}
                  </Text>
                </View>
              </View>

              <View style={styles.chips}>
                {budget && <Chip label={`💰 ${budget}`} />}
                <Chip label={`📍 ${item.location}`} />
                <Chip label={item.category} />
              </View>

              <View style={styles.cardFooter}>
                <Text style={styles.responseCountText}>
                  {item.responseCount === 0
                    ? 'No responses yet'
                    : `${item.responseCount} response${item.responseCount !== 1 ? 's' : ''}`}
                </Text>
                <Text style={styles.viewArrow}>View →</Text>
              </View>

              {/* Owner actions. The whole card is a TouchableOpacity that
                  navigates, so every control here has to stopPropagation
                  on press or tapping Delete would open the responses
                  screen on the way past. */}
              {isLive(item.status) ? (
                confirming?.id === item.id ? (
                  <View style={styles.confirmRow}>
                    <Text style={styles.confirmText}>
                      {confirming.action === 'delete'
                        ? 'Delete this post? This cannot be undone.'
                        : 'Close this post? Sellers can no longer respond.'}
                    </Text>
                    <View style={styles.confirmBtns}>
                      <TouchableOpacity
                        onPress={(e) => { e.stopPropagation(); setConfirm(null); }}
                        disabled={busyId === item.id}
                      >
                        <Text style={styles.confirmCancel}>Cancel</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        onPress={(e) => {
                          e.stopPropagation();
                          if (confirming.action === 'delete') deletePost(item.id);
                          else closePost(item.id);
                        }}
                        disabled={busyId === item.id}
                      >
                        <Text style={styles.confirmGo}>
                          {busyId === item.id
                            ? 'Working…'
                            : confirming.action === 'delete' ? 'Delete' : 'Close post'}
                        </Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                ) : (
                  <View style={styles.actionRow}>
                    {/* Edit and Delete are offered only while nobody has
                        replied. Changing the ask after sellers have priced
                        it moves the goalposts under them, and deleting it
                        destroys their replies outright — item_responses
                        cascades on this row. Closing stays available in
                        every live state, so there is always a way out. */}
                    {item.responseCount === 0 ? (
                      <TouchableOpacity
                        onPress={(e) => {
                          e.stopPropagation();
                          router.push(`/post-wanted?edit=${item.id}`);
                        }}
                      >
                        <Text style={styles.actionLink}>Edit</Text>
                      </TouchableOpacity>
                    ) : null}

                    <TouchableOpacity
                      onPress={(e) => { e.stopPropagation(); setActionError(''); setConfirm({ id: item.id, action: 'close' }); }}
                    >
                      <Text style={styles.actionLink}>Close</Text>
                    </TouchableOpacity>

                    {item.responseCount === 0 ? (
                      <TouchableOpacity
                        onPress={(e) => { e.stopPropagation(); setActionError(''); setConfirm({ id: item.id, action: 'delete' }); }}
                      >
                        <Text style={styles.actionDanger}>Delete</Text>
                      </TouchableOpacity>
                    ) : null}
                  </View>
                )
              ) : null}

            </TouchableOpacity>
          );
        }}
      />
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

  needsAccountCard: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  needsAccountIcon: { fontSize: 48, marginBottom: 20 },
  needsAccountTitle: { color: '#fff', fontSize: 18, fontWeight: '800', textAlign: 'center', marginBottom: 12 },
  needsAccountBody: { color: GREY, fontSize: 13, textAlign: 'center', lineHeight: 20, marginBottom: 28 },
  needsAccountBtn: { backgroundColor: GOLD, borderRadius: 14, paddingVertical: 16, paddingHorizontal: 40, marginBottom: 16 },
  needsAccountBtnText: { color: BLACK, fontSize: 15, fontWeight: '800' },
  needsAccountLoginLink: { color: GREY, fontSize: 13 },

  // Gold-edged rather than the usual grey card: this is the one thing
  // on the screen that is good news, and it has to read as good news
  // and not as a permission error. Sits above the list, never over it.
  anonPrompt: {
    backgroundColor: '#201a08', borderBottomWidth: 0.5, borderBottomColor: '#3d3214',
    paddingHorizontal: 18, paddingTop: 16, paddingBottom: 14,
  },
  anonPromptTitle: { color: '#fff', fontSize: 15, fontWeight: '800', marginBottom: 6 },
  anonPromptBody: { color: '#ddd', fontSize: 12.5, lineHeight: 18, marginBottom: 14 },
  anonPromptBtn: { backgroundColor: GOLD, borderRadius: 12, paddingVertical: 13, alignItems: 'center', marginBottom: 10 },
  anonPromptBtnText: { color: BLACK, fontSize: 13.5, fontWeight: '800' },
  anonPromptLink: { color: GREY, fontSize: 12, textAlign: 'center' },

  // FIX: was `gap: 14` here — see top-of-file comment. marginBottom
  // moved onto the card style itself instead.
  // FIX: same missing-bounded-height bug found and fixed in
  // operator-requests.tsx — FlatList had no `style`, only
  // contentContainerStyle, so it sized to its full content instead of
  // the remaining screen space and wouldn't actually scroll once there
  // were enough posts to overflow one screen. Also added insets.bottom
  // to the content's bottom padding so the last card doesn't sit flush
  // against the phone's home-indicator/gesture bar.
  listContainer: { flex: 1 },
  list: { padding: 16 },
  card: {
    backgroundColor: BLACK, borderRadius: 14, padding: 16,
    borderWidth: 0.5, borderColor: '#333',
    marginBottom: 14,
  },
  cardTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10, marginBottom: 10 },
  cardTitle: { color: '#fff', fontSize: 15, fontWeight: '700', flex: 1 },
  statusBadge: { borderRadius: 20, paddingHorizontal: 10, paddingVertical: 3, borderWidth: 1 },
  statusBadgeText: { fontSize: 10, fontWeight: '800' },

  chips: { flexDirection: 'row', gap: 8, marginBottom: 12, flexWrap: 'wrap' },
  chip: { backgroundColor: DARK, borderRadius: 20, paddingHorizontal: 10, paddingVertical: 4, borderWidth: 0.5, borderColor: '#333' },
  chipText: { fontSize: 12, color: GREY },

  cardFooter: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingTop: 10, borderTopWidth: 0.5, borderTopColor: '#2a2a2a' },

  actionRow: { flexDirection: 'row', gap: 20, paddingTop: 12, marginTop: 2, borderTopWidth: 0.5, borderTopColor: '#2a2a2a' },
  actionLink: { color: GREY, fontSize: 12, fontWeight: '700' },
  // Red rather than grey: the only control on this card that destroys
  // something should not look like the ones that do not.
  actionDanger: { color: '#ff8a8a', fontSize: 12, fontWeight: '700' },

  confirmRow: { paddingTop: 12, marginTop: 2, borderTopWidth: 0.5, borderTopColor: '#2a2a2a' },
  confirmText: { color: '#ddd', fontSize: 12, marginBottom: 10, lineHeight: 17 },
  confirmBtns: { flexDirection: 'row', gap: 22 },
  confirmCancel: { color: GREY, fontSize: 12, fontWeight: '700' },
  confirmGo: { color: '#ff8a8a', fontSize: 12, fontWeight: '800' },

  errorBanner: { backgroundColor: '#3a1f1f', borderBottomWidth: 0.5, borderBottomColor: '#5a2a2a', paddingHorizontal: 16, paddingVertical: 10 },
  errorBannerText: { color: '#ff8a8a', fontSize: 12.5 },
  responseCountText: { color: GREY, fontSize: 12 },
  viewArrow: { color: GOLD, fontSize: 12, fontWeight: '700' },

  empty: { alignItems: 'center', paddingTop: 60, paddingHorizontal: 30 },
  emptyEmoji: { fontSize: 40, marginBottom: 12 },
  emptyText: { fontSize: 16, color: '#fff', fontWeight: '600', textAlign: 'center' },
  emptySubtext: { fontSize: 13, color: GREY, marginTop: 6, textAlign: 'center', lineHeight: 18 },
  postBtn: { backgroundColor: GOLD, borderRadius: 20, paddingHorizontal: 18, paddingVertical: 10, marginTop: 18 },
  postBtnText: { color: BLACK, fontSize: 13, fontWeight: '800' },
});
