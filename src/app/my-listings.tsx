// app/my-listings.tsx
//
// FIX (real bug found while investigating a user report): profile.tsx's
// "My listings" menu item previously just navigated to /explore — the
// general Browse screen, showing every seller's active listings, not
// the current user's own. There was no actual "my inventory" view
// anywhere in the app; the label was simply wrong. This is that real
// screen: the logged-in user's own listings, active ones first, sold
// ones pushed to the bottom and visually greyed out — exactly what
// "My listings" always should have shown.
//
// Deliberately fetches BOTH active and sold (unlike explore.tsx/
// index.tsx, which correctly show active only, since buyers should
// never see another seller's sold items) — a seller genuinely wants to
// see their own sales history here, just not mixed in at the top.
//
// Usage: router.push('/my-listings')

import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { buildListingHref } from '../../lib/listingNav';
import { formatPrice } from '../../lib/money';
import { supabase } from '../../lib/supabase';
import { reportHandledError } from '../../lib/crashReporter';

const GOLD = '#B8860B';
const BLACK = '#1A1A18';
const DARK = '#2a2a2a';
const GREY = '#AAAAAA';

export default function MyListingsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [listings, setListings] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  // Keyed by listing id so two cards can never share a state, and a slow
  // request cannot leave the wrong card spinning. Same shape as
  // my-wanted-posts.tsx.
  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [actionError, setActionError] = useState('');

  // NO Alert.alert — react-native-web ignores its buttons array outright
  // (see the note in chat.tsx), and this screen is used from a desktop
  // browser too. The confirmation is inline on the card instead.
  //
  // Deleting is safe for other people's work here, unlike a Wanted post:
  // every foreign key pointing at listings is ON DELETE SET NULL, so
  // messages, ratings and delivery bookings survive and simply detach.
  // A buyer mid-conversation keeps the thread; they just lose the item
  // card in it. That is why this is offered without the no-responses
  // guard that Wanted posts need.
  async function deleteListing(id: string) {
    setBusyId(id);
    const { error } = await supabase.from('listings').delete().eq('id', id);
    setBusyId(null);
    setConfirmId(null);
    if (error) {
      reportHandledError('my-listings.delete', error, { id });
      setActionError('Could not delete that listing: ' + error.message);
      return;
    }
    setActionError('');
    loadMyListings();
  }

  useEffect(() => {
    loadMyListings();
  }, []);

  async function loadMyListings() {
    setLoading(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setLoading(false); return; }

    const { data } = await supabase
      .from('listings')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false });

    if (data) {
      // Active listings first (most recent first within that group),
      // sold listings pushed to the bottom (most recently sold first
      // within that group) — a stable sort by status, since the query
      // above already sorted by created_at descending.
      const sorted = [...data].sort((a, b) => {
        const aSold = a.status === 'sold' ? 1 : 0;
        const bSold = b.status === 'sold' ? 1 : 0;
        return aSold - bSold;
      });
      setListings(sorted);
    }
    setLoading(false);
  }

  // 'active' explicitly, not "anything that isn't sold". A listing
  // pulled down by a moderator ('removed_by_admin') would otherwise be
  // counted and shown as active, so a blocked seller would look at a
  // normal-looking list and have no idea their items had stopped being
  // visible to anybody.
  const activeCount = listings.filter((l) => l.status === 'active').length;
  const soldCount = listings.filter((l) => l.status === 'sold').length;
  const removedCount = listings.filter((l) => l.status === 'removed_by_admin').length;

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()}>
          <Text style={styles.backText}><Text style={styles.backArrow}>‹</Text> Back</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>My Listings</Text>
        <View style={{ width: 50 }} />
      </View>

      {!loading && listings.length > 0 && (
        <Text style={styles.countSummary}>
          {activeCount} active{soldCount > 0 ? ` · ${soldCount} sold` : ''}
          {removedCount > 0 ? ` · ${removedCount} removed` : ''}
        </Text>
      )}

      {loading ? (
        <ActivityIndicator color={GOLD} style={{ marginTop: 40 }} />
      ) : (
        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 + insets.bottom }}>
          {actionError ? (
            <View style={styles.errorBanner}>
              <Text style={styles.errorBannerText}>{actionError}</Text>
            </View>
          ) : null}

          {listings.length === 0 && (
            <View style={styles.emptyState}>
              <Text style={styles.emptyEmoji}>📦</Text>
              <Text style={styles.emptyText}>You haven't posted any listings yet.</Text>
              <TouchableOpacity style={styles.postBtn} onPress={() => router.push('/post')}>
                <Text style={styles.postBtnText}>Post your first listing</Text>
              </TouchableOpacity>
            </View>
          )}

          {listings.map((item) => {
            const isSold = item.status === 'sold';
            const isRemoved = item.status === 'removed_by_admin';
            return (
              <View key={item.id}>
              <TouchableOpacity
                style={[styles.card, (isSold || isRemoved) && styles.cardSold]}
                // NEW: swipe-through-postings context — see lib/listingNav.ts.
                onPress={() => router.push(buildListingHref(item.id, listings.map((l) => l.id)))}
                activeOpacity={0.8}
              >
                <View style={styles.imageWrap}>
                  <Image
                    source={{ uri: item.image_url }}
                    style={[styles.image, (isSold || isRemoved) && styles.imageSold]}
                    contentFit="cover"
                  />
                  {isSold && (
                    <View style={styles.soldBadge}>
                      <Text style={styles.soldBadgeText}>SOLD</Text>
                    </View>
                  )}
                  {/* Says removed, not just greyed out. A seller whose
                      account was blocked is owed a plain statement that
                      this item is no longer visible to buyers — the
                      reason itself reaches them by push and again the
                      moment they try to post. */}
                  {isRemoved && (
                    <View style={styles.removedBadge}>
                      <Text style={styles.removedBadgeText}>REMOVED</Text>
                    </View>
                  )}
                </View>
                <View style={styles.cardBody}>
                  <Text style={[styles.title, isSold && styles.titleSold]} numberOfLines={1}>
                    {item.title}
                  </Text>
                  <Text style={[styles.price, isSold && styles.priceSold]}>${formatPrice(item.price)}</Text>
                  <Text style={styles.location}>{item.location}</Text>
                </View>
              </TouchableOpacity>

              {/* Actions sit OUTSIDE the card's TouchableOpacity rather
                  than inside it. The card is a row — image beside body —
                  so a third child would land next to the text, and any
                  control nested in a navigating parent has to fight it
                  for the tap. */}
              {isRemoved ? null : confirmId === item.id ? (
                <View style={styles.confirmRow}>
                  <Text style={styles.confirmText}>
                    Delete this listing? Chats about it stay, but buyers will no longer see the item.
                  </Text>
                  <View style={styles.confirmBtns}>
                    <TouchableOpacity onPress={() => setConfirmId(null)} disabled={busyId === item.id}>
                      <Text style={styles.confirmCancel}>Cancel</Text>
                    </TouchableOpacity>
                    <TouchableOpacity onPress={() => deleteListing(item.id)} disabled={busyId === item.id}>
                      <Text style={styles.confirmGo}>{busyId === item.id ? 'Deleting…' : 'Delete'}</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              ) : (
                <View style={styles.actionRow}>
                  {/* Editing a sold listing would change what a completed
                      deal was for, so it stops at 'active'. Deleting one
                      is still allowed — it is the seller's own record. */}
                  {item.status === 'active' ? (
                    <TouchableOpacity onPress={() => router.push(`/post?edit=${item.id}`)}>
                      <Text style={styles.actionLink}>Edit</Text>
                    </TouchableOpacity>
                  ) : null}
                  <TouchableOpacity onPress={() => { setActionError(''); setConfirmId(item.id); }}>
                    <Text style={styles.actionDanger}>Delete</Text>
                  </TouchableOpacity>
                </View>
              )}
              </View>
            );
          })}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#111111' },
  header: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    padding: 16, paddingTop: 50, backgroundColor: BLACK,
  },
  backText: { color: GOLD, fontSize: 14 },
  // NEW: bigger than the label text so the '‹' glyph reads clearly — direct product decision ("back symbol too small").
  backArrow: { fontSize: 20 },
  headerTitle: { color: '#fff', fontSize: 16, fontWeight: '700' },
  countSummary: { color: GREY, fontSize: 12, paddingHorizontal: 16, paddingTop: 12, paddingBottom: 4 },
  emptyState: { alignItems: 'center', marginTop: 60 },
  emptyEmoji: { fontSize: 48, marginBottom: 16 },
  emptyText: { color: GREY, fontSize: 13, marginBottom: 20, textAlign: 'center' },
  postBtn: { backgroundColor: GOLD, borderRadius: 12, paddingVertical: 12, paddingHorizontal: 24 },
  postBtnText: { color: BLACK, fontSize: 13, fontWeight: '700' },
  card: {
    flexDirection: 'row', backgroundColor: DARK, borderRadius: 14, padding: 10, marginBottom: 10,
    borderWidth: 0.5, borderColor: '#333',
  },
  cardSold: { opacity: 0.6 },

  actionRow: { flexDirection: 'row', gap: 20, marginTop: -4, marginBottom: 14, paddingHorizontal: 4 },
  actionLink: { color: GREY, fontSize: 12, fontWeight: '700' },
  actionDanger: { color: '#ff8a8a', fontSize: 12, fontWeight: '700' },

  confirmRow: { marginTop: -4, marginBottom: 14, paddingHorizontal: 4 },
  confirmText: { color: '#ddd', fontSize: 12, marginBottom: 8, lineHeight: 17 },
  confirmBtns: { flexDirection: 'row', gap: 22 },
  confirmCancel: { color: GREY, fontSize: 12, fontWeight: '700' },
  confirmGo: { color: '#ff8a8a', fontSize: 12, fontWeight: '800' },

  errorBanner: { backgroundColor: '#3a1f1f', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, marginBottom: 12 },
  errorBannerText: { color: '#ff8a8a', fontSize: 12.5 },
  imageWrap: { position: 'relative' },
  image: { width: 80, height: 80, borderRadius: 10 },
  imageSold: { opacity: 0.7 },
  soldBadge: {
    position: 'absolute', top: 4, left: 4, backgroundColor: '#8a2a2a',
    borderRadius: 4, paddingHorizontal: 6, paddingVertical: 2,
  },
  // Deeper red than soldBadge and full-width across the thumbnail: SOLD
  // is good news, this is not, and the two must not be mistaken for one
  // another at a glance.
  removedBadge: {
    position: 'absolute', top: 4, left: 4, right: 4, backgroundColor: '#7a1f1f',
    borderRadius: 4, paddingHorizontal: 4, paddingVertical: 2, alignItems: 'center',
  },
  removedBadgeText: { color: '#ffd9d9', fontSize: 9, fontWeight: '800' },
  soldBadgeText: { color: '#fff', fontSize: 9, fontWeight: '800' },
  cardBody: { flex: 1, marginLeft: 12, justifyContent: 'center' },
  title: { color: '#fff', fontSize: 14, fontWeight: '700', marginBottom: 3 },
  titleSold: { color: GREY },
  price: { color: GOLD, fontSize: 14, fontWeight: '800', marginBottom: 3 },
  priceSold: { color: GREY },
  location: { color: GREY, fontSize: 11 },
});
