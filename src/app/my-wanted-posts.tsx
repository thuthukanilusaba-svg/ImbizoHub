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
// Deliberately requires a real account — posting itself stays
// anonymous-friendly per post-wanted.tsx, but tracking "my posts over
// time" is the same "come back and find my history" case messages.tsx
// already draws this line on, and an anonymous session can't durably
// back that up.
//
// FIX (real inconsistency, found during a thorough review): this
// file's own comment claimed to follow "the same case messages.tsx
// already draws this line on" — but the actual check (`!user`, missing
// is_anonymous) didn't match what messages.tsx correctly does, and
// used a bare router.replace('/login') instead of messages.tsx's
// friendlier inline prompt (and the wrong destination besides —
// someone who's only ever posted anonymously has no existing account
// to log into). Now genuinely matches messages.tsx's own pattern:
// correct anonymous check, inline explanation instead of a jarring
// redirect, and pointed at /register.
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
import { supabase } from '../../lib/supabase';

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
  if (min != null && max != null) return `$${min} – $${max}`;
  if (min != null) return `$${min}+`;
  return `Up to $${max}`;
}

export default function MyWantedPostsScreen() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [posts, setPosts] = useState<WantedPost[]>([]);
  // NEW: matches messages.tsx's own pattern — see top-of-file comment.
  const [needsAccount, setNeedsAccount] = useState(false);

  useEffect(() => { fetchMyPosts(); }, []);

  async function fetchMyPosts() {
    const { data: { user } } = await supabase.auth.getUser();
    // FIX: was `if (!user)`, missing user.is_anonymous — see
    // top-of-file comment.
    if (!user || user.is_anonymous) {
      setNeedsAccount(true);
      setLoading(false);
      return;
    }

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

    const ids = requests.map((r) => r.id);
    const { data: responses } = await supabase
      .from('item_responses')
      .select('item_request_id')
      .in('item_request_id', ids);

    const countMap: Record<string, number> = {};
    (responses ?? []).forEach((r: any) => {
      countMap[r.item_request_id] = (countMap[r.item_request_id] ?? 0) + 1;
    });

    setPosts(requests.map((r) => ({ ...r, responseCount: countMap[r.id] ?? 0 })));
    setLoading(false);
  }

  async function handleRefresh() {
    setRefreshing(true);
    await fetchMyPosts();
    setRefreshing(false);
  }

  function statusLabel(status: string) {
    if (status === 'matched') return 'Matched';
    if (status === 'open') return 'Open';
    return status;
  }

  function statusColor(status: string) {
    if (status === 'matched') return GREEN;
    if (status === 'open') return GOLD;
    return GREY;
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
          <Text style={styles.heading}>My wanted posts</Text>
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

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()}>
          <Text style={styles.backText}><Text style={styles.backArrow}>‹</Text> Back</Text>
        </TouchableOpacity>
        <Text style={styles.heading}>My wanted posts</Text>
        <Text style={styles.subheading}>
          {posts.length} post{posts.length !== 1 ? 's' : ''} — tap one to see responses
        </Text>
      </View>

      <FlatList
        data={posts}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={GOLD} />}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyEmoji}>🔍</Text>
            <Text style={styles.emptyText}>You haven't posted anything yet.</Text>
            <Text style={styles.emptySubtext}>Post what you're looking for and sellers will respond with a price.</Text>
            <TouchableOpacity style={styles.postBtn} onPress={() => router.push('/post-wanted')}>
              <Text style={styles.postBtnText}>+ Post a want</Text>
            </TouchableOpacity>
          </View>
        }
        renderItem={({ item }) => {
          const budget = budgetLabel(item.budget_min, item.budget_max);
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

  // FIX: was `gap: 14` here — see top-of-file comment. marginBottom
  // moved onto the card style itself instead.
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
  responseCountText: { color: GREY, fontSize: 12 },
  viewArrow: { color: GOLD, fontSize: 12, fontWeight: '700' },

  empty: { alignItems: 'center', paddingTop: 60, paddingHorizontal: 30 },
  emptyEmoji: { fontSize: 40, marginBottom: 12 },
  emptyText: { fontSize: 16, color: '#fff', fontWeight: '600', textAlign: 'center' },
  emptySubtext: { fontSize: 13, color: GREY, marginTop: 6, textAlign: 'center', lineHeight: 18 },
  postBtn: { backgroundColor: GOLD, borderRadius: 20, paddingHorizontal: 18, paddingVertical: 10, marginTop: 18 },
  postBtnText: { color: BLACK, fontSize: 13, fontWeight: '800' },
});
