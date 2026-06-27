import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { supabase } from '../../lib/supabase';

const GOLD = '#B8860B';
const BLACK = '#1A1A18';
const DARK = '#2a2a2a';
const GREY = '#AAAAAA';

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
  const [listings, setListings] = useState<any[]>([]);
  const [filtered, setFiltered] = useState<any[]>([]);
  const [search, setSearch] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchListings();
  }, []);

  useEffect(() => {
    let results = listings;
    if (search) {
      results = results.filter(item =>
        item.title.toLowerCase().includes(search.toLowerCase()) ||
        item.location.toLowerCase().includes(search.toLowerCase())
      );
    }
    if (selectedCategory) {
      results = results.filter(item =>
        item.category.toLowerCase() === selectedCategory.toLowerCase()
      );
    }
    setFiltered(results);
  }, [search, selectedCategory, listings]);

  const fetchListings = async () => {
    const { data, error } = await supabase
      .from('listings')
      .select('*')
      .order('created_at', { ascending: false });
    console.log('listings data:', data);
    console.log('listings error:', error);
    if (data) {
      setListings(data);
      setFiltered(data);
    }
    setLoading(false);
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Browse</Text>
      </View>

      <ScrollView showsVerticalScrollIndicator={false}>
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
              <Text style={[styles.catLabel, selectedCategory === cat.label && styles.catLabelActive]}>{cat.label}</Text>
            </TouchableOpacity>
          ))}
        </View>

        <Text style={styles.sectionTitle}>
          {selectedCategory ? `${selectedCategory} (${filtered.length})` : `All Listings (${filtered.length})`}
        </Text>

        {loading ? (
          <ActivityIndicator color={GOLD} style={{ marginTop: 20 }} />
        ) : filtered.length === 0 ? (
          <Text style={{ color: GREY, textAlign: 'center', marginTop: 20 }}>No listings found</Text>
        ) : (
          <View style={styles.listingGrid}>
            {filtered.map((item) => (
              <TouchableOpacity key={item.id} style={styles.listingCard} onPress={() => router.push(`/listing?id=${item.id}`)}>
                <Image source={{ uri: item.image_url }} style={styles.listingImg} contentFit="cover" />
                <View style={styles.listingBody}>
                  <Text style={styles.listingTitle}>{item.title}</Text>
                  <Text style={styles.listingPrice}>${item.price}</Text>
                  <View style={styles.listingMeta}>
                    <Text style={styles.listingLoc}>{item.location}</Text>
                    <View style={item.badge === 'Verified' ? styles.badgeVerified : styles.badgeDealer}>
                      <Text style={item.badge === 'Verified' ? styles.badgeVerifiedText : styles.badgeDealerText}>{item.badge}</Text>
                    </View>
                  </View>
                </View>
              </TouchableOpacity>
            ))}
          </View>
        )}
        <View style={{ height: 80 }} />
      </ScrollView>

      <View style={styles.bottomNav}>
        <TouchableOpacity style={styles.navItem} onPress={() => router.push('/')}>
          <Text style={styles.navIcon}>🏠</Text>
          <Text style={styles.navLabel}>Home</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.navItem}>
          <Text style={styles.navIconActive}>🔍</Text>
          <Text style={styles.navLabelActive}>Browse</Text>
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
  container: { flex: 1, backgroundColor: BLACK },
  header: { paddingHorizontal: 16, paddingTop: 50, paddingBottom: 10 },
  headerTitle: { color: '#fff', fontSize: 22, fontWeight: '700' },
  searchBar: { flexDirection: 'row', alignItems: 'center', backgroundColor: DARK, borderRadius: 12, marginHorizontal: 16, marginBottom: 16, paddingHorizontal: 12, paddingVertical: 10 },
  searchIcon: { fontSize: 16, marginRight: 8 },
  searchInput: { flex: 1, color: '#fff', fontSize: 13 },
  sectionTitle: { color: '#fff', fontSize: 13, fontWeight: '700', paddingHorizontal: 16, marginBottom: 10 },
  catGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingHorizontal: 16, marginBottom: 20 },
  catItem: { backgroundColor: DARK, borderRadius: 10, padding: 10, width: '22%', alignItems: 'center', borderWidth: 0.5, borderColor: '#333' },
  catItemActive: { borderColor: GOLD },
  catIcon: { fontSize: 20, marginBottom: 4 },
  catLabel: { color: '#ccc', fontSize: 10 },
  catLabelActive: { color: GOLD },
  listingGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, paddingHorizontal: 16 },
  listingCard: { backgroundColor: '#222', borderRadius: 12, overflow: 'hidden', width: '47.5%' },
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
  bottomNav: { position: 'absolute', bottom: 0, left: 0, right: 0, backgroundColor: BLACK, borderTopWidth: 0.5, borderTopColor: DARK, flexDirection: 'row', justifyContent: 'space-around', alignItems: 'center', paddingVertical: 10 },
  navItem: { alignItems: 'center' },
  navIcon: { fontSize: 22, color: '#555' },
  navIconActive: { fontSize: 22, color: GOLD },
  navLabel: { fontSize: 9, color: '#555', marginTop: 2 },
  navLabelActive: { fontSize: 9, color: GOLD, marginTop: 2 },
  navPost: { width: 44, height: 44, backgroundColor: GOLD, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  navPostText: { color: BLACK, fontSize: 24, fontWeight: '700' },
});