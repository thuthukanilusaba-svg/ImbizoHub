import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';

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

const listings = [
  { image: 'https://images.unsplash.com/photo-1496181133206-80ce9b88a853?w=400', title: 'HP Laptop i5', price: '$180', location: 'Bulawayo', badge: 'Verified', badgeType: 'verified' },
  { image: 'https://images.unsplash.com/photo-1494976388531-d1058494cdd8?w=400', title: 'Toyota Vitz 2010', price: '$4,200', location: 'Harare', badge: 'Dealer', badgeType: 'dealer' },
  { image: 'https://images.unsplash.com/photo-1555041469-a586c61ea9bc?w=400', title: 'L-shaped sofa', price: '$95', location: 'Harare', badge: 'Verified', badgeType: 'verified' },
  { image: 'https://images.unsplash.com/photo-1461151304267-38535e780c79?w=400', title: 'Samsung 43" TV', price: '$210', location: 'Mutare', badge: 'Dealer', badgeType: 'dealer' },
  { image: 'https://images.unsplash.com/photo-1511707171634-5f897ff02aa9?w=400', title: 'iPhone 12', price: '$280', location: 'Harare', badge: 'Verified', badgeType: 'verified' },
  { image: 'https://images.unsplash.com/photo-1558618666-fcd25c85cd64?w=400', title: 'Nike Air Max', price: '$45', location: 'Bulawayo', badge: 'Verified', badgeType: 'verified' },
];

export default function ExploreScreen() {
  const router = useRouter();

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Browse</Text>
      </View>

      <ScrollView showsVerticalScrollIndicator={false}>
        <View style={styles.searchBar}>
          <Text style={styles.searchIcon}>🔍</Text>
          <TextInput style={styles.searchInput} placeholder="Search listings..." placeholderTextColor={GREY} />
        </View>

        <Text style={styles.sectionTitle}>Categories</Text>
        <View style={styles.catGrid}>
          {categories.map((cat, i) => (
            <TouchableOpacity key={i} style={styles.catItem}>
              <Text style={styles.catIcon}>{cat.icon}</Text>
              <Text style={styles.catLabel}>{cat.label}</Text>
            </TouchableOpacity>
          ))}
        </View>

        <Text style={styles.sectionTitle}>All Listings</Text>
        <View style={styles.listingGrid}>
          {listings.map((item, i) => (
            <TouchableOpacity key={i} style={styles.listingCard} onPress={() => router.push('/listing')}>
              <Image source={{ uri: item.image }} style={styles.listingImg} contentFit="cover" />
              <View style={styles.listingBody}>
                <Text style={styles.listingTitle}>{item.title}</Text>
                <Text style={styles.listingPrice}>{item.price}</Text>
                <View style={styles.listingMeta}>
                  <Text style={styles.listingLoc}>{item.location}</Text>
                  <View style={item.badgeType === 'verified' ? styles.badgeVerified : styles.badgeDealer}>
                    <Text style={item.badgeType === 'verified' ? styles.badgeVerifiedText : styles.badgeDealerText}>{item.badge}</Text>
                  </View>
                </View>
              </View>
            </TouchableOpacity>
          ))}
        </View>
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
  catItem: { backgroundColor: DARK, borderRadius: 10, padding: 10, width: '22%', alignItems: 'center' },
  catIcon: { fontSize: 20, marginBottom: 4 },
  catLabel: { color: '#ccc', fontSize: 10 },
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