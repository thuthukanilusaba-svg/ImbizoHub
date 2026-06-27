import { StatusBar } from 'expo-status-bar';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

const GOLD = '#B8860B';
const BLACK = '#1A1A18';
const DARK = '#2a2a2a';
const GREY = '#AAAAAA';

const inventory = [
  { icon: '🚗', title: 'Toyota Vitz 2010', price: '$4,200', views: '14 views today', status: 'active' },
  { icon: '🚗', title: 'Honda Fit 2012', price: '$5,800', views: '9 views today', status: 'active' },
  { icon: '🚗', title: 'Mazda Demio 2009', price: '$3,500', views: '', status: 'sold' },
];

export default function DealerScreen() {
  return (
    <View style={styles.container}>
      <StatusBar style="light" />
      <ScrollView showsVerticalScrollIndicator={false}>

        {/* Header */}
        <View style={styles.header}>
          <View>
            <View style={styles.headerTitle}>
              <Text style={styles.headerTitleText}>Dealer dashboard</Text>
              <View style={styles.proBadge}>
                <Text style={styles.proBadgeText}>PRO</Text>
              </View>
            </View>
            <Text style={styles.headerSub}>Moyo Motors · Harare</Text>
          </View>
          <View style={styles.dealerAvatar}>
            <Text style={styles.dealerAvatarText}>MM</Text>
          </View>
        </View>

        {/* Stats */}
        <View style={styles.section}>
          <View style={styles.statsGrid}>
            <View style={styles.statCard}>
              <Text style={styles.statLbl}>THIS MONTH</Text>
              <Text style={styles.statValGold}>$2,840</Text>
              <Text style={styles.statTrend}>↑ 18% vs last month</Text>
            </View>
            <View style={styles.statCard}>
              <Text style={styles.statLbl}>ACTIVE LISTINGS</Text>
              <Text style={styles.statValWhite}>23</Text>
              <Text style={styles.statTrendGrey}>4 sold this week</Text>
            </View>
            <View style={styles.statCard}>
              <Text style={styles.statLbl}>MESSAGES</Text>
              <Text style={styles.statValWhite}>12</Text>
              <Text style={styles.statTrendGold}>3 unread</Text>
            </View>
            <View style={[styles.statCard, styles.statCardHighlight]}>
              <Text style={styles.statLbl}>RATING</Text>
              <Text style={styles.statValGold}>4.9</Text>
              <Text style={styles.statTrendGrey}>68 reviews</Text>
            </View>
          </View>
        </View>

        {/* Quick actions */}
        <View style={styles.section}>
          <Text style={styles.lbl}>QUICK ACTIONS</Text>
          <View style={styles.actionsGrid}>
            <TouchableOpacity style={styles.actionPrimary}>
              <Text style={styles.actionIcon}>+</Text>
              <Text style={styles.actionPrimaryText}>Add listing</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.actionSecondary}>
              <Text style={styles.actionIcon}>📊</Text>
              <Text style={styles.actionSecondaryText}>Analytics</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.actionSecondary}>
              <Text style={styles.actionIcon}>⭐</Text>
              <Text style={styles.actionSecondaryText}>Boost listing</Text>
            </TouchableOpacity>
          </View>
        </View>

        <View style={styles.divider} />

        {/* Inventory */}
        <View style={styles.section}>
          <View style={styles.sectionRow}>
            <Text style={styles.sectionTitle}>Recent inventory</Text>
            <Text style={styles.manageAll}>Manage all</Text>
          </View>
          {inventory.map((item, i) => (
            <View key={i} style={[styles.invItem, item.status === 'sold' && styles.invItemSold]}>
              <View style={[styles.invImg, item.status === 'sold' && styles.invImgSold]}>
                <Text style={styles.invEmoji}>{item.icon}</Text>
              </View>
              <View style={styles.invInfo}>
                <Text style={item.status === 'sold' ? styles.invTitleSold : styles.invTitle}>{item.title}</Text>
                <Text style={item.status === 'sold' ? styles.invPriceSold : styles.invPrice}>{item.price}</Text>
                <View style={styles.invMeta}>
                  {item.status === 'active' ? (
                    <>
                      <View style={styles.badgeActive}><Text style={styles.badgeActiveText}>Active</Text></View>
                      <Text style={styles.invViews}>{item.views}</Text>
                    </>
                  ) : (
                    <View style={styles.badgeSold}><Text style={styles.badgeSoldText}>Sold · {item.price}</Text></View>
                  )}
                </View>
              </View>
              <Text style={styles.menuIcon}>⋮</Text>
            </View>
          ))}
        </View>

        {/* Subscription */}
        <View style={styles.section}>
          <View style={styles.subCard}>
            <View>
              <Text style={styles.subName}>Dealer Pro Plan</Text>
              <Text style={styles.subDetail}>Renews 1 Aug 2026 · $30/month</Text>
            </View>
            <Text style={styles.subManage}>Manage</Text>
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
            <Text style={[styles.navIcon, { color: GOLD }]}>🏪</Text>
            <Text style={[styles.navLabel, { color: GOLD }]}>Dealer</Text>
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
  headerTitle: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  headerTitleText: { color: '#fff', fontSize: 16, fontWeight: '800', fontFamily: 'Inter_800ExtraBold' },
  proBadge: { backgroundColor: GOLD, borderRadius: 20, paddingHorizontal: 8, paddingVertical: 2 },
  proBadgeText: { color: BLACK, fontSize: 9, fontWeight: '800', fontFamily: 'Inter_800ExtraBold' },
  headerSub: { color: GREY, fontSize: 11, marginTop: 2 },
  dealerAvatar: { width: 40, height: 40, backgroundColor: GOLD, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  dealerAvatarText: { color: BLACK, fontSize: 14, fontWeight: '800', fontFamily: 'Inter_800ExtraBold' },
  section: { backgroundColor: BLACK, padding: 16, marginBottom: 1 },
  lbl: { color: GREY, fontSize: 11, marginBottom: 8, letterSpacing: 0.5 },
  divider: { height: 0.5, backgroundColor: DARK, marginHorizontal: 16 },
  statsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  statCard: { width: '47.5%', backgroundColor: DARK, borderRadius: 12, padding: 14, borderWidth: 0.5, borderColor: '#333' },
  statCardHighlight: { borderColor: GOLD },
  statLbl: { color: GREY, fontSize: 10, marginBottom: 4, letterSpacing: 0.5 },
  statValGold: { color: GOLD, fontSize: 24, fontWeight: '800', fontFamily: 'Inter_800ExtraBold' },
  statValWhite: { color: '#fff', fontSize: 24, fontWeight: '800', fontFamily: 'Inter_800ExtraBold' },
  statTrend: { color: '#4A90D9', fontSize: 11, marginTop: 4 },
  statTrendGrey: { color: '#555', fontSize: 11, marginTop: 4 },
  statTrendGold: { color: GOLD, fontSize: 11, marginTop: 4 },
  actionsGrid: { flexDirection: 'row', gap: 8 },
  actionPrimary: { flex: 1, backgroundColor: GOLD, borderRadius: 10, padding: 12, alignItems: 'center' },
  actionSecondary: { flex: 1, backgroundColor: DARK, borderRadius: 10, padding: 12, alignItems: 'center', borderWidth: 0.5, borderColor: '#333' },
  actionIcon: { fontSize: 16, marginBottom: 4 },
  actionPrimaryText: { color: BLACK, fontSize: 11, fontWeight: '800', fontFamily: 'Inter_800ExtraBold' },
  actionSecondaryText: { color: '#fff', fontSize: 11, fontWeight: '700', fontFamily: 'Inter_700Bold' },
  sectionRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  sectionTitle: { color: '#fff', fontSize: 13, fontWeight: '700', fontFamily: 'Inter_700Bold' },
  manageAll: { color: GOLD, fontSize: 11 },
  invItem: { backgroundColor: DARK, borderRadius: 12, padding: 12, borderWidth: 0.5, borderColor: '#333', marginBottom: 8, flexDirection: 'row', gap: 10, alignItems: 'center' },
  invItemSold: { opacity: 0.7, backgroundColor: '#222', borderColor: DARK },
  invImg: { width: 48, height: 48, backgroundColor: '#333', borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  invImgSold: { backgroundColor: DARK },
  invEmoji: { fontSize: 22 },
  invInfo: { flex: 1 },
  invTitle: { color: '#fff', fontSize: 13, fontWeight: '700', fontFamily: 'Inter_700Bold', marginBottom: 2 },
  invTitleSold: { color: GREY, fontSize: 13, fontWeight: '700', fontFamily: 'Inter_700Bold', marginBottom: 2 },
  invPrice: { color: GOLD, fontSize: 13, fontWeight: '800', fontFamily: 'Inter_800ExtraBold', marginBottom: 4 },
  invPriceSold: { color: '#555', fontSize: 13, fontWeight: '800', fontFamily: 'Inter_800ExtraBold', marginBottom: 4, textDecorationLine: 'line-through' },
  invMeta: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  badgeActive: { backgroundColor: '#1a2a3e', borderRadius: 4, paddingHorizontal: 6, paddingVertical: 2 },
  badgeActiveText: { color: '#4A90D9', fontSize: 9 },
  badgeSold: { backgroundColor: '#3a2800', borderRadius: 4, paddingHorizontal: 6, paddingVertical: 2 },
  badgeSoldText: { color: GOLD, fontSize: 9 },
  invViews: { color: '#555', fontSize: 10 },
  menuIcon: { color: '#555', fontSize: 18 },
  subCard: { backgroundColor: '#3a2800', borderRadius: 12, padding: 14, borderWidth: 1, borderColor: GOLD, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  subName: { color: GOLD, fontSize: 12, fontWeight: '800', fontFamily: 'Inter_800ExtraBold' },
  subDetail: { color: GREY, fontSize: 11, marginTop: 3 },
  subManage: { color: GOLD, fontSize: 11, fontWeight: '700', fontFamily: 'Inter_700Bold' },
  bottomNav: { backgroundColor: BLACK, borderTopWidth: 0.5, borderTopColor: DARK, paddingVertical: 10, paddingBottom: 24, flexDirection: 'row', justifyContent: 'space-around', alignItems: 'center' },
  navItem: { alignItems: 'center' },
  navIcon: { fontSize: 22, color: '#555' },
  navLabel: { fontSize: 9, color: '#555', marginTop: 2 },
  navPost: { width: 44, height: 44, backgroundColor: GOLD, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  navPostText: { color: BLACK, fontSize: 24, fontWeight: '700', fontFamily: 'Inter_700Bold', lineHeight: 28 },
});