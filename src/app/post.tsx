import { StatusBar } from 'expo-status-bar';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

const GOLD = '#B8860B';
const BLACK = '#1A1A18';
const DARK = '#2a2a2a';
const GREY = '#AAAAAA';

export default function PostScreen() {
  return (
    <View style={styles.container}>
      <StatusBar style="light" />
      <ScrollView showsVerticalScrollIndicator={false}>

        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.closeBtn}>✕</Text>
          <Text style={styles.headerTitle}>Post a listing</Text>
          <Text style={styles.draftBtn}>Save draft</Text>
        </View>

        {/* Progress */}
        <View style={styles.progressWrap}>
          <View style={styles.progressHdr}>
            <Text style={styles.progressLabel}>Step 1 of 4 — Photos</Text>
            <Text style={styles.progressPct}>25%</Text>
          </View>
          <View style={styles.progressBar}>
            <View style={styles.progressFill} />
          </View>
        </View>

        {/* Photos */}
        <View style={styles.section}>
          <Text style={styles.lbl}>PHOTOS <Text style={styles.lblSub}>(add up to 8)</Text></Text>
          <View style={styles.photoGrid}>
            <View style={styles.photoUpload}>
              <Text style={styles.photoUploadIcon}>📷</Text>
              <Text style={styles.photoUploadText}>Add photo</Text>
            </View>
            <View style={styles.photoFilled}>
              <Text style={styles.photoEmoji}>📱</Text>
              <View style={styles.photoNum}>
                <Text style={styles.photoNumText}>1</Text>
              </View>
            </View>
            <View style={styles.photoEmpty}>
              <Text style={styles.photoEmptyIcon}>+</Text>
            </View>
          </View>
          <Text style={styles.photoTip}>Tip: First photo is your cover image. Good photos get 3x more views.</Text>
        </View>

        <View style={styles.divider} />

        {/* Title */}
        <View style={styles.section}>
          <Text style={styles.lbl}>TITLE</Text>
          <View style={styles.inputActive}>
            <Text style={styles.inputText}>iPhone 13 Pro 256GB</Text>
          </View>
          <Text style={styles.charCount}>19 / 60</Text>
        </View>

        {/* Category */}
        <View style={styles.section}>
          <Text style={styles.lbl}>CATEGORY</Text>
          <View style={styles.inputRow}>
            <Text style={styles.inputText}>Electronics — Phones</Text>
            <Text style={styles.chevron}>▾</Text>
          </View>
        </View>

        {/* Price */}
        <View style={styles.section}>
          <Text style={styles.lbl}>PRICE (USD)</Text>
          <View style={styles.inputRow}>
            <Text style={styles.currency}>$</Text>
            <Text style={styles.priceText}>320</Text>
          </View>
          <View style={styles.pillRow}>
            <View style={styles.pillGrey}><Text style={styles.pillGreyText}>Fixed price</Text></View>
            <View style={styles.pillGold}><Text style={styles.pillGoldText}>Negotiable</Text></View>
          </View>
        </View>

        {/* Condition */}
        <View style={styles.section}>
          <Text style={styles.lbl}>CONDITION</Text>
          <View style={styles.pillRow}>
            <View style={styles.pillGrey}><Text style={styles.pillGreyText}>New</Text></View>
            <View style={styles.pillGold}><Text style={styles.pillGoldText}>Used — Good</Text></View>
            <View style={styles.pillGrey}><Text style={styles.pillGreyText}>Used — Fair</Text></View>
          </View>
        </View>

        {/* Trade method */}
        <View style={styles.section}>
          <Text style={styles.lbl}>TRADE METHOD</Text>
          <View style={styles.tradeGrid}>
            <View style={styles.tradeCardActive}>
              <Text style={styles.tradeIcon}>📍</Text>
              <Text style={styles.tradeTitle}>Meet & Pay</Text>
              <Text style={styles.tradeSub}>Same city</Text>
            </View>
            <View style={styles.tradeCard}>
              <Text style={styles.tradeIconGrey}>📦</Text>
              <Text style={styles.tradeTitleGrey}>Escrow delivery</Text>
              <Text style={styles.tradeSub}>Cross-city</Text>
            </View>
          </View>
        </View>

        {/* Location */}
        <View style={styles.section}>
          <Text style={styles.lbl}>LOCATION</Text>
          <View style={styles.inputRow}>
            <Text style={styles.locationIcon}>📍</Text>
            <Text style={styles.inputText}>Harare, Avondale</Text>
            <Text style={styles.changeBtn}>Change</Text>
          </View>
        </View>

        {/* Description */}
        <View style={styles.section}>
          <Text style={styles.lbl}>DESCRIPTION</Text>
          <View style={styles.descField}>
            <Text style={styles.descText}>iPhone 13 Pro in excellent condition. Comes with original charger and box. Battery health 89%...</Text>
          </View>
          <Text style={styles.charCount}>124 / 500</Text>
        </View>

        {/* Post button */}
        <View style={styles.section}>
          <TouchableOpacity style={styles.btnPost}>
            <Text style={styles.btnPostText}>Post listing</Text>
          </TouchableOpacity>
          <Text style={styles.postNote}>Your listing will be live instantly after review</Text>
        </View>

        <View style={{ height: 40 }} />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#111111' },
  header: { backgroundColor: BLACK, padding: 16, paddingTop: 50, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  closeBtn: { color: '#fff', fontSize: 20 },
  headerTitle: { color: '#fff', fontSize: 14, fontWeight: '700', fontFamily: 'Inter_700Bold' },
  draftBtn: { color: GOLD, fontSize: 13, fontWeight: '700', fontFamily: 'Inter_700Bold' },
  progressWrap: { backgroundColor: BLACK, paddingHorizontal: 16, paddingBottom: 14 },
  progressHdr: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 },
  progressLabel: { color: GOLD, fontSize: 11, fontWeight: '700', fontFamily: 'Inter_700Bold' },
  progressPct: { color: '#555', fontSize: 11 },
  progressBar: { backgroundColor: DARK, borderRadius: 4, height: 4 },
  progressFill: { backgroundColor: GOLD, borderRadius: 4, height: 4, width: '25%' },
  section: { backgroundColor: BLACK, paddingHorizontal: 16, paddingBottom: 14 },
  lbl: { color: GREY, fontSize: 11, marginBottom: 6, letterSpacing: 0.5 },
  lblSub: { color: '#555' },
  divider: { height: 0.5, backgroundColor: DARK, marginHorizontal: 16 },
  photoGrid: { flexDirection: 'row', gap: 8, marginBottom: 8 },
  photoUpload: { width: 90, height: 90, backgroundColor: DARK, borderRadius: 10, borderWidth: 1.5, borderColor: GOLD, borderStyle: 'dashed', alignItems: 'center', justifyContent: 'center' },
  photoUploadIcon: { fontSize: 24, color: GOLD },
  photoUploadText: { color: GOLD, fontSize: 10, marginTop: 4 },
  photoFilled: { width: 90, height: 90, backgroundColor: DARK, borderRadius: 10, borderWidth: 0.5, borderColor: '#333', alignItems: 'center', justifyContent: 'center', position: 'relative' },
  photoEmoji: { fontSize: 28 },
  photoNum: { position: 'absolute', top: 4, right: 4, backgroundColor: GOLD, borderRadius: 8, width: 16, height: 16, alignItems: 'center', justifyContent: 'center' },
  photoNumText: { color: BLACK, fontSize: 9, fontWeight: '900' },
  photoEmpty: { width: 90, height: 90, backgroundColor: DARK, borderRadius: 10, borderWidth: 1.5, borderColor: '#333', borderStyle: 'dashed', alignItems: 'center', justifyContent: 'center' },
  photoEmptyIcon: { color: '#444', fontSize: 22 },
  photoTip: { color: '#555', fontSize: 10 },
  inputActive: { backgroundColor: DARK, borderRadius: 10, padding: 12, borderWidth: 0.5, borderColor: GOLD },
  inputRow: { backgroundColor: DARK, borderRadius: 10, padding: 12, borderWidth: 0.5, borderColor: '#333', flexDirection: 'row', alignItems: 'center', gap: 8 },
  inputText: { color: '#fff', fontSize: 14, flex: 1 },
  chevron: { color: GOLD, fontSize: 16 },
  currency: { color: GOLD, fontSize: 16, fontWeight: '800', fontFamily: 'Inter_800ExtraBold' },
  priceText: { color: '#fff', fontSize: 16, fontWeight: '700', fontFamily: 'Inter_700Bold' },
  charCount: { color: '#555', fontSize: 10, textAlign: 'right', marginTop: 4 },
  pillRow: { flexDirection: 'row', gap: 8, marginTop: 8, flexWrap: 'wrap' },
  pillGrey: { backgroundColor: DARK, borderRadius: 20, paddingHorizontal: 14, paddingVertical: 6, borderWidth: 0.5, borderColor: '#333' },
  pillGreyText: { color: '#ccc', fontSize: 12 },
  pillGold: { backgroundColor: '#3a2800', borderRadius: 20, paddingHorizontal: 14, paddingVertical: 6, borderWidth: 1, borderColor: GOLD },
  pillGoldText: { color: GOLD, fontSize: 12 },
  tradeGrid: { flexDirection: 'row', gap: 8 },
  tradeCardActive: { flex: 1, backgroundColor: '#3a2800', borderRadius: 10, padding: 12, borderWidth: 1, borderColor: GOLD, flexDirection: 'row', alignItems: 'center', gap: 8 },
  tradeCard: { flex: 1, backgroundColor: DARK, borderRadius: 10, padding: 12, borderWidth: 0.5, borderColor: '#333', flexDirection: 'row', alignItems: 'center', gap: 8 },
  tradeIcon: { fontSize: 18 },
  tradeIconGrey: { fontSize: 18, opacity: 0.4 },
  tradeTitle: { color: '#fff', fontSize: 11, fontWeight: '700', fontFamily: 'Inter_700Bold' },
  tradeTitleGrey: { color: '#ccc', fontSize: 11, fontWeight: '700', fontFamily: 'Inter_700Bold' },
  tradeSub: { color: GREY, fontSize: 9 },
  locationIcon: { fontSize: 16 },
  changeBtn: { color: GOLD, fontSize: 11 },
  descField: { backgroundColor: DARK, borderRadius: 10, padding: 12, borderWidth: 0.5, borderColor: '#333', minHeight: 80 },
  descText: { color: '#ccc', fontSize: 13, lineHeight: 20 },
  btnPost: { backgroundColor: GOLD, borderRadius: 14, padding: 16, alignItems: 'center' },
  btnPostText: { color: BLACK, fontSize: 15, fontWeight: '800', fontFamily: 'Inter_800ExtraBold' },
  postNote: { color: '#555', fontSize: 10, textAlign: 'center', marginTop: 8 },
});