import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, KeyboardAvoidingView, Platform, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import BottomNav from '../../components/BottomNav';
import { buildListingHref } from '../../lib/listingNav';
import { useIsDesktopWeb } from '../../lib/responsive';
import { supabase } from '../../lib/supabase';

const GOLD = '#B8860B';
const BLACK = '#1A1A18';
const DARK = '#2a2a2a';
const GREY = '#AAAAAA';

// NEW: real pagination, matching the same fix applied to index.tsx.
// Previously this screen loaded EVERY active listing into memory, then
// filtered search/category CLIENT-SIDE against that unbounded array —
// which also meant search only ever searched whatever happened to
// already be loaded. Now search and category both query the server
// directly, with their own pagination reset to page 0 each time either
// changes — so search actually searches the full catalog, not just
// what was previously fetched.
const PAGE_SIZE = 20;

// NEW: how long to wait after the user stops typing before actually
// querying the server. Without this, every keystroke would fire its
// own request — wasteful, and results would flicker as slower earlier
// requests occasionally resolve after faster later ones.
const SEARCH_DEBOUNCE_MS = 350;

const categories = [
  { icon: '📱', label: 'Phones' },
  { icon: '🚗', label: 'Vehicles' },
  { icon: '🪑', label: 'Furniture' },
  { icon: '👕', label: 'Clothing' },
  { icon: '🏠', label: 'Appliances' },
  { icon: '🧱', label: 'Building' },
  { icon: '🧸', label: 'Baby' },
  { icon: '📦', label: 'Other' },
];

