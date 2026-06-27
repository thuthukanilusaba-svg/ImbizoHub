import { StatusBar } from 'expo-status-bar';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

const GOLD = '#B8860B';
const BLACK = '#1A1A18';
const DARK = '#2a2a2a';
const GREY = '#AAAAAA';

export default function ListingScreen() {
  return (
    <View style={styles.container}>
      <StatusBar style="light" />
      <ScrollView showsVerticalScrollIndicator={false}>
        <View style={styles.topnav}>
          <Text style={styles.backBtn}>←</Text>
          <Text style={styles.navTitle}>Listing detail</Text>
          <View style={styles.navIcons}>
            <Text style={styles.heartIcon}>♡</Text>
            <Text style={styles.shareIcon}>↗</Text>
          </View>
        </View>
        <View style={styles.imgArea}>
          <Text style={styles.imgEmoji}>📱</Text>
          <View style={styles.imgDots}>
            <View style={styles.dotActive} />
            <View style={styles.dot} />
            <View style={styles.dot} />
            <View style={styles.dot} />
          </View>
          <View style={styles.imgCount}>
            <Text style={styles.imgCountText}>1 / 4</Text>
          </View>
        </View>
        <View style={styles.thumbRow}>
          {['📱','📱','📱','📱'].map((e, i) => (
            <View key={i} style={[styles.thumb, i === 0 && styles.thumbActive]}>
              <Text style={styles.thumbEmoji}>{e}</Text>
            </View>
          ))}
        </View>
        <View style={styles.section}>
          <View style={styles.priceRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.itemTitle}>iPhone 13 Pro — 256GB</Text>
              <Text style={styles.itemLoc}>Posted 2 hours ago · Harare, Avondale</Text>
            </View>
            <Text style={styles.itemPrice}>$320</Text>
          </View>
          <View style={styles.badges}>
            <View style={styles.badgeGrey}><Text style={styles.badgeGreyText}>Good condition</Text></View>
            <View style={styles.badgeGold}><Text style={styles.badgeGoldText}>Meet & Pay</Text></View>
            <View style={styles.badgeGrey}><Text style={styles.badgeGreyText}>Escrow delivery</Text></View>
          </View>
        </View>
        <View style={styles.divider} />
        <View style={styles.section}>
          <Text style={styles.lbl}>SELLER</Text>
          <View style={styles.sellerRow}>
            <View style={styles.sellerLeft}>
              <View style={styles.sellerAvatar}>
                <Text style={styles.sellerAvatarText}>TM</Text>
              </View>
              <View>
                <Text style={styles.sellerName}>Tatenda Moyo</Text>
                <View style={styles.ratingRow}>
                  <Text style={styles.star}>★</Text>
                  <Text style={styles.ratingVal}>4.8</Text>
                  <Text style={styles.ratingCount}>(34 reviews)</Text>
                </View>
              </View>
            </View>
            <View style={styles.sellerActions}>
              <View style={styles.actionBtn}><Text style={styles.actionIcon}>💬</Text></View>
              <View style={styles.actionBtn}><Text style={styles.actionIcon}>📞</Text></View>
            </View>
          </View>
          <View style={styles.verifiedBar}>
            <Text style={styles.verifiedIcon}>✓</Text>
            <Text style={styles.verifiedText}>Verified seller · Member since Jan 2024</Text>
          </View>
        </View>
        <View style={styles.divider} />
        <View style={styles.section}>
          <Text style={styles.lbl}>DESCRIPTION</Text>
          <Text style={styles.descText}>iPhone 13 Pro in excellent condition. Comes with original charger and box. Battery health 89%. No cracks, no scratches. Selling because I upgraded to 14 Pro. Serious buyers only.</Text>
        </View>
        <View style={styles.divider} />
        <View style={styles.section}>
          <Text style={styles.lbl}>HOW TO TRADE</Text>
          <View style={styles.tradeGrid}>
            <View style={[styles.tradeCard, styles.tradeCardActive]}>
              <Text style={styles.tradeIcon}>📍</Text>
              <Text style={styles.tradeTitle}>Meet & Pay</Text>
              <Text style={styles.tradeSub}>Meet in person, inspect, then pay</Text>
            </View>
            <View style={styles.tradeCard}>
              <Text style={styles.tradeIcon}>📦</Text>
              <Text style={styles.tradeTitle}>Escrow delivery</Text>
              <Text style={styles.tradeSub}>Pay securely, released on receipt</Text>
            </View>
          </View>
        </View>
        <View style={{ height: 100 }} />
      </ScrollView>
      <View style={styles.ctaRow}>
        <TouchableOpacity style={styles.btnMsg}>
          <Text style={styles.btnMsgText}>💬 Message</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.btnBuy}>
          <Text style={styles.btnBuyText}>Buy now — $320</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#111111' },
  topnav: { backgroundColor: BLACK, padding: 16, paddingTop: 50, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  backBtn: { color: '#fff', fontSize: 22 },
  navTitle: { color: '#fff', fontSize: 14, fontWeight: '700', fontFamily: 'Inter_700Bold' },
  navIcons: { flexDirection: 'row', gap: 14 },
  heartIcon: { color: GOLD, fontSize: 20 },
  shareIcon: { color: '#fff', fontSize: 20 },
  imgArea: { backgroundColor: DARK, height: 220, alignItems: 'center', justifyContent: 'center', position: 'relative' },
  imgEmoji: { fontSize: 64 },
  imgDots: { position: 'absolute', bottom: 10, flexDirection: 'row', gap: 6 },
  dotActive: { width: 20, height: 4, backgroundColor: GOLD, borderRadius: 2 },
  dot: { width: 6, height: 4, backgroundColor: '#555', borderRadius: 2 },
  imgCount: { position: 'absolute', top: 10, right: 10, backgroundColor: 'rgba(0,0,0,0.6)', borderRadius: 20, paddingHorizontal: 10, paddingVertical: 3 },
  imgCountText: { color: '#fff', fontSize: 11 },
  thumbRow: { backgroundColor: BLACK, padding: 8, paddingHorizontal: 16, flexDirection: 'row', gap: 8 },
  thumb: { width: 52, height: 52, backgroundColor: DARK, borderRadius: 8, alignItems: 'center', justifyContent: 'center', borderWidth: 0.5, borderColor: '#333' },
  thumbActive: { borderColor: GOLD, borderWidth: 2 },
  thumbEmoji: { fontSize: 18 },
  section: { backgroundColor: BLACK, padding: 16 },
  divider: { height: 0.5, backgroundColor: DARK, marginHorizontal: 16 },
  priceRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  itemTitle: { color: '#fff', fontSize: 17, fontWeight: '800', fontFamily: 'Inter_800ExtraBold', marginBottom: 2 },
  itemLoc: { color: GREY, fontSize: 12 },
  itemPrice: { color: GOLD, fontSize: 22, fontWeight: '800', fontFamily: 'Inter_800ExtraBold' },
  badges: { flexDirection: 'row', gap: 8, marginTop: 10, flexWrap: 'wrap' },
  badgeGrey: { backgroundColor: DARK, borderRadius: 20, paddingHorizontal: 10, paddingVertical: 4, borderWidth: 0.5, borderColor: '#444' },
  badgeGreyText: { color: '#ccc', fontSize: 10 },
  badgeGold: { backgroundColor: '#3a2800', borderRadius: 20, paddingHorizontal: 10, paddingVertical: 4, borderWidth: 0.5, borderColor: GOLD },
  badgeGoldText: { color: GOLD, fontSize: 10 },
  lbl: { color: GREY, fontSize: 11, marginBottom: 8, letterSpacing: 0.5 },
  sellerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  sellerLeft: { flexDirection: 'row', gap: 10, alignItems: 'center' },
  sellerAvatar: { width: 42, height: 42, backgroundColor: GOLD, borderRadius: 21, alignItems: 'center', justifyContent: 'center' },
  sellerAvatarText: { color: BLACK, fontSize: 15, fontWeight: '800', fontFamily: 'Inter_800ExtraBold' },
  sellerName: { color: '#fff', fontSize: 13, fontWeight: '700', fontFamily: 'Inter_700Bold' },
  ratingRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 },
  star: { color: GOLD, fontSize: 12 },
  ratingVal: { color: GOLD, fontSize: 12, fontWeight: '700', fontFamily: 'Inter_700Bold' },
  ratingCount: { color: '#555', fontSize: 11 },
  sellerActions: { flexDirection: 'row', gap: 10 },
  actionBtn: { width: 36, height: 36, backgroundColor: DARK, borderRadius: 18, alignItems: 'center', justifyContent: 'center', borderWidth: 0.5, borderColor: '#333' },
  actionIcon: { fontSize: 16 },
  verifiedBar: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: '#1a2a3e', borderRadius: 8, padding: 8, marginTop: 10 },
  verifiedIcon: { color: '#4A90D9', fontSize: 14 },
  verifiedText: { color: '#4A90D9', fontSize: 11 },
  descText: { color: '#ccc', fontSize: 13, lineHeight: 22 },
  tradeGrid: { flexDirection: 'row', gap: 8 },
  tradeCard: { flex: 1, backgroundColor: DARK, borderRadius: 10, padding: 12, borderWidth: 0.5, borderColor: '#333' },
  tradeCardActive: { borderColor: GOLD, borderWidth: 1 },
  tradeIcon: { fontSize: 18, marginBottom: 4 },
  tradeTitle: { color: '#fff', fontSize: 12, fontWeight: '700', fontFamily: 'Inter_700Bold', marginBottom: 2 },
  tradeSub: { color: GREY, fontSize: 10 },
  ctaRow: { position: 'absolute', bottom: 0, left: 0, right: 0, backgroundColor: BLACK, padding: 16, paddingBottom: 30, flexDirection: 'row', gap: 10 },
  btnMsg: { flex: 1, backgroundColor: DARK, borderRadius: 12, padding: 14, alignItems: 'center', borderWidth: 0.5, borderColor: '#444' },
  btnMsgText: { color: '#fff', fontSize: 13, fontWeight: '700', fontFamily: 'Inter_700Bold' },
  btnBuy: { flex: 2, backgroundColor: GOLD, borderRadius: 12, padding: 14, alignItems: 'center' },
  btnBuyText: { color: BLACK, fontSize: 14, fontWeight: '800', fontFamily: 'Inter_800ExtraBold' },
});