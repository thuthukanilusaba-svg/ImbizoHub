// app/analytics.tsx
// Seller-facing listing performance screen. Uses only real data already
// available on the listings table (category, status, price, created_at) —
// no view-tracking or message-analytics, since neither exists in the
// schema yet. That's separate future work, not part of this screen.
//
// FIX: this screen was fully built and working, but not actually gated
// behind Dealer Pro — any logged-in seller could open it for free,
// despite "Full listing performance analytics" being marketed as a paid
// Dealer Pro benefit on dealer-pro-pay.tsx. Now checks
// dealer_pro_active the same "paid boolean + expires_at, checked against
// now()" pattern already used everywhere else in the app (dealer.tsx,
// index.tsx's showDashboardTab check, etc.) and shows a locked state
// instead of the real numbers for anyone who isn't an active subscriber.
//
// FIX (real data-accuracy bug, found during a thorough review): the
// top-line "ACTIVE" stat strictly required status === 'active' (or
// null/undefined, defaulted), but the category breakdown and the
// Recent Listings badge both used a looser "anything that isn't
// literally 'sold' counts as active" check — which silently
// misclassified 'removed' listings (set when an account is deleted,
// or a listing taken down) as active in two of three places on a
// screen whose entire selling point is "real numbers, no estimates."
// The top-line count and the category breakdown could genuinely
// disagree with each other for any seller with a removed listing.
// Replaced with one classifyListing() helper, used consistently
// everywhere a listing's status needs to be judged.

import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator, Platform, ScrollView, StyleSheet,
  Text, TouchableOpacity, View,
} from 'react-native';
import { supabase } from '../../lib/supabase';

const GOLD = '#B8860B';
const BLACK = '#1A1A18';
const DARK = '#2a2a2a';
const GREY = '#AAAAAA';
const GREEN = '#4fc96e';

const CATEGORY_ICONS: Record<string, string> = {
  Phones: '📱',
  Vehicles: '🚗',
  Furniture: '🛋️',
  Clothing: '👕',
  Appliances: '🏠',
  Building: '🧱',
  Baby: '👶',
  Other: '📦',
};

type ListingClass = 'active' | 'sold' | 'other';
function classifyListing(status: string | null | undefined): ListingClass {
  const s = status ?? 'active';
  if (s === 'sold') return 'sold';
  if (s === 'active') return 'active';
  return 'other';
}

