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
import { formatPrice } from '../../lib/money';
import { supabase } from '../../lib/supabase';

const GOLD = '#B8860B';
const BLACK = '#1A1A18';
const DARK = '#2a2a2a';
const GREY = '#AAAAAA';
const GREEN = '#4fc96e';

// FIX (real bug — the share feature did not work at all outside the app):
// this used to share `imbizohub://seller?id=...`, a custom-scheme URL,
// inside a plain text message. WhatsApp, Facebook Messenger and SMS do
// not linkify custom schemes — the recipient saw an untappable grey
// string of text, and anyone without ImbizoHub installed had nothing to
// tap and nowhere to go. That defeated the entire purpose of this
// screen, which exists specifically to be shareable outside the app.
//
// Now shares a real https link. That link is handled three ways, in
// descending order of niceness, with no extra work from the sharer:
//
//   1. Recipient HAS the app -> iOS/Android intercept the URL at the OS
//      level (see associatedDomains / intentFilters in app.json plus
//      web/.well-known/) and open it straight to this screen.
//   2. Recipient does NOT have the app -> Vercel proxies /seller to the
//      seller-preview edge function, which server-renders a real page
//      with this seller's name, rating and photo in the Open Graph tags,
//      so the WhatsApp card shows an actual preview, and offers store
//      links plus a "view on the web" fallback.
//   3. Any scraper/bot -> gets the same server-rendered HTML, since it
//      is not a client-rendered React page.
//
// Query-param form (?id=) deliberately matches what this screen reads
// via useLocalSearchParams. Android's intent filter uses pathPrefix
// "/seller", which still matches — a query string is not part of the
// path — so no dynamic [id] route is needed.
const SHARE_BASE_URL = 'https://imbizohub.com/seller';

