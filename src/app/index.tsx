import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { supabase } from '../../lib/supabase';

const GOLD = '#B8860B';
const BLACK = '#1A1A18';
const DARK = '#2a2a2a';
const GREY = '#AAAAAA';

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

export default function HomeScreen() {
  const router = useRouter();
  const [listings, setListings] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session) router.replace('/login');
    });
    fetchListings();
  }, []);

  const fetchListings = async () => {
    const { data } = await supabase
      .from('listings')
      .select('*')
      .order('created_at', { ascending: false });
    if (data) setListings(data);
    setLoading(false);
  };

  return (
    <View style={styles.container}>
      <StatusBar style="light" />
      <ScrollView showsVerticalScrollIndicator={false}>

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
            <Text style={styles.greeting}>Good morning, Tatenda</Text>
          </View>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>TM</Text>
          </View>
        </View>

        <View style={styles.searchWrap}>
          <View style={styles.searchBar}>
            <Text style={styles.searchIcon}>🔍</Text>
            <Text style={styles.searchPlaceholder}>Search phones, cars, furniture...</Text>
          </View>
        </View>

        <View style={styles.section}>
          <View style={styles.featuredCard}>
            <View>
              <View style={styles.featuredBadge}>
                <Text style={styles.featuredBadgeText}>FEATURED</Text>
              </View>
              <Text style={styles.featuredTitle}>iPhone 13 Pro</Text>
              <Text style={styles.featuredPrice}>$320</Text>
              <Text style={styles.featuredLoc}>Harare · Meet & Pay</Text>
            </View>
            <View style={styles.featuredImg}>
              <Text style={styles.featuredEmoji}>📱</Text>
            </View>
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Browse categories</Text>
          <View style={styles.catGrid}>
            {categories.map((cat, i) => (
              <TouchableOpacity key={i} style={[styles.catItem, i === 7 && styles.catItemActive]}>
                <Text style={styles.catIcon}>{cat.icon}</Text>
                <Text style={[styles.catLabel, i === 7 && styles.catLabelActive]}>{cat.label}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        <View style={styles.section}>
          <View style={styles.sectionRow}>
            <Text style={styles.sectionTitle}>Recent listings</Text>
            <TouchableOpacity onPress={() => router.push('/explore')}>
              <Text style={styles.seeAll}>See all</Text>
            </TouchableOpacity>
          </View>
          {loading ? (
            <ActivityIndicator color={GOLD} />
          ) : (
            <View style={styles.listingGrid}>
              {listings.map((item) => (
                <TouchableOpacity
                  key={item.id}
                  style={styles.listingCard}
                  onPress={() => router.push(`/listing?id=${item.id}`)}
                >
                  <Image source={{ uri: item.image_url }} style={styles.listingImg} contentFit="cover" />
                  <View style={styles.listingBody}>
                    <Text style={styles.listingTitle}>{item.title}</Text>
                    <Text style={styles.listingPrice}>${item.price}</Text>
                    <View style={styles.listingMeta}>
                      <Text style={styles.listingLoc}>{item.location}</Text>
                      <View style={item.badge === 'Verified' ? styles.badgeVerified : styles.badgeDealer}>
                        <Text style={item.badge === 'Verified' ? styles.badgeVerifiedText : styles.badgeDealerText}>
                          {item.badge}
                        </Text>
                      </View>
                    </View>
                  </View>
                </TouchableOpacity>
              ))}
            </View>
          )}
        </View>

        <View style={{ height: 80 }} />
      </ScrollView>

      <View style={styles.bottomNav}>
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
        <TouchableOpacity style={styles.navItem} onPress={() => router.push('/chat')}>
          <Text style={styles.navIcon}>💬</Text>
          <Text style={styles.navLabel}>Messages</Text>
        </TouchableOpacity>
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
  section: { backgroundColor: BLACK, paddingHorizontal: 16, paddingBottom: 14 },
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
  listingGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignItems: 'flex-start' },
  listingCard: { backgroundColor: '#222', borderRadius: 12, overflow: 'hidden', borderWidth: 0.5, borderColor: '#333', width: '47.5%' },
  listingImg: { height: 120, width: '100%' },
  listingBody: { padding: 8 },
  listingTitle: { color: '#fff', fontSize: 12, fontWeight: '700', marginBottom: 2 },
  listingPrice: { color: GOLD, fontSize: 13, fontWeight: '800', marginBottom: 4 },
  listingMeta: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  listingLoc: { color: GREY, fontSize: 10 },
  badgeVerified: { backgroundColor: '#1a3a1a', borderRadius: 4, paddingHorizontal: 5, paddingVertical: 2 },
  badgeVerifiedText: { color: '#4A90D9', fontSize: 9 },
  badgeDealer: { backgroundColor: '#3a2800', borderRadius: 4, paddingHorizontal: 5, paddingVertical: 2 },
  badgeDealerText: { color: GOLD, fontSize: 9 },
  bottomNav: { position: 'absolute', bottom: 0, left: 0, right: 0, backgroundColor: BLACK, borderTopWidth: 0.5, borderTopColor: DARK, paddingVertical: 10, paddingBottom: 24, flexDirection: 'row', justifyContent: 'space-around', alignItems: 'center' },
  navItem: { alignItems: 'center' },
  navIcon: { fontSize: 22, color: '#555' },
  navIconActive: { fontSize: 22, color: GOLD },
  navLabel: { fontSize: 9, color: '#555', marginTop: 2 },
  navLabelActive: { fontSize: 9, color: GOLD, marginTop: 2 },
  navPost: { width: 44, height: 44, backgroundColor: GOLD, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  navPostText: { color: BLACK, fontSize: 24, fontWeight: '700', lineHeight: 28 },
});