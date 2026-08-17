// app/seller.tsx
// Public seller profile — the shareable page from today's strategy
// work. Read-only view of ANY seller by id, unlike profile.tsx (which
// is always "my own" private profile with edit/delete capability).
// Deliberately no auth requirement to VIEW this screen — the whole
// point is it being genuinely shareable outside the app (WhatsApp,
// Facebook), and someone clicking a shared link with the app installed
// but not logged in should still see the seller's real reputation, not
// a login wall first.
//
// HONEST LIMITATION, not silently glossed over: this screen makes
// sharing genuinely work for anyone who ALREADY has ImbizoHub
// installed (tapping a deep link opens straight here). It does NOT by
// itself make the link open a nice preview for someone who doesn't
// have the app yet — that needs a real hosted web page with domain
// verification (Apple's apple-app-site-association, Android's
// assetlinks.json), which is separate infrastructure (a domain,
// hosting, DNS) beyond app code alone. That's a distinct, larger piece
// of work, not something quietly assumed to already work here.
//
// FIX (real bug, found during a full-codebase sweep): handleShare()
// built its deep link as `${DEEP_LINK_SCHEME}/${id}` — a PATH segment
// — but this screen only ever reads `id` as a QUERY param
// (useLocalSearchParams below), matching the "Usage" line right below
// this comment. There's no app/seller/[id].tsx dynamic route anywhere
// in this codebase to handle a path-based id. That meant every shared
// link ("Check out X on ImbizoHub...") would open the app to a seller
// screen with no id at all, hitting the notFound state — undermining
// the entire point of this being a genuinely shareable profile, exactly
// the outcome the file's own header comment is careful to say this
// screen DOES deliver (for someone who already has the app installed).
// Now matches the documented query-param format.
//
// Usage: router.push(`/seller?id=${sellerId}`)

import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import {
    ActivityIndicator, Image, Platform, ScrollView, Share, StyleSheet,
    Text, TouchableOpacity, View,
} from 'react-native';
import { buildListingHref } from '../../lib/listingNav';
import { supabase } from '../../lib/supabase';

const GOLD = '#B8860B';
const BLACK = '#1A1A18';
const DARK = '#2a2a2a';
const GREY = '#AAAAAA';
const GREEN = '#4fc96e';

const DEEP_LINK_SCHEME = 'imbizohub://seller';