export default function SellerProfileScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();

  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [profile, setProfile] = useState<any>(null);
  const [listings, setListings] = useState<any[]>([]);
  // Only ratings that carry written text — see load().
  const [reviews, setReviews] = useState<any[]>([]);
  // Counts per star level, index 0 = 1★ … index 4 = 5★.
  const [starCounts, setStarCounts] = useState<number[]>([0, 0, 0, 0, 0]);
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

    // TWO queries now, because the old single one conflated two jobs
    // and did neither well.
    //
    // It fetched the 5 most recent ratings and listed them all. Most
    // ratings carry no written text, so a row read only "★★★★★ Buyer ·
    // 20 Aug" — five near-identical lines saying nothing a buyer can't
    // already read off the average at the top of the screen. At a
    // hundred ratings that becomes a hundred lines of the same
    // non-information, and the one thing a buyer actually wants to spot
    // — three 1-stars among ninety-seven 5-stars — is buried or pushed
    // off the bottom entirely.
    //
    // 1. Every rating's star value, for the distribution. One small
    //    integer column and no limit: the shape of someone's record is
    //    not something to sample. Worth moving to a server-side
    //    aggregate if a single seller ever passes a few thousand
    //    ratings; well below that the payload is trivial and this keeps
    //    the logic in one readable place.
    // role='buyer' means the REVIEWER was buying, so this person was the
    // seller or operator being rated. This page is a selling profile, so
    // ratings earned on the other side of a transaction — as a buyer or a
    // passenger — do not belong in it. Without this filter someone who has
    // only ever bought appears here with a full seller reputation.
    const { data: allStars } = await supabase
      .from('ratings')
      .select('stars')
      .eq('reviewee_id', id)
      .eq('role', 'buyer');

    const counts = [0, 0, 0, 0, 0];
    (allStars ?? []).forEach((r: any) => {
      const n = Math.round(r.stars);
      if (n >= 1 && n <= 5) counts[n - 1] += 1;
    });
    setStarCounts(counts);

    // 2. Only ratings that actually SAY something. A bare star is
    //    already fully represented in the distribution above, so
    //    repeating it as a row adds length without adding information.
    const { data: writtenReviews } = await supabase
      .from('ratings')
      .select('stars, review, role, created_at')
      .eq('reviewee_id', id)
      .eq('role', 'buyer')
      .not('review', 'is', null)
      .neq('review', '')
      .order('created_at', { ascending: false })
      .limit(5);

    setReviews(writtenReviews ?? []);
    setLoading(false);
  }

  async function handleShare() {
    if (!id || !profile) return;
    const name = profile.full_name || 'this seller';
    const ratingText = profile.rating_count > 0
      ? `${profile.rating.toFixed(1)}\u2605 (${profile.rating_count} reviews)`
      : 'a new seller';

    try {
      const url = `${SHARE_BASE_URL}?id=${encodeURIComponent(id)}`;
      await Share.share({
        // `url` is set separately as well as being in the message: iOS's
        // share sheet uses it to offer richer targets (and to render a
        // preview), while Android ignores it and only sends `message` \u2014
        // hence the link appearing in both.
        message: `Check out ${name} on ImbizoHub \u2014 ${ratingText}. ${url}`,
        url,
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
          <Text style={styles.backBtnCenteredText}><Text style={styles.backArrow}>‹</Text> Back to home</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const totalRatings = starCounts.reduce((a, b) => a + b, 0);

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.topRow}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
            <Text style={styles.backText}><Text style={styles.backArrow}>‹</Text> Back</Text>
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
                  <Text style={styles.listingPrice}>${formatPrice(l.price)}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        )}

        {/* THE DISTRIBUTION — one block, same height whether this seller
            has five ratings or five thousand.

            One hue for all five bars, not five colours. Every bar
            measures the same thing (how many people gave that score), so
            this is a magnitude comparison, not five categories. Colouring
            5★ green and 1★ red would also quietly editorialise: the star
            label already carries that meaning, and a 1★ is a legitimate
            data point, not an error state.

            Bar length is the true proportion of the total, with a small
            floor so a single 1★ among a hundred 5★ is still a visible
            mark rather than nothing. The exact count sits beside it
            either way — the number is the precise value, the bar is only
            the shape. */}
        {totalRatings > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Ratings</Text>
            <View style={styles.breakdownBox}>
              {[5, 4, 3, 2, 1].map((level) => {
                const n = starCounts[level - 1];
                const pct = totalRatings > 0 ? (n / totalRatings) * 100 : 0;
                return (
                  <View key={level} style={styles.breakdownRow}>
                    <Text style={styles.breakdownLabel}>{level}★</Text>
                    <View style={styles.breakdownTrack}>
                      {n > 0 && (
                        <View style={[styles.breakdownFill, { width: `${Math.max(pct, 2)}%` }]} />
                      )}
                    </View>
                    <Text style={styles.breakdownCount}>{n}</Text>
                  </View>
                );
              })}
            </View>
          </View>
        )}

        {/* Only ratings with words. A bare star is already counted above;
            listing it again is length without information. */}
        {reviews.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>
              What people said {reviews.length > 0 ? `(${reviews.length})` : ''}
            </Text>
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
  // NEW: bigger than the label text so the '‹' glyph reads clearly — direct product decision ("back symbol too small").
  backArrow: { fontSize: 20 },
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

  breakdownBox: { backgroundColor: BLACK, borderRadius: 12, padding: 14, borderWidth: 0.5, borderColor: '#333' },
  breakdownRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 8 },
  breakdownLabel: { width: 28, fontSize: 12, color: GREY },
  // The track is the recessive element: it shows the full width a bar
  // COULD reach, so a short bar reads as short rather than as missing.
  breakdownTrack: { flex: 1, height: 8, backgroundColor: '#2a2a2a', borderRadius: 4, overflow: 'hidden', marginHorizontal: 8 },
  breakdownFill: { height: 8, backgroundColor: GOLD, borderRadius: 4 },
  breakdownCount: { width: 34, fontSize: 12, color: '#ccc', textAlign: 'right' },
  reviewItem: { backgroundColor: BLACK, borderRadius: 12, padding: 14, marginBottom: 10, borderWidth: 0.5, borderColor: '#333' },
  reviewHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 },
  reviewMeta: { fontSize: 11, color: GREY },
  reviewText: { fontSize: 13, color: '#ccc', lineHeight: 19 },

  emptyBox: { backgroundColor: BLACK, borderRadius: 14, padding: 28, alignItems: 'center', borderWidth: 0.5, borderColor: '#333' },
  emptyText: { color: GREY, fontSize: 13 },
});