export default function ExploreScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  // FIX (desktop redesign): same reasoning as index.tsx's Home grid —
  // more columns on a wide desktop frame instead of staying stuck at a
  // phone-style 2 columns. FlatList needs remounting (the key prop
  // below) whenever numColumns changes.
  const isDesktopWeb = useIsDesktopWeb();
  const numColumns = isDesktopWeb ? 4 : 2;
  const [listings, setListings] = useState<any[]>([]);
  const [totalCount, setTotalCount] = useState<number | null>(null);
  const [search, setSearch] = useState('');
  // NEW: the actual value queries run against, updated only after the
  // debounce delay — `search` itself updates on every keystroke (so the
  // input feels instant), `debouncedSearch` is what triggers a fetch.
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [showDashboardTab, setShowDashboardTab] = useState(false);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    loadUserRole();
  }, []);

  // Debounce: waits SEARCH_DEBOUNCE_MS after the last keystroke before
  // committing `search` into `debouncedSearch`.
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setDebouncedSearch(search);
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [search]);

  // Re-fetch from page 0 whenever the actual query criteria change —
  // either the debounced search text or the selected category.
  useEffect(() => {
    fetchPage(0, false);
  }, [debouncedSearch, selectedCategory]);

  const fetchPage = async (page: number, append: boolean) => {
    if (append) setLoadingMore(true);
    else setLoading(true);

    const from = page * PAGE_SIZE;
    const to = from + PAGE_SIZE - 1;

    let query = supabase
      .from('listings')
      .select('*', { count: 'exact' })
      .eq('status', 'active');

    if (debouncedSearch) {
      // Matches the original behavior: title OR location containing the
      // search text, case-insensitive.
      const term = debouncedSearch.replace(/[%_]/g, '');
      query = query.or(`title.ilike.%${term}%,location.ilike.%${term}%`);
    }

    if (selectedCategory) {
      // ilike with no wildcards is a case-insensitive exact match —
      // matches the original's .toLowerCase() === .toLowerCase() check.
      query = query.ilike('category', selectedCategory);
    }

    const { data, count, error } = await query
      .order('created_at', { ascending: false })
      .range(from, to);

    if (error) {
      console.log('explore fetchPage error:', error.message);
      setLoading(false);
      setLoadingMore(false);
      return;
    }

    if (data) {
      setHasMore(data.length === PAGE_SIZE);
      if (typeof count === 'number') setTotalCount(count);

      if (data.length > 0) {
        const userIds = [...new Set(data.map((l: any) => l.user_id).filter(Boolean))];
        let proIds = new Set<string>();
        if (userIds.length > 0) {
          const { data: proProfiles } = await supabase
            .from('profiles')
            .select('id, dealer_pro_active, dealer_pro_expires_at')
            .in('id', userIds);

          proIds = new Set(
            (proProfiles ?? [])
              .filter((p: any) =>
                p.dealer_pro_active &&
                p.dealer_pro_expires_at &&
                new Date(p.dealer_pro_expires_at).getTime() > Date.now()
              )
              .map((p: any) => p.id)
          );
        }

        // NOTE: Pro-seller sorting is now applied PER PAGE rather than
        // across the entire result set — an honest tradeoff of moving to
        // server-side pagination. A Pro seller's listing on page 2 still
        // won't outrank a non-Pro listing already shown on page 1. True
        // global priority-placement ordering would need a dedicated
        // sort key on the listings table itself (e.g. a computed
        // "is_seller_pro" column kept in sync), which is a bigger change
        // than this pagination fix — worth doing separately if "priority
        // placement" needs to be a harder guarantee than "ranks first
        // within whichever page it lands on."
        const sortedPage = [...data].sort((a: any, b: any) => {
          const aPro = proIds.has(a.user_id) ? 1 : 0;
          const bPro = proIds.has(b.user_id) ? 1 : 0;
          return bPro - aPro;
        });

        // FIX (dead state removed, found during a thorough review):
        // this used to also do
        // `setProSellerIds((prev) => new Set([...prev, ...proIds]))` —
        // accumulating a Set that was never actually read anywhere else
        // in the file. The real sort above already correctly uses the
        // LOCAL proIds from this specific page fetch; the accumulated
        // state variable was pure overhead with no consumer. Confirmed
        // genuinely unused before removing, not just unused right now.
        setListings((prev) => (append ? [...prev, ...sortedPage] : sortedPage));
      } else {
        setListings((prev) => (append ? prev : []));
      }
    }

    setLoading(false);
    setLoadingMore(false);
  };

  const loadMore = useCallback(() => {
    if (loadingMore || !hasMore || loading) return;
    const nextPage = Math.floor(listings.length / PAGE_SIZE);
    fetchPage(nextPage, true);
  }, [loadingMore, hasMore, loading, listings.length, debouncedSearch, selectedCategory]);

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

  function ListHeader() {
    return (
      <View>
        <View style={styles.searchBar}>
          <Text style={styles.searchIcon}>🔍</Text>
          <TextInput
            style={styles.searchInput}
            placeholder="Search listings..."
            placeholderTextColor={GREY}
            value={search}
            onChangeText={setSearch}
          />
          {search ? (
            <TouchableOpacity onPress={() => setSearch('')}>
              <Text style={{ color: GREY, fontSize: 16 }}>✕</Text>
            </TouchableOpacity>
          ) : null}
        </View>

        <Text style={styles.sectionTitle}>Categories</Text>
        <View style={styles.catGrid}>
          {categories.map((cat, i) => (
            <TouchableOpacity
              key={i}
              style={[styles.catItem, selectedCategory === cat.label && styles.catItemActive]}
              onPress={() => setSelectedCategory(selectedCategory === cat.label ? '' : cat.label)}
            >
              <Text style={styles.catIcon}>{cat.icon}</Text>
              <Text style={[styles.catLabel, selectedCategory === cat.label && styles.catLabelActive]} numberOfLines={1}>{cat.label}</Text>
            </TouchableOpacity>
          ))}
        </View>

        <Text style={styles.sectionTitle}>
          {selectedCategory
            ? `${selectedCategory} (${totalCount ?? listings.length})`
            : `All Listings (${totalCount ?? listings.length})`}
        </Text>
      </View>
    );
  }

  function ListFooter() {
    if (!loadingMore) return <View style={{ height: 80 + insets.bottom }} />;
    return (
      <View>
        <ActivityIndicator color={GOLD} style={{ marginVertical: 16 }} />
        <View style={{ height: 80 + insets.bottom }} />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Browse</Text>
      </View>

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <FlatList
          key={numColumns}
          data={listings}
          keyExtractor={(item) => String(item.id)}
          numColumns={numColumns}
          columnWrapperStyle={styles.listingRow}
          contentContainerStyle={styles.listingGridContainer}
          keyboardShouldPersistTaps="handled"
          ListHeaderComponent={ListHeader}
          ListFooterComponent={ListFooter}
          onEndReached={loadMore}
          onEndReachedThreshold={0.5}
          ListEmptyComponent={
            loading ? (
              <ActivityIndicator color={GOLD} style={{ marginTop: 20 }} />
            ) : (
              <Text style={{ color: GREY, textAlign: 'center', marginTop: 20 }}>No listings found</Text>
            )
          }
          renderItem={({ item }) => (
            <TouchableOpacity
              style={styles.listingCard}
              // NEW: hands this grid's own current id order along so the
              // listing detail screen can swipe through the SAME set
              // (respecting whatever search/category is active here),
              // not a generic unrelated feed. See lib/listingNav.ts.
              onPress={() => router.push(buildListingHref(item.id, listings.map((l) => l.id)))}
            >
              {item.image_url ? (
                <Image source={{ uri: item.image_url }} style={[styles.listingImg, isDesktopWeb && styles.listingImgDesktop]} contentFit="cover" />
              ) : (
                // FIX: same gap as index.tsx — a listing with no photo
                // used to render as a bare, unlabeled dark box. Mirrors
                // listing.tsx's detail-page "No photos yet" placeholder.
                <View style={[styles.listingImg, isDesktopWeb && styles.listingImgDesktop, styles.listingImgPlaceholder]}>
                  <Text style={styles.listingImgPlaceholderText}>📦</Text>
                </View>
              )}
              <View style={styles.listingBody}>
                <Text style={styles.listingTitle}>{item.title}</Text>
                <Text style={styles.listingPrice}>${item.price}</Text>
                <View style={styles.listingMeta}>
                  <Text style={styles.listingLoc}>{item.location}</Text>
                  {item.badge ? (
                    <View style={item.badge === 'Verified' ? styles.badgeVerified : styles.badgeDealer}>
                      <Text style={item.badge === 'Verified' ? styles.badgeVerifiedText : styles.badgeDealerText}>{item.badge}</Text>
                    </View>
                  ) : null}
                </View>
              </View>
            </TouchableOpacity>
          )}
        />
      </KeyboardAvoidingView>

      <BottomNav active="browse" showDashboardTab={showDashboardTab} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: BLACK },
  header: { paddingHorizontal: 16, paddingTop: 50, paddingBottom: 10 },
  headerTitle: { color: '#fff', fontSize: 22, fontWeight: '700' },
  searchBar: { flexDirection: 'row', alignItems: 'center', backgroundColor: DARK, borderRadius: 12, marginHorizontal: 16, marginBottom: 16, paddingHorizontal: 12, paddingVertical: 10 },
  searchIcon: { fontSize: 16, marginRight: 8 },
  searchInput: { flex: 1, color: '#fff', fontSize: 13 },
  sectionTitle: { color: '#fff', fontSize: 13, fontWeight: '700', paddingHorizontal: 16, marginBottom: 10 },
  catGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingHorizontal: 16, marginBottom: 20 },
  // FIX: identical "Appliances" wrap fixed in index.tsx's copy of this
  // same grid — see the fuller comment there. Padding is vertical-only
  // so the label gets the tile's full width; numberOfLines={1} at the
  // call site backstops it on narrower devices.
  catItem: { backgroundColor: DARK, borderRadius: 10, paddingVertical: 10, paddingHorizontal: 2, width: '22%', alignItems: 'center', borderWidth: 0.5, borderColor: '#333' },
  catItemActive: { borderColor: GOLD },
  catIcon: { fontSize: 20, marginBottom: 4 },
  catLabel: { color: '#ccc', fontSize: 10 },
  catLabelActive: { color: GOLD },
  // FIX (same bug class already caught in my-wanted-posts.tsx /
  // browse-wanted.tsx): the vertical `gap: 10` on this FlatList's
  // contentContainerStyle (row-to-row spacing) is the same unreliable
  // pattern already fixed elsewhere — replaced with marginBottom on
  // the card itself. listingRow's `gap: 10` is untouched: that's a
  // normal flexDirection row View (columnWrapperStyle, not the
  // contentContainer), where gap has always been reliable.
  listingGridContainer: { paddingHorizontal: 16 },
  listingRow: { gap: 10 },
  listingCard: { backgroundColor: '#222', borderRadius: 12, overflow: 'hidden', flex: 1, marginBottom: 10 },
  listingImg: { height: 120, width: '100%' },
  // Same reasoning as index.tsx's listingImgDesktop — wider desktop
  // cards need a taller image to avoid looking letterboxed.
  listingImgDesktop: { height: 170 },
  listingImgPlaceholder: { backgroundColor: DARK, alignItems: 'center', justifyContent: 'center' },
  listingImgPlaceholderText: { fontSize: 28, opacity: 0.5 },
  listingBody: { padding: 8 },
  listingTitle: { color: '#fff', fontSize: 12, fontWeight: '700', marginBottom: 2 },
  listingPrice: { color: GOLD, fontSize: 13, fontWeight: '800', marginBottom: 4 },
  listingMeta: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  listingLoc: { color: GREY, fontSize: 10 },
  badgeVerified: { backgroundColor: '#1a3a1a', borderRadius: 4, paddingHorizontal: 5, paddingVertical: 2 },
  badgeVerifiedText: { color: '#4A90D9', fontSize: 9 },
  badgeDealer: { backgroundColor: '#3a2800', borderRadius: 4, paddingHorizontal: 5, paddingVertical: 2 },
  badgeDealerText: { color: GOLD, fontSize: 9 },
});
