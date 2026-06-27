import { Image } from 'expo-image';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { supabase } from '../../lib/supabase';

const GOLD = '#B8860B';
const BLACK = '#1A1A18';
const DARK = '#2a2a2a';
const GREY = '#AAAAAA';

export default function ListingScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams();
  const [listing, setListing] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (id) fetchListing();
  }, [id]);

  const fetchListing = async () => {
    const { data } = await supabase
      .from('listings')
      .select('*')
      .eq('id', id)
      .single();
    if (data) setListing(data);
    setLoading(false);
  };

  if (loading) {
    return (
      <View style={[styles.container, { justifyContent: 'center', alignItems: 'center' }]}>
        <ActivityIndicator color={GOLD} size="large" />
      </View>
    );
  }

  if (!listing) {
    return (
      <View style={[styles.container, { justifyContent: 'center', alignItems: 'center' }]}>
        <Text style={{ color: '#fff' }}>Listing not found</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <StatusBar style="light" />
      <ScrollView showsVerticalScrollIndicator={false}>
        <View style={styles.topnav}>
          <TouchableOpacity onPress={() => router.back()}>
            <Text style={styles.backBtn}>←</Text>
          </TouchableOpacity>
          <Text style={styles.navTitle}>Listing detail</Text>
          <View style={styles.navIcons}>
            <Text style={styles.heartIcon}>♡</Text>
            <Text style={styles.shareIcon}>↗</Text>
          </View>
        </View>

        <Image source={{ uri: listing.image_url }} style={styles.imgArea} contentFit="cover" />

        <View style={styles.section}>
          <View style={styles.priceRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.itemTitle}>{listing.title}</Text>
              <Text style={styles.itemLoc}>{listing.location}</Text>
            </View>
            <Text style={styles.itemPrice}>${listing.price}</Text>
          </View>
          <View style={styles.badges}>
            <View style={styles.badgeGrey}><Text style={styles.badgeGreyText}>{listing.category}</Text></View>
            <View style={styles.badgeGold}><Text style={styles.badgeGoldText}>Meet & Pay</Text></View>
            <View style={styles.badgeGrey}><Text style={styles.badgeGreyText}>{listing.badge}</Text></View>
          </View>
        </View>

        <View style={styles.divider} />

        <View style={styles.section}>
          <Text style={styles.lbl}>DESCRIPTION</Text>
          <Text style={styles.descText}>{listing.description}</Text>
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
        <TouchableOpacity style={styles.btnMsg} onPress={() => router.push('/chat')}>
          <Text style={styles.btnMsgText}>💬 Message</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.btnBuy} onPress={() => router.push('/payment')}>
          <Text style={styles.btnBuyText}>Buy now — ${listing.price}</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#111111' },
  topnav: { backgroundColor: BLACK, padding: 16, paddingTop: 50, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  backBtn: { color: '#fff', fontSize: 22 },
  navTitle: { color: '#fff', fontSize: 14, fontWeight: '700' },
  navIcons: { flexDirection: 'row', gap: 14 },
  heartIcon: { color: GOLD, fontSize: 20 },
  shareIcon: { color: '#fff', fontSize: 20 },
  imgArea: { height: 260, width: '100%' },
  section: { backgroundColor: BLACK, padding: 16 },
  divider: { height: 0.5, backgroundColor: DARK, marginHorizontal: 16 },
  priceRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  itemTitle: { color: '#fff', fontSize: 17, fontWeight: '800', marginBottom: 2 },
  itemLoc: { color: GREY, fontSize: 12 },
  itemPrice: { color: GOLD, fontSize: 22, fontWeight: '800' },
  badges: { flexDirection: 'row', gap: 8, marginTop: 10, flexWrap: 'wrap' },
  badgeGrey: { backgroundColor: DARK, borderRadius: 20, paddingHorizontal: 10, paddingVertical: 4, borderWidth: 0.5, borderColor: '#444' },
  badgeGreyText: { color: '#ccc', fontSize: 10 },
  badgeGold: { backgroundColor: '#3a2800', borderRadius: 20, paddingHorizontal: 10, paddingVertical: 4, borderWidth: 0.5, borderColor: GOLD },
  badgeGoldText: { color: GOLD, fontSize: 10 },
  lbl: { color: GREY, fontSize: 11, marginBottom: 8, letterSpacing: 0.5 },
  descText: { color: '#ccc', fontSize: 13, lineHeight: 22 },
  tradeGrid: { flexDirection: 'row', gap: 8 },
  tradeCard: { flex: 1, backgroundColor: DARK, borderRadius: 10, padding: 12, borderWidth: 0.5, borderColor: '#333' },
  tradeCardActive: { borderColor: GOLD, borderWidth: 1 },
  tradeIcon: { fontSize: 18, marginBottom: 4 },
  tradeTitle: { color: '#fff', fontSize: 12, fontWeight: '700', marginBottom: 2 },
  tradeSub: { color: GREY, fontSize: 10 },
  ctaRow: { position: 'absolute', bottom: 0, left: 0, right: 0, backgroundColor: BLACK, padding: 16, paddingBottom: 30, flexDirection: 'row', gap: 10 },
  btnMsg: { flex: 1, backgroundColor: DARK, borderRadius: 12, padding: 14, alignItems: 'center', borderWidth: 0.5, borderColor: '#444' },
  btnMsgText: { color: '#fff', fontSize: 13, fontWeight: '700' },
  btnBuy: { flex: 2, backgroundColor: GOLD, borderRadius: 12, padding: 14, alignItems: 'center' },
  btnBuyText: { color: BLACK, fontSize: 14, fontWeight: '800' },
});