import { StatusBar } from 'expo-status-bar';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

const GOLD = '#B8860B';
const BLACK = '#1A1A18';
const DARK = '#2a2a2a';
const GREY = '#AAAAAA';

const listings = [
  { icon: '📱', title: 'iPhone 13 Pro', price: '$320', badge: 'Active', badgeType: 'active' },
  { icon: '💻', title: 'HP Laptop i5', price: '$180', badge: 'Active', badgeType: 'active' },
  { icon: '📺', title: 'Samsung 43" TV', price: '$210', badge: 'Sold', badgeType: 'sold' },
  { icon: '🛋️', title: 'L-shaped sofa', price: '$95', badge: 'Active', badgeType: 'active' },
];

export default function ProfileScreen() {
  return (
    <View style={styles.container}>
      <StatusBar style="light" />
      <ScrollView showsVerticalScrollIndicator={false}>

        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.headerTitle}>My profile</Text>
          <View style={styles.headerIcons}>
            <Text style={styles.headerIcon}>↗</Text>
            <Text style={styles.headerIconGold}>⚙</Text>
          </View>
        </View>

        {/* Profile info */}
        <View style={styles.profileSection}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>TM</Text>
          </View>
          <Text style={styles.profileName}>Tatenda Moyo</Text>
          <Text style={styles.profileLoc}>Harare, Zimbabwe · Member since Jan 2024</Text>
          <View style={styles.verifiedBadge}>
            <Text style={styles.verifiedIcon}>✓</Text>
            <Text style={styles.verifiedText}>Verified seller</Text>
          </View>

          {/* Stats */}
          <View style={styles.statsGrid}>
            <View style={styles.statCard}>
              <Text style={styles.statVal}>47</Text>
              <Text style={styles.statLabel}>Listings</Text>
            </View>
            <View style={styles.statCard}>
              <Text style={styles.statVal}>34</Text>
              <Text style={styles.statLabel}>Sales</Text>
            </View>
            <View style={[styles.statCard, styles.statCardHighlight]}>
              <Text style={styles.statVal}>4.8</Text>
              <Text style={styles.statLabel}>Rating</Text>
            </View>
          </View>
        </View>

        {/* Tabs */}
        <View style={styles.tabs}>
          <View style={styles.tabActive}>
            <Text style={styles.tabActiveText}>Listings (12)</Text>
          </View>
          <TouchableOpacity style={styles.tab}>
            <Text style={styles.tabText}>Reviews (34)</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.tab}>
            <Text style={styles.tabText}>Sales (34)</Text>
          </TouchableOpacity>
        </View>

        {/* Listings grid */}
        <View style={styles.section}>
          <View style={styles.listingGrid}>
            {listings.map((item, i) => (
              <TouchableOpacity key={i} style={styles.listingCard}>
                <View style={styles.listingImg}>
                  <Text style={styles.listingEmoji}>{item.icon}</Text>
                  <View style={item.badgeType === 'active' ? styles.badgeActive : styles.badgeSold}>
                    <Text style={item.badgeType === 'active' ? styles.badgeActiveText : styles.badgeSoldText}>
                      {item.badge}
                    </Text>
                  </View>
                </View>
                <View style={styles.listingBody}>
                  <Text style={styles.listingTitle}>{item.title}</Text>
                  <Text style={item.badgeType === 'sold' ? styles.listingPriceSold : styles.listingPrice}>
                    {item.price}
                  </Text>
                </View>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {/* Latest review */}
        <View style={styles.section}>
          <Text style={styles.lbl}>LATEST REVIEW</Text>
          <View style={styles.reviewCard}>
            <View style={styles.reviewHeader}>
              <View style={styles.reviewAvatar}>
                <Text style={styles.reviewAvatarText}>CZ</Text>
              </View>
              <View style={styles.reviewInfo}>
                <Text style={styles.reviewName}>Chiedza Z.</Text>
                <Text style={styles.reviewStars}>★★★★★</Text>
              </View>
              <Text style={styles.reviewTime}>2 days ago</Text>
            </View>
            <Text style={styles.reviewText}>Very honest seller. Phone was exactly as described. Met at Sam Levy's, quick and easy. Highly recommend!</Text>
          </View>
        </View>

        {/* Bottom nav */}
        <View style={styles.bottomNav}>
          <TouchableOpacity style={styles.navItem}>
            <Text style={styles.navIcon}>🏠</Text>
            <Text style={styles.navLabel}>Home</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.navItem}>
            <Text style={styles.navIcon}>🔍</Text>
            <Text style={styles.navLabel}>Browse</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.navPost}>
            <Text style={styles.navPostText}>+</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.navItem}>
            <Text style={styles.navIcon}>💬</Text>
            <Text style={styles.navLabel}>Messages</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.navItem}>
            <Text style={[styles.navIcon, { color: GOLD }]}>👤</Text>
            <Text style={[styles.navLabel, { color: GOLD }]}>Profile</Text>
          </TouchableOpacity>
        </View>

        <View style={{ height: 80 }} />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#111111' },
  header: { backgroundColor: BLACK, padding: 16, paddingTop: 50, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  headerTitle: { color: '#fff', fontSize: 14, fontWeight: '700', fontFamily: 'Inter_700Bold' },
  headerIcons: { flexDirection: 'row', gap: 14 },
  headerIcon: { color: '#fff', fontSize: 20 },
  headerIconGold: { color: GOLD, fontSize: 20 },
  profileSection: { backgroundColor: BLACK, padding: 16, alignItems: 'center' },
  avatar: { width: 80, height: 80, backgroundColor: GOLD, borderRadius: 40, alignItems: 'center', justifyContent: 'center', borderWidth: 3, borderColor: GOLD, marginBottom: 10 },
  avatarText: { color: BLACK, fontSize: 28, fontWeight: '800', fontFamily: 'Inter_800ExtraBold' },
  profileName: { color: '#fff', fontSize: 18, fontWeight: '800', fontFamily: 'Inter_800ExtraBold', marginBottom: 2 },
  profileLoc: { color: GREY, fontSize: 12, marginBottom: 8 },
  verifiedBadge: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: '#1a2a3e', borderRadius: 20, paddingHorizontal: 12, paddingVertical: 4 },
  verifiedIcon: { color: '#4A90D9', fontSize: 13 },
  verifiedText: { color: '#4A90D9', fontSize: 11, fontWeight: '700', fontFamily: 'Inter_700Bold' },
  statsGrid: { flexDirection: 'row', gap: 10, marginTop: 16, width: '100%' },
  statCard: { flex: 1, backgroundColor: DARK, borderRadius: 10, padding: 10, alignItems: 'center', borderWidth: 0.5, borderColor: '#333' },
  statCardHighlight: { borderColor: GOLD },
  statVal: { color: GOLD, fontSize: 20, fontWeight: '800', fontFamily: 'Inter_800ExtraBold' },
  statLabel: { color: GREY, fontSize: 10, marginTop: 2 },
  tabs: { backgroundColor: BLACK, flexDirection: 'row', borderBottomWidth: 0.5, borderBottomColor: DARK },
  tabActive: { flex: 1, padding: 12, alignItems: 'center', borderBottomWidth: 2, borderBottomColor: GOLD },
  tabActiveText: { color: GOLD, fontSize: 12, fontWeight: '700', fontFamily: 'Inter_700Bold' },
  tab: { flex: 1, padding: 12, alignItems: 'center' },
  tabText: { color: '#555', fontSize: 12 },
  section: { backgroundColor: BLACK, padding: 16 },
  lbl: { color: GREY, fontSize: 11, marginBottom: 8, letterSpacing: 0.5 },
  listingGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  listingCard: { backgroundColor: '#222', borderRadius: 12, overflow: 'hidden', borderWidth: 0.5, borderColor: '#333', width: '47.5%' },
  listingImg: { height: 80, backgroundColor: DARK, alignItems: 'center', justifyContent: 'center', position: 'relative' },
  listingEmoji: { fontSize: 26 },
  badgeActive: { position: 'absolute', top: 6, right: 6, backgroundColor: '#1a2a3e', borderRadius: 4, paddingHorizontal: 6, paddingVertical: 2 },
  badgeActiveText: { color: '#4A90D9', fontSize: 9 },
  badgeSold: { position: 'absolute', top: 6, right: 6, backgroundColor: '#3a2800', borderRadius: 4, paddingHorizontal: 6, paddingVertical: 2 },
  badgeSoldText: { color: GOLD, fontSize: 9 },
  listingBody: { padding: 8 },
  listingTitle: { color: '#fff', fontSize: 12, fontWeight: '700', fontFamily: 'Inter_700Bold', marginBottom: 2 },
  listingPrice: { color: GOLD, fontSize: 13, fontWeight: '800', fontFamily: 'Inter_800ExtraBold' },
  listingPriceSold: { color: '#555', fontSize: 13, fontWeight: '800', fontFamily: 'Inter_800ExtraBold', textDecorationLine: 'line-through' },
  reviewCard: { backgroundColor: DARK, borderRadius: 12, padding: 12, borderWidth: 0.5, borderColor: '#333' },
  reviewHeader: { flexDirection: 'row', gap: 8, alignItems: 'center', marginBottom: 8 },
  reviewAvatar: { width: 30, height: 30, backgroundColor: '#444', borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  reviewAvatarText: { color: '#ccc', fontSize: 11, fontWeight: '700', fontFamily: 'Inter_700Bold' },
  reviewInfo: { flex: 1 },
  reviewName: { color: '#fff', fontSize: 12, fontWeight: '700', fontFamily: 'Inter_700Bold' },
  reviewStars: { color: GOLD, fontSize: 11, marginTop: 2 },
  reviewTime: { color: '#555', fontSize: 10 },
  reviewText: { color: '#ccc', fontSize: 12, lineHeight: 18 },
  bottomNav: { backgroundColor: BLACK, borderTopWidth: 0.5, borderTopColor: DARK, paddingVertical: 10, paddingBottom: 24, flexDirection: 'row', justifyContent: 'space-around', alignItems: 'center' },
  navItem: { alignItems: 'center' },
  navIcon: { fontSize: 22, color: '#555' },
  navLabel: { fontSize: 9, color: '#555', marginTop: 2 },
  navPost: { width: 44, height: 44, backgroundColor: GOLD, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  navPostText: { color: BLACK, fontSize: 24, fontWeight: '700', fontFamily: 'Inter_700Bold', lineHeight: 28 },
});