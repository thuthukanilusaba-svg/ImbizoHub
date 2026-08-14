import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import BottomNav from '../../components/BottomNav';
import { useIsDesktopWeb } from '../../lib/responsive';
import { supabase } from '../../lib/supabase';

const GOLD = '#B8860B';
const BLACK = '#1A1A18';
const DARK = '#2a2a2a';
const GREY = '#AAAAAA';

const PAGE_SIZE = 20;

const categories = [
  { icon: '📱', label: 'Phones' },
  { icon: '🚗', label: 'Vehicles' },
  { icon: '🛋️', label: 'Furniture' },
  { icon: '👕', label: 'Clothing' },
  { icon: '🏠', label: 'Appliances' },
  { icon: '🧱', label: 'Building' },
  { icon: '👶', label: 'Baby' },
  { icon: '⋯', label: 'More' },
];

function getInitials(name: string): string {
  if (!name) return '👤';
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function getGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

export default function HomeScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  // FIX (desktop redesign): the listing grid was a fixed 2 columns
  // everywhere, which looks fine at phone width but leaves a wide
  // desktop frame (see _layout.tsx's DESKTOP_MAX_WIDTH) looking sparse
  // — two oversized cards with empty space around them rather than an
  // actual grid. FlatList requires remounting (via the key prop below)
  // whenever numColumns changes, since it precomputes row layout from
  // that number — this is the standard/documented way to change it at
  // runtime.
  const isDesktopWeb = useIsDesktopWeb();
  const numColumns = isDesktopWeb ? 4 : 2;

  const [listings, setListings] = useState<any[]>([]);
  const [sellerProfiles, setSellerProfiles] = useState<Record<string, any>>({});
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [userName, setUserName] = useState('');
  const [showDashboardTab, setShowDashboardTab] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [featuredListing, setFeaturedListing] = useState<any>(null);

  useEffect(() => {
    loadUser();
    fetchListings(0, false);
    fetchFeaturedListing();
  }, []);

  async function loadUser() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const { data: profile } = await supabase
      .from('profiles')
      .select('full_name, is_admin')
      .eq('id', user.id)
      .maybeSingle();

    if (profile?.full_name) {
      setUserName(profile.full_name.split(' ')[0]);
    }

    setIsAdmin(!!profile?.is_admin);

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

  // FIX (real bug, found during a thorough review): the featured
  // listing used to be derived by filtering whatever happened to be in
  // page 0 of the general chronological feed — meaning a genuinely
  // active featured listing (someone paid, or used the free promo,
  // specifically for prominent Home placement) would silently stop
  // appearing here the moment 20+ newer listings got posted, even
  // though featured_until was still in the future. That defeats the
  // entire point of the feature — "Featured" is supposed to mean
  // prominent regardless of recency, not "prominent only if also
  // coincidentally recent." Now a real, dedicated query, completely
  // independent of the general feed's pagination.
  async function fetchFeaturedListing() {
    const { data } = await supabase
      .from('listings')
      .select('*')
      .eq('status', 'active')
      .gt('featured_until', new Date().toISOString())
      .order('featured_until', { ascending: false })
      .limit(1)
      .maybeSingle();

    setFeaturedListing(data ?? null);
  }

  const fetchListings = async (page: number, append: boolean) => {
    if (append) setLoadingMore(true);

    const from = page * PAGE_SIZE;
    const to = from + PAGE_SIZE - 1;

    const { data } = await supabase
      .from('listings')
      .select('*')
      .eq('status', 'active')
      .order('created_at', { ascending: false })
      .range(from, to);

    if (data) {
      setHasMore(data.length === PAGE_SIZE);
      setListings((prev) => (append ? [...prev, ...data] : data));

      if (data.length > 0) {
        const userIds = [...new Set(data.map((l: any) => l.user_id).filter(Boolean))];
        const { data: profiles } = await supabase
          .from('profiles')
          .select('id, rating, rating_count, full_name, is_verified, verified_expires_at')
          .in('id', userIds);

        if (profiles) {
          const profileMap: Record<string, any> = {};
          profiles.forEach((p: any) => { profileMap[p.id] = p; });
          setSellerProfiles((prev) => ({ ...prev, ...profileMap }));
        }
      }
    }

    setLoading(false);
    setLoadingMore(false);
  };

  const loadMore = useCallback(() => {
    if (loadingMore || !hasMore || loading) return;
    const nextPage = Math.floor(listings.length / PAGE_SIZE);
    fetchListings(nextPage, true);
  }, [loadingMore, hasMore, loading, listings.length]);

  function isSellerVerified(userId: string): boolean {
    const p = sellerProfiles[userId];
    return !!(p?.is_verified && p?.verified_expires_at && new Date(p.verified_expires_at).getTime() > Date.now());
  }

  function renderStarRating(rating: number, count: number) {
    if (!count || count === 0) return null;
    const fullStars = Math.round(rating);
    const stars = '★'.repeat(fullStars) + '☆'.repeat(5 - fullStars);
    return (
      <View style={styles.starRow}>
        <Text style={styles.starText}>{stars}</Text>
        <Text style={styles.starCount}>({count})</Text>
      </View>
    );
  }

  function ListHeader() {
    return (
      <View>
        <View style={styles.header}>
          <View>
            <View style={styles.logoRow}>
              <View style={styles.logoIcon}>
                <Text style={styles.logoLetter}>I</Text>
              </View>
              <Text style={styles.logoText}>
                Imbizo<Text style={styles.logoGold}>Hub</Text>
              </Text>
            </View>
            <Text style={styles.greeting}>
              {userName ? `${getGreeting()}, ${userName}` : getGreeting()}
            </Text>
          </View>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>{getInitials(userName)}</Text>
          </View>
        </View>

        <View style={styles.searchWrap}>
          <TouchableOpacity style={styles.searchBar} onPress={() => router.push('/explore')}>
            <Text style={styles.searchIcon}>🔍</Text>
            <Text style={styles.searchPlaceholder}>Search phones, cars, furniture...</Text>
          </TouchableOpacity>
        </View>

        <TouchableOpacity
          style={styles.wantedBanner}
          onPress={() => router.push('/post-wanted')}
          activeOpacity={0.85}
        >
          <View style={styles.vanBannerLeft}>
            <Text style={styles.vanBannerEmoji}>🔍</Text>
            <View style={styles.vanBannerTextCol}>
              <Text style={styles.vanBannerTitle}>Looking for something specific?</Text>
              <Text style={styles.vanBannerSub}>Post it — sellers respond with a price</Text>
            </View>
          </View>
          <Text style={styles.vanBannerArrow}>›</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.browseWantedBanner}
          onPress={() => router.push('/browse-wanted')}
          activeOpacity={0.85}
        >
          <View style={styles.vanBannerLeft}>
            <Text style={styles.vanBannerEmoji}>🛍️</Text>
            <View style={styles.vanBannerTextCol}>
              <Text style={styles.vanBannerTitle}>See what people want</Text>
              <Text style={styles.vanBannerSub}>Browse open wants — respond with your price, free</Text>
            </View>
          </View>
          <Text style={styles.vanBannerArrow}>›</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.whatsappBanner}
          onPress={() => router.push('/whatsapp-import')}
          activeOpacity={0.85}
        >
          <View style={styles.vanBannerLeft}>
            <Text style={styles.vanBannerEmoji}>💬</Text>
            <View style={styles.vanBannerTextCol}>
              <Text style={styles.vanBannerTitle}>Selling on WhatsApp?</Text>
              <Text style={styles.vanBannerSub}>Paste your whole catalog — import it all at once</Text>
            </View>
          </View>
          <Text style={styles.vanBannerArrow}>›</Text>
        </TouchableOpacity>

        <View style={styles.trustSection}>
          <Text style={styles.trustTitle}>How ImbizoHub keeps you safe</Text>
          <View style={styles.trustRow}>
            <Text style={styles.trustIcon}>🔐</Text>
            <View style={{ flex: 1 }}>
              <Text style={styles.trustItemTitle}>PIN-confirmed handovers</Text>
              <Text style={styles.trustItemSub}>Nothing's marked complete until both sides confirm, in person, with a one-time PIN</Text>
            </View>
          </View>
          <View style={styles.trustRow}>
            <Text style={styles.trustIcon}>🪪</Text>
            <View style={{ flex: 1 }}>
              <Text style={styles.trustItemTitle}>ID-verified delivery operators</Text>
              <Text style={styles.trustItemSub}>Drivers submit real identification before they can accept delivery jobs</Text>
            </View>
          </View>
          <View style={styles.trustRow}>
            <Text style={styles.trustIcon}>⭐</Text>
            <View style={{ flex: 1 }}>
              <Text style={styles.trustItemTitle}>Real ratings only</Text>
              <Text style={styles.trustItemSub}>Reviews only come from confirmed transactions — never fake, never bought</Text>
            </View>
          </View>
        </View>

        {featuredListing && (
          <View style={styles.section}>
            <TouchableOpacity
              style={styles.featuredCard}
              onPress={() => router.push(`/listing?id=${featuredListing.id}`)}
              activeOpacity={0.85}
            >
              <View style={{ flex: 1 }}>
                <View style={styles.featuredBadge}>
                  <Text style={styles.featuredBadgeText}>FEATURED</Text>
                </View>
                <Text style={styles.featuredTitle} numberOfLines={1}>{featuredListing.title}</Text>
                <Text style={styles.featuredPrice}>${featuredListing.price}</Text>
                <Text style={styles.featuredLoc}>{featuredListing.location}</Text>
              </View>
              {featuredListing.image_url ? (
                <Image source={{ uri: featuredListing.image_url }} style={styles.featuredImg} contentFit="cover" />
              ) : (
                <View style={styles.featuredImg}>
                  <Text style={styles.featuredEmoji}>📦</Text>
                </View>
              )}
            </TouchableOpacity>
          </View>
        )}

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Browse categories</Text>
          <View style={styles.catGrid}>
            {categories.map((cat, i) => (
              <TouchableOpacity
                key={i}
                style={styles.catItem}
                onPress={() => router.push(
                  cat.label === 'More' ? '/explore' : `/explore?category=${encodeURIComponent(cat.label)}`
                )}
              >
                <Text style={styles.catIcon}>{cat.icon}</Text>
                <Text style={styles.catLabel}>{cat.label}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        <View style={[styles.section, { paddingBottom: 0 }]}>
          <View style={styles.sectionRow}>
            <Text style={styles.sectionTitle}>Recent listings</Text>
            <TouchableOpacity onPress={() => router.push('/explore')}>
              <Text style={styles.seeAll}>See all</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    );
  }

  function ListFooter() {
    return (
      <View>
        {loadingMore && (
          <ActivityIndicator color={GOLD} style={{ marginVertical: 16 }} />
        )}

        <View style={styles.section}>
          <TouchableOpacity
            style={styles.vanBanner}
            onPress={() => router.push('/hirevan')}
            activeOpacity={0.85}
          >
            <View style={styles.vanBannerLeft}>
              <Text style={styles.vanBannerEmoji}>🚐</Text>
              <View style={styles.vanBannerTextCol}>
                <Text style={styles.vanBannerTitle}>Hire Transport</Text>
                <Text style={styles.vanBannerSub}>Post a trip — operators bid for your job</Text>
              </View>
            </View>
            <Text style={styles.vanBannerArrow}>›</Text>
          </TouchableOpacity>
        </View>

        <View style={{ height: 80 + insets.bottom }} />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <StatusBar style="light" />

      <FlatList
        key={numColumns}
        data={listings}
        keyExtractor={(item) => String(item.id)}
        numColumns={numColumns}
        columnWrapperStyle={styles.listingRow}
        contentContainerStyle={styles.listingGridContainer}
        ListHeaderComponent={ListHeader}
        ListFooterComponent={ListFooter}
        onEndReached={loadMore}
        onEndReachedThreshold={0.5}
        ListEmptyComponent={
          loading ? (
            <ActivityIndicator color={GOLD} style={{ marginTop: 20 }} />
          ) : (
            <Text style={{ color: GREY, textAlign: 'center', marginTop: 20, paddingHorizontal: 16 }}>
              No listings yet.
            </Text>
          )
        }
        renderItem={({ item }) => {
          const seller = sellerProfiles[item.user_id];
          return (
            <TouchableOpacity
              style={styles.listingCard}
              onPress={() => router.push(`/listing?id=${item.id}`)}
            >
              {item.image_url ? (
                <Image
                  source={{ uri: item.image_url }}
                  style={[styles.listingImg, isDesktopWeb && styles.listingImgDesktop]}
                  contentFit="cover"
                />
              ) : (
                // FIX (real bug, found via a live screenshot): this used
                // to always render <Image source={{uri: item.image_url}}/>
                // with no fallback — a listing with no photo (image_url
                // null) rendered as a bare, unlabeled dark box, which on
                // the website looked exactly like something had broken.
                // Same gap on every platform (confirmed: the listing has
                // no photo on the phone app either), not a web-only
                // issue, so fixed here for both. Mirrors the "No photos
                // yet" placeholder listing.tsx's detail-page carousel
                // already shows for the same situation.
                <View style={[styles.listingImg, isDesktopWeb && styles.listingImgDesktop, styles.listingImgPlaceholder]}>
                  <Text style={styles.listingImgPlaceholderText}>📦</Text>
                </View>
              )}
              <View style={styles.listingBody}>
                <Text style={styles.listingTitle} numberOfLines={1}>{item.title}</Text>
                <Text style={styles.listingPrice}>${item.price}</Text>
                {seller && seller.rating_count > 0 && renderStarRating(seller.rating, seller.rating_count)}
                <View style={styles.listingMeta}>
                  <Text style={styles.listingLoc}>{item.location}</Text>
                  {isSellerVerified(item.user_id) ? (
                    <View style={styles.badgeVerified}>
                      <Text style={styles.badgeVerifiedText}>Verified</Text>
                    </View>
                  ) : item.badge && item.badge !== 'Verified' ? (
                    <View style={styles.badgeDealer}>
                      <Text style={styles.badgeDealerText}>{item.badge}</Text>
                    </View>
                  ) : null}
                </View>
              </View>
            </TouchableOpacity>
          );
        }}
      />

      <BottomNav active="home" showDashboardTab={showDashboardTab} isAdmin={isAdmin} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#111111' },
  header: { backgroundColor: BLACK, padding: 16, paddingTop: 50, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  logoRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  logoIcon: { width: 24, height: 24, backgroundColor: GOLD, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  logoLetter: { color: BLACK, fontSize: 11, fontWeight: '900' },
  logoText: { fontSize: 18, fontWeight: '800', color: '#fff' },
  logoGold: { color: GOLD },
  greeting: { color: GREY, fontSize: 12, marginTop: 2 },
  avatar: { width: 36, height: 36, backgroundColor: GOLD, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: BLACK, fontSize: 13, fontWeight: '700' },
  searchWrap: { backgroundColor: BLACK, paddingHorizontal: 16, paddingBottom: 14 },
  searchBar: { backgroundColor: DARK, borderRadius: 12, padding: 10, flexDirection: 'row', alignItems: 'center', gap: 10, borderWidth: 0.5, borderColor: '#333' },
  searchIcon: { fontSize: 16 },
  searchPlaceholder: { color: '#555', fontSize: 13 },
  vanBanner: { backgroundColor: '#1a1a2e', borderRadius: 14, marginHorizontal: 16, marginTop: 12, marginBottom: 4, paddingHorizontal: 18, paddingVertical: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderWidth: 0.5, borderColor: '#3a3a5e' },
  wantedBanner: { backgroundColor: '#1a2e1a', borderRadius: 14, marginHorizontal: 16, marginTop: 12, marginBottom: 4, paddingHorizontal: 18, paddingVertical: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderWidth: 0.5, borderColor: '#3a5e3a' },
  browseWantedBanner: { backgroundColor: '#2e2a1a', borderRadius: 14, marginHorizontal: 16, marginTop: 4, marginBottom: 4, paddingHorizontal: 18, paddingVertical: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderWidth: 0.5, borderColor: '#5e5a3a' },
  whatsappBanner: { backgroundColor: '#1a2e22', borderRadius: 14, marginHorizontal: 16, marginTop: 4, marginBottom: 4, paddingHorizontal: 18, paddingVertical: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderWidth: 0.5, borderColor: '#25D366' },
  trustSection: { backgroundColor: '#161616', borderRadius: 14, marginHorizontal: 16, marginTop: 12, marginBottom: 4, padding: 18, borderWidth: 0.5, borderColor: '#2a2a2a' },
  trustTitle: { color: '#fff', fontSize: 14, fontWeight: '700', marginBottom: 14 },
  trustRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, marginBottom: 14 },
  trustIcon: { fontSize: 20, marginTop: 1 },
  trustItemTitle: { color: '#fff', fontSize: 13, fontWeight: '600', marginBottom: 2 },
  trustItemSub: { color: '#999', fontSize: 11, lineHeight: 16 },
  vanBannerLeft: { flexDirection: 'row', alignItems: 'center', gap: 14, flex: 1, minWidth: 0 },
  vanBannerTextCol: { flex: 1, minWidth: 0 },
  vanBannerEmoji: { fontSize: 28 },
  vanBannerTitle: { color: '#ffffff', fontSize: 15, fontWeight: '700' },
  vanBannerSub: { color: '#8888aa', fontSize: 12, marginTop: 2 },
  vanBannerArrow: { color: GOLD, fontSize: 24, fontWeight: '300' },
  section: { backgroundColor: BLACK, paddingHorizontal: 16, paddingBottom: 14, marginTop: 10 },
  sectionTitle: { color: '#fff', fontSize: 13, fontWeight: '700', marginBottom: 10 },
  sectionRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  seeAll: { color: GOLD, fontSize: 11 },
  featuredCard: { backgroundColor: DARK, borderRadius: 14, padding: 16, borderWidth: 0.5, borderColor: GOLD, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  featuredBadge: { backgroundColor: GOLD, borderRadius: 20, paddingHorizontal: 8, paddingVertical: 2, marginBottom: 6, alignSelf: 'flex-start' },
  featuredBadgeText: { color: BLACK, fontSize: 10, fontWeight: '700' },
  featuredTitle: { color: '#fff', fontSize: 14, fontWeight: '700', marginBottom: 2 },
  featuredPrice: { color: GOLD, fontSize: 16, fontWeight: '800' },
  featuredLoc: { color: GREY, fontSize: 11, marginTop: 3 },
  featuredImg: { width: 80, height: 80, backgroundColor: '#333', borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  featuredEmoji: { fontSize: 32 },
  catGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  catItem: { backgroundColor: DARK, borderRadius: 10, padding: 10, width: '22%', alignItems: 'center', borderWidth: 0.5, borderColor: '#333' },
  catItemActive: { borderColor: GOLD },
  catIcon: { fontSize: 20, marginBottom: 4 },
  catLabel: { color: '#ccc', fontSize: 10 },
  catLabelActive: { color: GOLD },
  // FIX (same bug class already caught in my-wanted-posts.tsx /
  // browse-wanted.tsx): the vertical `gap: 8` on this FlatList's
  // contentContainerStyle (row-to-row spacing) is the same unreliable
  // pattern already fixed elsewhere — replaced with marginBottom on
  // the card itself. listingRow's `gap: 8` is untouched: that's a
  // normal flexDirection row View (columnWrapperStyle, not the
  // contentContainer), where gap has always been reliable.
  listingGridContainer: { paddingHorizontal: 16 },
  listingRow: { gap: 8 },
  listingCard: { backgroundColor: '#222', borderRadius: 12, overflow: 'hidden', borderWidth: 0.5, borderColor: '#333', flex: 1, marginBottom: 8 },
  listingImg: { height: 120, width: '100%' },
  // Desktop cards are wider (4 columns of a ~1200px frame vs 2 of a
  // ~480px one), so the same 120px height would look squashed/
  // letterboxed relative to the extra width — taller keeps the photo
  // looking proportioned instead of like a thin strip.
  listingImgDesktop: { height: 170 },
  listingImgPlaceholder: { backgroundColor: DARK, alignItems: 'center', justifyContent: 'center' },
  listingImgPlaceholderText: { fontSize: 28, opacity: 0.5 },
  listingBody: { padding: 8 },
  listingTitle: { color: '#fff', fontSize: 12, fontWeight: '700', marginBottom: 2 },
  listingPrice: { color: GOLD, fontSize: 13, fontWeight: '800', marginBottom: 3 },
  starRow: { flexDirection: 'row', alignItems: 'center', gap: 3, marginBottom: 3 },
  starText: { fontSize: 10, color: GOLD },
  starCount: { fontSize: 9, color: GREY },
  listingMeta: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  listingLoc: { color: GREY, fontSize: 10 },
  badgeVerified: { backgroundColor: '#1a3a1a', borderRadius: 4, paddingHorizontal: 5, paddingVertical: 2 },
  badgeVerifiedText: { color: '#4A90D9', fontSize: 9 },
  badgeDealer: { backgroundColor: '#3a2800', borderRadius: 4, paddingHorizontal: 5, paddingVertical: 2 },
  badgeDealerText: { color: GOLD, fontSize: 9 },
});
