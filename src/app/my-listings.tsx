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

const GOLD = '#B8860B';
const BLACK = '#1A1A18';
const DARK = '#2a2a2a';
const GREY = '#AAAAAA';

export default function MyListingsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [listings, setListings] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

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

  const activeCount = listings.filter((l) => l.status !== 'sold').length;
  const soldCount = listings.filter((l) => l.status === 'sold').length;

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
        </Text>
      )}

      {loading ? (
        <ActivityIndicator color={GOLD} style={{ marginTop: 40 }} />
      ) : (
        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 + insets.bottom }}>
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
            return (
              <TouchableOpacity
                key={item.id}
                style={[styles.card, isSold && styles.cardSold]}
                // NEW: swipe-through-postings context — see lib/listingNav.ts.
                onPress={() => router.push(buildListingHref(item.id, listings.map((l) => l.id)))}
                activeOpacity={0.8}
              >
                <View style={styles.imageWrap}>
                  <Image
                    source={{ uri: item.image_url }}
                    style={[styles.image, isSold && styles.imageSold]}
                    contentFit="cover"
                  />
                  {isSold && (
                    <View style={styles.soldBadge}>
                      <Text style={styles.soldBadgeText}>SOLD</Text>
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
  imageWrap: { position: 'relative' },
  image: { width: 80, height: 80, borderRadius: 10 },
  imageSold: { opacity: 0.7 },
  soldBadge: {
    position: 'absolute', top: 4, left: 4, backgroundColor: '#8a2a2a',
    borderRadius: 4, paddingHorizontal: 6, paddingVertical: 2,
  },
  soldBadgeText: { color: '#fff', fontSize: 9, fontWeight: '800' },
  cardBody: { flex: 1, marginLeft: 12, justifyContent: 'center' },
  title: { color: '#fff', fontSize: 14, fontWeight: '700', marginBottom: 3 },
  titleSold: { color: GREY },
  price: { color: GOLD, fontSize: 14, fontWeight: '800', marginBottom: 3 },
  priceSold: { color: GREY },
  location: { color: GREY, fontSize: 11 },
});