export default function SellerProfileScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();

  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [profile, setProfile] = useState<any>(null);
  const [listings, setListings] = useState<any[]>([]);
  const [reviews, setReviews] = useState<any[]>([]);
  const [listingCount, setListingCount] = useState(0);

  useEffect(() => { load(); }, [id]);

  async function load() {
    if (!id) { setNotFound(true); setLoading(false); return; }
    setLoading(true);

    const { data: profileData, error: profileError } = await supabase
      .from('profiles')
      .select('full_name, avatar_url, account_type, rating, rating_count, created_at, dealer_pro_active, dealer_pro_expires_at, is_verified, verified_expires_at')
      .eq('id', id)
      .maybeSingle();

    if (profileError || !profileData) {
      setNotFound(true);
      setLoading(false);
      return;
    }

    setProfile(profileData);

    const { data: activeListings, count } = await supabase
      .from('listings')
      .select('id, title, price, image_url, category', { count: 'exact' })
      .eq('user_id', id)
      .eq('status', 'active')
      .order('created_at', { ascending: false })
      .limit(12);

    setListings(activeListings ?? []);
    setListingCount(count ?? 0);

    const { data: recentReviews } = await supabase
      .from('ratings')
      .select('stars, review, role, created_at')
      .eq('reviewee_id', id)
      .order('created_at', { ascending: false })
      .limit(5);

    setReviews(recentReviews ?? []);
    setLoading(false);
  }

  async function handleShare() {
    if (!id || !profile) return;
    const name = profile.full_name || 'this seller';
    const ratingText = profile.rating_count > 0
      ? `${profile.rating.toFixed(1)}\u2605 (${profile.rating_count} reviews)`
      : 'a new seller';

    try {
      await Share.share({
        message: `Check out ${name} on ImbizoHub \u2014 ${ratingText}. ${DEEP_LINK_SCHEME}?id=${id}`,
      });
    } catch (err) {
      // Share sheet dismissed or unavailable — not worth surfacing as
      // an error, the person just didn't complete the share action.
    }
  }

  function initials() {
    if (!profile?.full_name) return '?';
    return profile.full_name.split(' ').map((w: string) => w[0]).join('').slice(0, 2).toUpperCase();
  }

  function joinedDate() {
    if (!profile?.created_at) return '';
    return new Date(profile.created_at).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
  }

  function isDealerPro(): boolean {
    return !!(
      profile?.dealer_pro_active &&
      profile?.dealer_pro_expires_at &&
      new Date(profile.dealer_pro_expires_at).getTime() > Date.now()
    );
  }

  function isVerifiedSeller(): boolean {
    return !!(
      profile?.is_verified &&
      profile?.verified_expires_at &&
      new Date(profile.verified_expires_at).getTime() > Date.now()
    );
  }

  function renderStars(count: number, size = 16) {
    return (
      <View style={{ flexDirection: 'row', gap: 2 }}>
        {[1, 2, 3, 4, 5].map((s) => (
          <Text key={s} style={{ fontSize: size, color: s <= Math.round(count) ? GOLD : '#333' }}>★</Text>
        ))}
      </View>
    );
  }

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={GOLD} />
      </View>
    );
  }

  if (notFound) {
    return (
      <View style={styles.center}>
        <Text style={styles.notFoundEmoji}>🔍</Text>
        <Text style={styles.notFoundTitle}>Seller not found</Text>
        <TouchableOpacity style={styles.backBtnCentered} onPress={() => router.replace('/')}>
          <Text style={styles.backBtnCenteredText}>← Back to home</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.topRow}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
            <Text style={styles.backText}>← Back</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={handleShare} style={styles.shareBtn}>
            <Text style={styles.shareBtnText}>Share ↗</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.identitySection}>
          {profile.avatar_url ? (
            <Image source={{ uri: profile.avatar_url }} style={styles.avatarImage} />
          ) : (
            <View style={styles.avatarPlaceholder}>
              <Text style={styles.avatarInitials}>{initials()}</Text>
            </View>
          )}

          <Text style={styles.name}>{profile.full_name || 'ImbizoHub Seller'}</Text>

          {profile.rating_count > 0 ? (
            <View style={styles.ratingRow}>
              {renderStars(profile.rating)}
              <Text style={styles.ratingText}>
                {profile.rating.toFixed(1)} ({profile.rating_count} review{profile.rating_count === 1 ? '' : 's'})
              </Text>
            </View>
          ) : (
            <Text style={styles.noRatingText}>No ratings yet</Text>
          )}

          <View style={styles.badgeRow}>
            {isDealerPro() && (
              <View style={styles.dealerBadge}><Text style={styles.dealerBadgeText}>⭐ Dealer</Text></View>
            )}
            {isVerifiedSeller() && (
              <View style={styles.verifiedBadge}><Text style={styles.verifiedBadgeText}>✅ Verified</Text></View>
            )}
          </View>

          <Text style={styles.joinedText}>On ImbizoHub since {joinedDate()}</Text>
        </View>

        <View style={styles.statsRow}>
          <View style={styles.statBox}>
            <Text style={styles.statValue}>{listingCount}</Text>
            <Text style={styles.statLabel}>Active listings</Text>
          </View>
          <View style={styles.statDivider} />
          <View style={styles.statBox}>
            <Text style={styles.statValue}>{profile.rating_count > 0 ? profile.rating.toFixed(1) : '—'}</Text>
            <Text style={styles.statLabel}>Rating</Text>
          </View>
        </View>

        {listings.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Active listings</Text>
            <View style={styles.listingsGrid}>
              {listings.map((l) => (
                <TouchableOpacity
                  key={l.id}
                  style={styles.listingCard}
                  // NEW: swipe-through-postings context — see lib/listingNav.ts.
                  onPress={() => router.push(buildListingHref(l.id, listings.map((x) => x.id)))}
                  activeOpacity={0.85}
                >
                  {l.image_url ? (
                    <Image source={{ uri: l.image_url }} style={styles.listingImage} />
                  ) : (
                    <View style={styles.listingImagePlaceholder}>
                      <Text style={{ fontSize: 28 }}>📦</Text>
                    </View>
                  )}
                  <Text style={styles.listingTitle} numberOfLines={1}>{l.title}</Text>
                  <Text style={styles.listingPrice}>${l.price}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        )}

        {reviews.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Recent reviews</Text>
            {reviews.map((r, i) => (
              <View key={i} style={styles.reviewItem}>
                <View style={styles.reviewHeader}>
                  {renderStars(r.stars, 14)}
                  <Text style={styles.reviewMeta}>
                    {r.role === 'buyer' ? 'Buyer' : 'Seller'} · {new Date(r.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
                  </Text>
                </View>
                {r.review ? <Text style={styles.reviewText}>{r.review}</Text> : null}
              </View>
            ))}
          </View>
        )}

        {listings.length === 0 && reviews.length === 0 && (
          <View style={styles.emptyBox}>
            <Text style={styles.emptyText}>No active listings or reviews yet.</Text>
          </View>
        )}

        <View style={{ height: 40 }} />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#111111' },
  content: { padding: 20, paddingTop: Platform.OS === 'ios' ? 56 : 40, paddingBottom: 48 },
  center: { flex: 1, backgroundColor: '#111', alignItems: 'center', justifyContent: 'center', padding: 30 },

  topRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 },
  backBtn: {},
  backText: { color: GREY, fontSize: 14 },
  shareBtn: { backgroundColor: DARK, borderRadius: 20, paddingHorizontal: 14, paddingVertical: 8, borderWidth: 0.5, borderColor: GOLD },
  shareBtnText: { color: GOLD, fontSize: 13, fontWeight: '700' },

  notFoundEmoji: { fontSize: 48, marginBottom: 16 },
  notFoundTitle: { color: '#fff', fontSize: 18, fontWeight: '800', marginBottom: 24 },
  backBtnCentered: { backgroundColor: DARK, borderRadius: 12, paddingVertical: 12, paddingHorizontal: 24 },
  backBtnCenteredText: { color: '#fff', fontSize: 14, fontWeight: '600' },

  identitySection: { alignItems: 'center', marginBottom: 24 },
  avatarImage: { width: 88, height: 88, borderRadius: 44, marginBottom: 14 },
  avatarPlaceholder: { width: 88, height: 88, borderRadius: 44, backgroundColor: GOLD, alignItems: 'center', justifyContent: 'center', marginBottom: 14 },
  avatarInitials: { color: BLACK, fontSize: 30, fontWeight: '800' },
  name: { fontSize: 20, fontWeight: '800', color: '#fff', marginBottom: 8 },
  ratingRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 },
  ratingText: { fontSize: 12, color: GREY },
  noRatingText: { fontSize: 12, color: '#666', marginBottom: 10 },
  badgeRow: { flexDirection: 'row', gap: 8, marginBottom: 10 },
  dealerBadge: { backgroundColor: '#3a2800', borderRadius: 20, paddingHorizontal: 12, paddingVertical: 5 },
  dealerBadgeText: { color: GOLD, fontSize: 11, fontWeight: '700' },
  verifiedBadge: { backgroundColor: '#1a2a3a', borderRadius: 20, paddingHorizontal: 12, paddingVertical: 5 },
  verifiedBadgeText: { color: '#4A90D9', fontSize: 11, fontWeight: '700' },
  joinedText: { fontSize: 12, color: '#666' },

  statsRow: { flexDirection: 'row', backgroundColor: BLACK, borderRadius: 14, padding: 16, marginBottom: 20, borderWidth: 0.5, borderColor: '#333' },
  statBox: { flex: 1, alignItems: 'center' },
  statValue: { fontSize: 22, fontWeight: '800', color: '#fff' },
  statLabel: { fontSize: 10, color: GREY, marginTop: 4 },
  statDivider: { width: 0.5, backgroundColor: '#333', marginHorizontal: 12 },

  section: { marginBottom: 20 },
  sectionTitle: { fontSize: 14, fontWeight: '700', color: '#fff', marginBottom: 12 },

  listingsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  listingCard: { width: '31%', backgroundColor: BLACK, borderRadius: 10, padding: 8, borderWidth: 0.5, borderColor: '#333' },
  listingImage: { width: '100%', height: 70, borderRadius: 8, marginBottom: 6, backgroundColor: DARK },
  listingImagePlaceholder: { width: '100%', height: 70, borderRadius: 8, marginBottom: 6, backgroundColor: DARK, alignItems: 'center', justifyContent: 'center' },
  listingTitle: { color: '#fff', fontSize: 11, fontWeight: '600', marginBottom: 2 },
  listingPrice: { color: GOLD, fontSize: 12, fontWeight: '700' },

  reviewItem: { backgroundColor: BLACK, borderRadius: 12, padding: 14, marginBottom: 10, borderWidth: 0.5, borderColor: '#333' },
  reviewHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 },
  reviewMeta: { fontSize: 11, color: GREY },
  reviewText: { fontSize: 13, color: '#ccc', lineHeight: 19 },

  emptyBox: { backgroundColor: BLACK, borderRadius: 14, padding: 28, alignItems: 'center', borderWidth: 0.5, borderColor: '#333' },
  emptyText: { color: GREY, fontSize: 13 },
});
