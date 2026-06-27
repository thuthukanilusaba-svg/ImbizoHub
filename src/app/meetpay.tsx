import { StatusBar } from 'expo-status-bar';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

const GOLD = '#B8860B';
const BLACK = '#1A1A18';
const DARK = '#2a2a2a';
const GREY = '#AAAAAA';

const PIN = ['4', '7', '2', '', '', ''];

export default function MeetPayScreen() {
  return (
    <View style={styles.container}>
      <StatusBar style="light" />
      <ScrollView showsVerticalScrollIndicator={false}>

        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.backBtn}>←</Text>
          <Text style={styles.headerTitle}>Meet & Pay</Text>
          <Text style={styles.helpIcon}>?</Text>
        </View>

        {/* Steps */}
        <View style={styles.steps}>
          <View style={styles.step}>
            <View style={styles.stepDone}><Text style={styles.stepDoneText}>✓</Text></View>
            <Text style={styles.stepLabelDone}>Agree{'\n'}to meet</Text>
          </View>
          <View style={styles.lineDone} />
          <View style={styles.step}>
            <View style={styles.stepDone}><Text style={styles.stepDoneText}>✓</Text></View>
            <Text style={styles.stepLabelDone}>Inspect{'\n'}item</Text>
          </View>
          <View style={styles.lineDone} />
          <View style={styles.step}>
            <View style={styles.stepActive}><Text style={styles.stepActiveText}>🔓</Text></View>
            <Text style={styles.stepLabelActive}>Enter{'\n'}PIN</Text>
          </View>
          <View style={styles.linePending} />
          <View style={styles.step}>
            <View style={styles.stepPending}><Text style={styles.stepPendingText}>4</Text></View>
            <Text style={styles.stepLabelPending}>Pay{'\n'}seller</Text>
          </View>
        </View>

        {/* Order summary */}
        <View style={styles.section}>
          <View style={styles.orderCard}>
            <View style={styles.orderImg}>
              <Text style={styles.orderEmoji}>📱</Text>
            </View>
            <View style={styles.orderInfo}>
              <Text style={styles.orderTitle}>iPhone 13 Pro 256GB</Text>
              <Text style={styles.orderSeller}>Seller: Tatenda Moyo</Text>
            </View>
            <Text style={styles.orderPrice}>$310</Text>
          </View>
        </View>

        {/* Meetup location */}
        <View style={styles.section}>
          <Text style={styles.lbl}>AGREED MEETUP LOCATION</Text>
          <View style={styles.locationCard}>
            <Text style={styles.locationIcon}>📍</Text>
            <View>
              <Text style={styles.locationName}>Sam Levy's Village</Text>
              <Text style={styles.locationSub}>Borrowdale, Harare · Public place</Text>
            </View>
          </View>
          <View style={styles.safeBar}>
            <Text style={styles.safeIcon}>✓</Text>
            <Text style={styles.safeText}>Safe public location — recommended by ImbizoHub</Text>
          </View>
        </View>

        {/* PIN entry */}
        <View style={styles.section}>
          <Text style={styles.lbl}>ENTER PIN FROM SELLER</Text>
          <Text style={styles.pinInfo}>
            Ask the seller to tap <Text style={styles.pinHighlight}>Confirm Handover</Text> on their phone. Enter the 6-digit PIN they show you.
          </Text>

          {/* PIN boxes */}
          <View style={styles.pinRow}>
            {PIN.map((digit, i) => (
              <View key={i} style={[styles.pinBox, digit ? styles.pinBoxFilled : styles.pinBoxEmpty]}>
                <Text style={styles.pinDigit}>{digit || '_'}</Text>
              </View>
            ))}
          </View>

          {/* Numpad */}
          <View style={styles.numpad}>
            {['1','2','3','4','5','6','7','8','9','','0','⌫'].map((key, i) => (
              <TouchableOpacity
                key={i}
                style={[styles.numKey, key === '' && styles.numKeyEmpty]}
              >
                <Text style={[styles.numKeyText, key === '⌫' && styles.numKeyDel]}>{key}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {/* Confirm button */}
        <View style={styles.section}>
          <TouchableOpacity style={styles.btnConfirm}>
            <Text style={styles.btnConfirmText}>Confirm PIN to unlock payment</Text>
          </TouchableOpacity>
          <Text style={styles.pinNote}>PIN is valid for 10 minutes only</Text>
        </View>

        <View style={{ height: 40 }} />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#111111' },
  header: { backgroundColor: BLACK, padding: 16, paddingTop: 50, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  backBtn: { color: '#fff', fontSize: 22 },
  headerTitle: { color: '#fff', fontSize: 14, fontWeight: '700', fontFamily: 'Inter_700Bold' },
  helpIcon: { color: GOLD, fontSize: 20 },
  steps: { backgroundColor: BLACK, paddingVertical: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
  step: { alignItems: 'center', gap: 4 },
  stepDone: { width: 28, height: 28, borderRadius: 14, backgroundColor: BLACK, borderWidth: 2, borderColor: '#4A90D9', alignItems: 'center', justifyContent: 'center' },
  stepDoneText: { color: '#4A90D9', fontSize: 12, fontWeight: '800', fontFamily: 'Inter_800ExtraBold' },
  stepActive: { width: 28, height: 28, borderRadius: 14, backgroundColor: GOLD, alignItems: 'center', justifyContent: 'center' },
  stepActiveText: { color: BLACK, fontSize: 12 },
  stepPending: { width: 28, height: 28, borderRadius: 14, backgroundColor: DARK, borderWidth: 0.5, borderColor: '#444', alignItems: 'center', justifyContent: 'center' },
  stepPendingText: { color: '#555', fontSize: 12, fontWeight: '800', fontFamily: 'Inter_800ExtraBold' },
  stepLabelDone: { color: '#4A90D9', fontSize: 9, textAlign: 'center', lineHeight: 13 },
  stepLabelActive: { color: GOLD, fontSize: 9, textAlign: 'center', lineHeight: 13 },
  stepLabelPending: { color: '#555', fontSize: 9, textAlign: 'center', lineHeight: 13 },
  lineDone: { height: 2, width: 32, backgroundColor: '#4A90D9', marginBottom: 14 },
  linePending: { height: 2, width: 32, backgroundColor: '#333', marginBottom: 14 },
  section: { backgroundColor: BLACK, padding: 16, marginBottom: 1 },
  lbl: { color: GREY, fontSize: 11, marginBottom: 8, letterSpacing: 0.5 },
  orderCard: { backgroundColor: DARK, borderRadius: 14, padding: 14, borderWidth: 0.5, borderColor: '#333', flexDirection: 'row', alignItems: 'center', gap: 12 },
  orderImg: { width: 52, height: 52, backgroundColor: '#333', borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  orderEmoji: { fontSize: 24 },
  orderInfo: { flex: 1 },
  orderTitle: { color: '#fff', fontSize: 13, fontWeight: '700', fontFamily: 'Inter_700Bold' },
  orderSeller: { color: GREY, fontSize: 11, marginTop: 3 },
  orderPrice: { color: GOLD, fontSize: 18, fontWeight: '800', fontFamily: 'Inter_800ExtraBold' },
  locationCard: { backgroundColor: DARK, borderRadius: 12, padding: 12, borderWidth: 0.5, borderColor: '#333', flexDirection: 'row', gap: 10, alignItems: 'center' },
  locationIcon: { fontSize: 22 },
  locationName: { color: '#fff', fontSize: 13, fontWeight: '700', fontFamily: 'Inter_700Bold' },
  locationSub: { color: GREY, fontSize: 11, marginTop: 2 },
  safeBar: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: '#1a2a3e', borderRadius: 8, padding: 8, marginTop: 8 },
  safeIcon: { color: '#4A90D9', fontSize: 14 },
  safeText: { color: '#4A90D9', fontSize: 11 },
  pinInfo: { color: '#ccc', fontSize: 12, lineHeight: 18, marginBottom: 12 },
  pinHighlight: { color: GOLD, fontWeight: '700', fontFamily: 'Inter_700Bold' },
  pinRow: { flexDirection: 'row', justifyContent: 'center', gap: 10, marginBottom: 16 },
  pinBox: { width: 44, height: 54, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  pinBoxFilled: { backgroundColor: DARK, borderWidth: 2, borderColor: GOLD },
  pinBoxEmpty: { backgroundColor: DARK, borderWidth: 0.5, borderColor: '#444' },
  pinDigit: { color: '#fff', fontSize: 22, fontWeight: '800', fontFamily: 'Inter_800ExtraBold' },
  numpad: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  numKey: { width: '30%', backgroundColor: DARK, borderRadius: 10, padding: 14, alignItems: 'center', borderWidth: 0.5, borderColor: '#333' },
  numKeyEmpty: { backgroundColor: 'transparent', borderColor: 'transparent' },
  numKeyText: { color: '#fff', fontSize: 18, fontWeight: '700', fontFamily: 'Inter_700Bold' },
  numKeyDel: { color: GOLD },
  btnConfirm: { backgroundColor: DARK, borderRadius: 14, padding: 16, alignItems: 'center', borderWidth: 0.5, borderColor: '#444' },
  btnConfirmText: { color: '#555', fontSize: 15, fontWeight: '800', fontFamily: 'Inter_800ExtraBold' },
  pinNote: { color: '#555', fontSize: 10, textAlign: 'center', marginTop: 8 },
});