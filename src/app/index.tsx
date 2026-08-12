import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { supabase } from '../../lib/supabase';

const GOLD = '#B8860B';
const BLACK = '#1A1A18';
const DARK = '#2a2a2a';
const GREY = '#AAAAAA';

// NEW: real pagination. Previously fetchListings() had no .range()/
// .limit() at all — it pulled EVERY active listing in the entire
// database, every single time this screen loaded, regardless of how
// many existed. Fine with a handful of test listings; genuinely
// unworkable once the marketplace has hundreds or thousands — slower
// loads, more data used per visit, and a huge grid rendered all at once
// getting laggy to scroll. PAGE_SIZE of 20 matches what most real
// marketplace apps use as a first-batch size.
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

    // UPDATED (product decision): was account_type === 'seller' — a
    // self-declared label from registration that never actually gated
    // anything (post.tsx never checked it; anyone could post
    // regardless). Now driven by something real: has this person
    // actually posted at least one listing. head:true + count:'exact'
    // gets just the count without pulling any row data — cheap check.
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

      if (page === 0) {
        const activeFeatured = (data as any[])
          .filter((l) => l.featured_until && new Date(l.featured_until).getTime() > Date.now())
          .sort((a, b) => new Date(b.featured_until).getTime() - new Date(a.featured_until).getTime());
        setFeaturedListing(activeFeatured[0] ?? null);
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

        {/* NEW: closes a real navigation gap — there was previously NO
            link anywhere in the app to browse-wanted.tsx (the screen
            where sellers see and respond to everyone's posted wants).
            The banner above only ever linked to POSTING a want; nothing
            linked to BROWSING them. browse-wanted.tsx itself was
            completely fine — it just had zero discoverable entry point,
            which is exactly why posted wants seemed to "not show up
            anywhere": there was nowhere to go look for them. */}
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

        {/* NEW: real, prominent entry point for WhatsApp import —
            leaning harder into this specifically because it's the
            strongest acquisition wedge available (meets sellers where
            they already sell, rather than asking them to start from
            zero). Previously the ONLY way to find this screen was a
            small link buried inside post.tsx, easy to miss entirely if
            someone never opens the regular listing form first. Styled
            with WhatsApp's own recognizable green for instant
            recognition, distinct from the gold/green-tinted Wanted
            banners above. */}
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
        data={listings}
        keyExtractor={(item) => String(item.id)}
        numColumns={2}
        columnWrapperStyle={styles.listingRow}
        contentContainerStyle={styles.listingGridContainer}
        showsVerticalScrollIndicator={false}
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
              <Image
                source={{ uri: item.image_url }}
                style={styles.listingImg}
                contentFit="cover"
              />
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

      <View style={[styles.bottomNav, { paddingBottom: 24 + insets.bottom }]}>
        <TouchableOpacity style={styles.navItem} onPress={() => router.push('/')}>
          <Text style={styles.navIconActive}>🏠</Text>
          <Text style={styles.navLabelActive}>Home</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.navItem} onPress={() => router.push('/explore')}>
          <Text style={styles.navIcon}>🔍</Text>
          <Text style={styles.navLabel}>Browse</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.navPost} onPress={() => router.push('/post')}>
          <Text style={styles.navPostText}>+</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.navItem} onPress={() => router.push('/messages')}>
          <Text style={styles.navIcon}>💬</Text>
          <Text style={styles.navLabel}>Messages</Text>
        </TouchableOpacity>
        {showDashboardTab && (
          <TouchableOpacity style={styles.navItem} onPress={() => router.push('/dealer')}>
            <Text style={styles.navIcon}>🏪</Text>
            <Text style={styles.navLabel}>Dashboard</Text>
          </TouchableOpacity>
        )}
        {isAdmin && (
          <TouchableOpacity style={styles.navItem} onPress={() => router.push('/admin-verification-review')}>
            <Text style={styles.navIcon}>🛡️</Text>
            <Text style={styles.navLabel}>Admin</Text>
          </TouchableOpacity>
        )}
        <TouchableOpacity style={styles.navItem} onPress={() => router.push('/profile')}>
          <Text style={styles.navIcon}>👤</Text>
          <Text style={styles.navLabel}>Profile</Text>
        </TouchableOpacity>
      </View>
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
  // NEW: styled distinctly from wantedBanner (posting) so the two don't
  // read as duplicates — same shape/spacing, different color family
  // (gold-tinted, matching the app's primary accent) since this is the
  // BROWSE counterpart, not another "post" action.
  browseWantedBanner: { backgroundColor: '#2e2a1a', borderRadius: 14, marginHorizontal: 16, marginTop: 4, marginBottom: 4, paddingHorizontal: 18, paddingVertical: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderWidth: 0.5, borderColor: '#5e5a3a' },
  // NEW: WhatsApp's own recognizable green (#25D366-derived dark tint,
  // matching the same dark-tinted-background treatment as the other
  // two banners) — instant visual recognition for exactly the seller
  // this banner is trying to reach.
  whatsappBanner: { backgroundColor: '#1a2e22', borderRadius: 14, marginHorizontal: 16, marginTop: 4, marginBottom: 4, paddingHorizontal: 18, paddingVertical: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderWidth: 0.5, borderColor: '#25D366' },
  vanBannerLeft: { flexDirection: 'row', alignItems: 'center', gap: 14, flex: 1, minWidth: 0 },
  // NEW: fixes a real overflow bug — this View wrapping the title+
  // subtitle text previously had no style at all, so it took its
  // natural content width instead of wrapping within the banner's
  // actual available space. Long subtitle text (e.g. "Browse open
  // wants — respond with your price, free") ran past the rounded box
  // edge instead of wrapping to a second line. flex: 1 lets it claim
  // the remaining row space after the emoji/gap/arrow; minWidth: 0 is
  // the actual fix — without it, flexbox still lets content dictate a
  // wider-than-container intrinsic size regardless of flex: 1.
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
  listingGridContainer: { paddingHorizontal: 16, gap: 8 },
  listingRow: { gap: 8 },
  listingCard: { backgroundColor: '#222', borderRadius: 12, overflow: 'hidden', borderWidth: 0.5, borderColor: '#333', flex: 1 },
  listingImg: { height: 120, width: '100%' },
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
  bottomNav: { position: 'absolute', bottom: 0, left: 0, right: 0, backgroundColor: BLACK, borderTopWidth: 0.5, borderTopColor: DARK, paddingVertical: 10, flexDirection: 'row', justifyContent: 'space-around', alignItems: 'center' },
  navItem: { alignItems: 'center' },
  navIcon: { fontSize: 22, color: '#555' },
  navIconActive: { fontSize: 22, color: GOLD },
  navLabel: { fontSize: 9, color: '#555', marginTop: 2 },
  navLabelActive: { fontSize: 9, color: GOLD, marginTop: 2 },
  navPost: { width: 44, height: 44, backgroundColor: GOLD, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  navPostText: { color: BLACK, fontSize: 24, fontWeight: '700', lineHeight: 28 },
});