export default function AnalyticsScreen() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [listings, setListings] = useState<any[]>([]);
  const [dealerProActive, setDealerProActive] = useState(false);

  useEffect(() => { init(); }, []);

  async function init() {
    setLoading(true);
    setError('');

    const { data: { user } } = await supabase.auth.getUser();
    if (!user || user.is_anonymous) { router.replace('/register'); return; }

    const { data: profile } = await supabase
      .from('profiles')
      .select('dealer_pro_active, dealer_pro_expires_at')
      .eq('id', user.id)
      .maybeSingle();

    const isActive = !!(
      profile?.dealer_pro_active &&
      profile?.dealer_pro_expires_at &&
      new Date(profile.dealer_pro_expires_at).getTime() > Date.now()
    );
    setDealerProActive(isActive);

    if (isActive) {
      const { data, error: fetchError } = await supabase
        .from('listings')
        .select('id, title, price, category, status, created_at')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false });

      if (fetchError) { setError(fetchError.message); setLoading(false); return; }
      setListings(data ?? []);
    }

    setLoading(false);
  }

  const total = listings.length;
  const active = listings.filter(l => classifyListing(l.status) === 'active').length;
  const sold = listings.filter(l => classifyListing(l.status) === 'sold').length;
  const activeValue = listings
    .filter(l => classifyListing(l.status) === 'active')
    .reduce((sum, l) => sum + (Number(l.price) || 0), 0);

  const byCategory = listings.reduce((acc: Record<string, { active: number; sold: number }>, l) => {
    const cls = classifyListing(l.status);
    if (cls === 'other') return acc;
    const cat = l.category || 'Other';
    if (!acc[cat]) acc[cat] = { active: 0, sold: 0 };
    acc[cat][cls] += 1;
    return acc;
  }, {});

  const categoryRows = Object.entries(byCategory).sort((a, b) => (b[1].active + b[1].sold) - (a[1].active + a[1].sold));

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={GOLD} />
      </View>
    );
  }

  if (!dealerProActive) {
    return (
      <View style={styles.container}>
        <ScrollView contentContainerStyle={styles.content}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
            <Text style={styles.backText}><Text style={styles.backArrow}>‹</Text> Back</Text>
          </TouchableOpacity>
          <View style={styles.lockedBox}>
            <Text style={styles.lockedEmoji}>🔒</Text>
            <Text style={styles.lockedTitle}>Dealer Pro required</Text>
            <Text style={styles.lockedBody}>
              Listing performance analytics — total vs. active vs. sold, category breakdown, and
              real activity across everything you've listed — is a Dealer Pro benefit.
            </Text>
            <TouchableOpacity style={styles.lockedBtn} onPress={() => router.push('/dealer-pro-pay')}>
              <Text style={styles.lockedBtnText}>Learn more</Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Text style={styles.backText}><Text style={styles.backArrow}>‹</Text> Back</Text>
        </TouchableOpacity>

        <Text style={styles.heading}>Listing performance</Text>
        <Text style={styles.subheading}>Real numbers from your listings — no estimates.</Text>

        {error ? (
          <View style={styles.errorBox}><Text style={styles.errorText}>⚠️ {error}</Text></View>
        ) : null}

        {total === 0 ? (
          <View style={styles.emptyBox}>
            <Text style={styles.emptyText}>No listings yet.</Text>
            <Text style={styles.emptySubText}>Post your first listing to start seeing performance here.</Text>
            <TouchableOpacity style={styles.postBtn} onPress={() => router.push('/post')}>
              <Text style={styles.postBtnText}>+ Add listing</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <>
            <View style={styles.statsGrid}>
              <View style={styles.statCard}>
                <Text style={styles.statLbl}>TOTAL LISTINGS</Text>
                <Text style={styles.statValWhite}>{total}</Text>
              </View>
              <View style={styles.statCard}>
                <Text style={styles.statLbl}>ACTIVE</Text>
                <Text style={[styles.statValWhite, { color: GREEN }]}>{active}</Text>
              </View>
              <View style={styles.statCard}>
                <Text style={styles.statLbl}>SOLD</Text>
                <Text style={styles.statValWhite}>{sold}</Text>
              </View>
              <View style={[styles.statCard, styles.statCardHighlight]}>
                <Text style={styles.statLbl}>ACTIVE VALUE</Text>
                <Text style={styles.statValGold}>${activeValue.toFixed(0)}</Text>
              </View>
            </View>

            <View style={styles.section}>
              <Text style={styles.sectionTitle}>By category</Text>
              {categoryRows.map(([cat, counts]) => (
                <View key={cat} style={styles.catRow}>
                  <Text style={styles.catIcon}>{CATEGORY_ICONS[cat] || '📦'}</Text>
                  <Text style={styles.catName}>{cat}</Text>
                  <View style={styles.catCounts}>
                    <Text style={styles.catActive}>{counts.active} active</Text>
                    {counts.sold > 0 && <Text style={styles.catSold}>· {counts.sold} sold</Text>}
                  </View>
                </View>
              ))}
            </View>

            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Recent listings</Text>
              {listings.slice(0, 8).map((l) => {
                const cls = classifyListing(l.status);
                return (
                  <View key={l.id} style={styles.listingRow}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.listingTitle} numberOfLines={1}>{l.title}</Text>
                      <Text style={styles.listingMeta}>
                        {l.category || 'Other'} · {new Date(l.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
                      </Text>
                    </View>
                    <Text style={styles.listingPrice}>${l.price}</Text>
                    <View style={[
                      styles.listingBadge,
                      cls === 'sold' ? styles.listingBadgeSold : cls === 'active' ? styles.listingBadgeActive : styles.listingBadgeOther,
                    ]}>
                      <Text style={
                        cls === 'sold' ? styles.listingBadgeSoldText
                        : cls === 'active' ? styles.listingBadgeActiveText
                        : styles.listingBadgeOtherText
                      }>
                        {cls === 'sold' ? 'Sold' : cls === 'active' ? 'Active' : 'Removed'}
                      </Text>
                    </View>
                  </View>
                );
              })}
            </View>
          </>
        )}

        <View style={{ height: 40 }} />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#111111' },
  content: { padding: 20, paddingTop: Platform.OS === 'ios' ? 56 : 40 },
  center: { flex: 1, backgroundColor: '#111', alignItems: 'center', justifyContent: 'center' },

  backBtn: { marginBottom: 16 },
  backText: { color: GREY, fontSize: 14 },
  // NEW: bigger than the label text so the '‹' glyph reads clearly — direct product decision ("back symbol too small").
  backArrow: { fontSize: 20 },
  heading: { fontSize: 24, fontWeight: '800', color: '#fff', marginBottom: 6 },
  subheading: { fontSize: 13, color: GREY, marginBottom: 24 },

  errorBox: { backgroundColor: '#3a1a1a', borderRadius: 10, padding: 12, marginBottom: 16 },
  errorText: { color: '#ff8a8a', fontSize: 13, textAlign: 'center' },

  emptyBox: { backgroundColor: BLACK, borderRadius: 14, padding: 28, alignItems: 'center', borderWidth: 0.5, borderColor: '#333' },
  emptyText: { color: '#fff', fontSize: 14, fontWeight: '600', marginBottom: 6 },
  emptySubText: { color: GREY, fontSize: 12, textAlign: 'center', lineHeight: 17, marginBottom: 18 },
  postBtn: { backgroundColor: GOLD, borderRadius: 10, paddingHorizontal: 20, paddingVertical: 12 },
  postBtnText: { color: BLACK, fontSize: 13, fontWeight: '800' },

  lockedBox: { backgroundColor: BLACK, borderRadius: 14, padding: 28, alignItems: 'center', borderWidth: 1, borderColor: GOLD, marginTop: 20 },
  lockedEmoji: { fontSize: 40, marginBottom: 12 },
  lockedTitle: { color: '#fff', fontSize: 16, fontWeight: '800', marginBottom: 10 },
  lockedBody: { color: GREY, fontSize: 12, textAlign: 'center', lineHeight: 18, marginBottom: 20 },
  lockedBtn: { backgroundColor: GOLD, borderRadius: 10, paddingHorizontal: 22, paddingVertical: 12 },
  lockedBtnText: { color: BLACK, fontSize: 13, fontWeight: '800' },

  statsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 20 },
  statCard: { width: '47.5%', backgroundColor: BLACK, borderRadius: 12, padding: 14, borderWidth: 0.5, borderColor: '#333' },
  statCardHighlight: { borderColor: GOLD },
  statLbl: { color: GREY, fontSize: 10, marginBottom: 4, letterSpacing: 0.5 },
  statValWhite: { color: '#fff', fontSize: 24, fontWeight: '800' },
  statValGold: { color: GOLD, fontSize: 24, fontWeight: '800' },

  section: { backgroundColor: BLACK, borderRadius: 14, padding: 16, marginBottom: 14, borderWidth: 0.5, borderColor: '#333' },
  sectionTitle: { color: '#fff', fontSize: 13, fontWeight: '700', marginBottom: 12 },

  catRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, borderBottomWidth: 0.5, borderBottomColor: '#2a2a2a' },
  catIcon: { fontSize: 16, marginRight: 10 },
  catName: { flex: 1, color: '#fff', fontSize: 13, fontWeight: '600' },
  catCounts: { flexDirection: 'row', gap: 4 },
  catActive: { color: GREEN, fontSize: 12 },
  catSold: { color: GREY, fontSize: 12 },

  listingRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, borderBottomWidth: 0.5, borderBottomColor: '#2a2a2a' },
  listingTitle: { color: '#fff', fontSize: 13, fontWeight: '600' },
  listingMeta: { color: GREY, fontSize: 11, marginTop: 2 },
  listingPrice: { color: GOLD, fontSize: 13, fontWeight: '700' },
  listingBadge: { borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 },
  listingBadgeActive: { backgroundColor: '#1a2a1a' },
  listingBadgeSold: { backgroundColor: '#2a1a1a' },
  listingBadgeOther: { backgroundColor: '#2a2a2a' },
  listingBadgeActiveText: { color: GREEN, fontSize: 10, fontWeight: '700' },
  listingBadgeSoldText: { color: '#ff8a8a', fontSize: 10, fontWeight: '700' },
  listingBadgeOtherText: { color: GREY, fontSize: 10, fontWeight: '700' },
});
