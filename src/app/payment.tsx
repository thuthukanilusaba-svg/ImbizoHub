import { StatusBar } from 'expo-status-bar';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

const GOLD = '#B8860B';
const BLACK = '#1A1A18';
const DARK = '#2a2a2a';
const GREY = '#AAAAAA';

export default function PaymentScreen() {
  return (
    <View style={styles.container}>
      <StatusBar style="light" />
      <ScrollView showsVerticalScrollIndicator={false}>

        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.backBtn}>←</Text>
          <Text style={styles.headerTitle}>Choose payment path</Text>
          <Text style={styles.helpIcon}>?</Text>
        </View>

        {/* Steps */}
        <View style={styles.steps}>
          <View style={styles.step}>
            <View style={styles.stepDone}><Text style={styles.stepDoneText}>✓</Text></View>
            <Text style={styles.stepLabelDone}>Agreed{'\n'}price</Text>
          </View>
          <View style={styles.lineDone} />
          <View style={styles.step}>
            <View style={styles.stepDone}><Text style={styles.stepDoneText}>✓</Text></View>
            <Text style={styles.stepLabelDone}>5%{'\n'}deposit</Text>
          </View>
          <View style={styles.lineActive} />
          <View style={styles.step}>
            <View style={styles.stepActive}><Text style={styles.stepActiveText}>3</Text></View>
            <Text style={styles.stepLabelActive}>Choose{'\n'}path</Text>
          </View>
          <View style={styles.linePending} />
          <View style={styles.step}>
            <View style={styles.stepPending}><Text style={styles.stepPendingText}>4</Text></View>
            <Text style={styles.stepLabelPending}>Meet &{'\n'}complete</Text>
          </View>
        </View>

        {/* Deposit confirmed */}
        <View style={styles.section}>
          <View style={styles.confirmedCard}>
            <View style={styles.confirmedTitle}>
              <Text style={styles.confirmedIcon}>✓</Text>
              <Text style={styles.confirmedTitleText}>5% Deposit secured in escrow</Text>
            </View>
            <View style={styles.confirmedRow}>
              <Text style={styles.confirmedLabel}>Item</Text>
              <Text style={styles.confirmedVal}>iPhone 13 Pro 256GB</Text>
            </View>
            <View style={styles.confirmedRow}>
              <Text style={styles.confirmedLabel}>Agreed price</Text>
              <Text style={styles.confirmedVal}>$310</Text>
            </View>
            <View style={styles.confirmedRow}>
              <Text style={styles.confirmedLabel}>Deposit paid (5%)</Text>
              <Text style={styles.confirmedValGreen}>$15.50 secured ✓</Text>
            </View>
            <View style={styles.confirmedRow}>
              <Text style={styles.confirmedLabel}>ImbizoHub commission</Text>
              <Text style={styles.confirmedVal}>2% ($6.20)</Text>
            </View>
          </View>

          {/* Phone revealed */}
          <View style={styles.phoneCard}>
            <View style={styles.phoneTitle}>
              <Text style={styles.phoneIcon}>📞</Text>
              <Text style={styles.phoneTitleText}>Phone numbers unlocked</Text>
            </View>
            <View style={styles.phoneRow}>
              <View>
                <Text style={styles.phonePerson}>Seller — Tatenda Moyo</Text>
                <Text style={styles.phoneNumber}>+263 77 123 4567</Text>
              </View>
              <TouchableOpacity style={styles.callBtn}>
                <Text style={styles.callBtnText}>Call</Text>
              </TouchableOpacity>
            </View>
            <View style={styles.divider} />
            <View style={styles.phoneRow}>
              <View>
                <Text style={styles.phonePerson}>Your number (shown to seller)</Text>
                <Text style={styles.phoneNumber}>+263 78 987 6543</Text>
              </View>
            </View>
          </View>
        </View>

        {/* Path selection */}
        <View style={styles.section}>
          <Text style={styles.pathTitle}>How do you want to pay the remaining $294.50?</Text>
          <Text style={styles.pathSubtitle}>Choose your payment path. You can discuss with the seller before deciding.</Text>

          {/* Path A */}
          <View style={styles.pathCardA}>
            <View style={styles.pathHeader}>
              <Text style={styles.pathName}>Path A — Full escrow</Text>
              <View style={styles.badgeRecommended}>
                <Text style={styles.badgeRecommendedText}>RECOMMENDED</Text>
              </View>
            </View>
            <View style={styles.pathDetail}>
              <View style={styles.dotGold} />
              <Text style={styles.pathDetailText}>Remaining $294.50 held safely in ImbizoHub</Text>
            </View>
            <View style={styles.pathDetail}>
              <View style={styles.dotGold} />
              <Text style={styles.pathDetailText}>Full buyer protection on entire amount</Text>
            </View>
            <View style={styles.pathDetail}>
              <View style={styles.dotGold} />
              <Text style={styles.pathDetailText}>PIN entered at meetup releases money to seller</Text>
            </View>
            <View style={styles.pathDetail}>
              <View style={styles.dotGold} />
              <Text style={styles.pathDetailText}>Raise a dispute if item not as described</Text>
            </View>
            <View style={styles.pathAmount}>
              <Text style={styles.pathAmountLabel}>Remaining to pay via app</Text>
              <Text style={styles.pathAmountVal}>$294.50</Text>
            </View>
          </View>

          {/* Path B */}
          <View style={styles.pathCardB}>
            <View style={styles.pathHeader}>
              <Text style={styles.pathName}>Path B — Pay directly</Text>
              <View style={styles.badgeFlexible}>
                <Text style={styles.badgeFlexibleText}>FLEXIBLE</Text>
              </View>
            </View>
            <View style={styles.pathDetail}>
              <View style={styles.dotGrey} />
              <Text style={styles.pathDetailTextGrey}>Pay remaining $294.50 by cash, EcoCash or bank transfer</Text>
            </View>
            <View style={styles.pathDetail}>
              <View style={styles.dotGrey} />
              <Text style={styles.pathDetailTextGrey}>5% deposit ($15.50) kept by ImbizoHub as platform fee</Text>
            </View>
            <View style={styles.pathDetail}>
              <View style={styles.dotGrey} />
              <Text style={styles.pathDetailTextGrey}>No ImbizoHub protection on the remaining $294.50</Text>
            </View>
            <View style={styles.pathAmount}>
              <Text style={styles.pathAmountLabel}>Remaining to pay directly</Text>
              <Text style={styles.pathAmountValGrey}>$294.50</Text>
            </View>
          </View>

          {/* Warning */}
          <View style={styles.warningBox}>
            <Text style={styles.warningIcon}>⚠️</Text>
            <Text style={styles.warningText}>If you choose Path B and something goes wrong, ImbizoHub cannot help you recover the $294.50. Choose Path A for full protection.</Text>
          </View>
        </View>

        {/* Buttons */}
        <View style={styles.section}>
          <TouchableOpacity style={styles.btnPrimary}>
            <Text style={styles.btnPrimaryText}>✓ Choose Path A — Full protection</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.btnSecondary}>
            <Text style={styles.btnSecondaryText}>Choose Path B — Pay directly</Text>
          </TouchableOpacity>
          <Text style={styles.note}>Both parties must confirm their choice.{'\n'}Your 5% deposit is secured either way.</Text>
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
  stepActiveText: { color: BLACK, fontSize: 12, fontWeight: '800', fontFamily: 'Inter_800ExtraBold' },
  stepPending: { width: 28, height: 28, borderRadius: 14, backgroundColor: DARK, borderWidth: 0.5, borderColor: '#444', alignItems: 'center', justifyContent: 'center' },
  stepPendingText: { color: '#555', fontSize: 12, fontWeight: '800', fontFamily: 'Inter_800ExtraBold' },
  stepLabelDone: { color: '#4A90D9', fontSize: 9, textAlign: 'center', lineHeight: 13 },
  stepLabelActive: { color: GOLD, fontSize: 9, textAlign: 'center', lineHeight: 13 },
  stepLabelPending: { color: '#555', fontSize: 9, textAlign: 'center', lineHeight: 13 },
  lineDone: { height: 2, width: 32, backgroundColor: '#4A90D9', marginBottom: 14 },
  lineActive: { height: 2, width: 32, backgroundColor: GOLD, marginBottom: 14 },
  linePending: { height: 2, width: 32, backgroundColor: '#333', marginBottom: 14 },
  section: { backgroundColor: BLACK, padding: 16, marginBottom: 1 },
  confirmedCard: { backgroundColor: '#1a2a3e', borderRadius: 14, padding: 14, borderWidth: 1, borderColor: '#4A90D9', marginBottom: 14 },
  confirmedTitle: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 },
  confirmedIcon: { color: '#4A90D9', fontSize: 16 },
  confirmedTitleText: { color: '#4A90D9', fontSize: 13, fontWeight: '800', fontFamily: 'Inter_800ExtraBold' },
  confirmedRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 },
  confirmedLabel: { color: GREY, fontSize: 11 },
  confirmedVal: { color: '#fff', fontSize: 11, fontWeight: '700', fontFamily: 'Inter_700Bold' },
  confirmedValGreen: { color: '#4A90D9', fontSize: 11, fontWeight: '700', fontFamily: 'Inter_700Bold' },
  phoneCard: { backgroundColor: DARK, borderRadius: 14, padding: 14, borderWidth: 1, borderColor: GOLD },
  phoneTitle: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 },
  phoneIcon: { fontSize: 16 },
  phoneTitleText: { color: GOLD, fontSize: 13, fontWeight: '800', fontFamily: 'Inter_800ExtraBold' },
  phoneRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  phonePerson: { color: GREY, fontSize: 11 },
  phoneNumber: { color: '#fff', fontSize: 14, fontWeight: '800', fontFamily: 'Inter_800ExtraBold', letterSpacing: 1 },
  callBtn: { backgroundColor: GOLD, borderRadius: 20, paddingHorizontal: 14, paddingVertical: 5 },
  callBtnText: { color: BLACK, fontSize: 11, fontWeight: '800', fontFamily: 'Inter_800ExtraBold' },
  divider: { height: 0.5, backgroundColor: '#333', marginVertical: 10 },
  pathTitle: { color: '#fff', fontSize: 14, fontWeight: '800', fontFamily: 'Inter_800ExtraBold', marginBottom: 4 },
  pathSubtitle: { color: GREY, fontSize: 11, marginBottom: 14, lineHeight: 18 },
  pathCardA: { backgroundColor: DARK, borderRadius: 14, padding: 16, borderWidth: 2, borderColor: GOLD, marginBottom: 12 },
  pathCardB: { backgroundColor: DARK, borderRadius: 14, padding: 16, borderWidth: 0.5, borderColor: '#444', marginBottom: 12 },
  pathHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  pathName: { color: '#fff', fontSize: 14, fontWeight: '800', fontFamily: 'Inter_800ExtraBold' },
  badgeRecommended: { backgroundColor: GOLD, borderRadius: 20, paddingHorizontal: 8, paddingVertical: 3 },
  badgeRecommendedText: { color: BLACK, fontSize: 9, fontWeight: '800', fontFamily: 'Inter_800ExtraBold' },
  badgeFlexible: { backgroundColor: '#333', borderRadius: 20, paddingHorizontal: 8, paddingVertical: 3 },
  badgeFlexibleText: { color: GREY, fontSize: 9, fontWeight: '800', fontFamily: 'Inter_800ExtraBold' },
  pathDetail: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginBottom: 6 },
  dotGold: { width: 6, height: 6, borderRadius: 3, backgroundColor: GOLD, marginTop: 5, flexShrink: 0 },
  dotGrey: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#555', marginTop: 5, flexShrink: 0 },
  pathDetailText: { color: '#ccc', fontSize: 11, lineHeight: 18, flex: 1 },
  pathDetailTextGrey: { color: '#666', fontSize: 11, lineHeight: 18, flex: 1 },
  pathAmount: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 12, paddingTop: 12, borderTopWidth: 0.5, borderTopColor: '#333' },
  pathAmountLabel: { color: GREY, fontSize: 11 },
  pathAmountVal: { color: GOLD, fontSize: 16, fontWeight: '800', fontFamily: 'Inter_800ExtraBold' },
  pathAmountValGrey: { color: '#555', fontSize: 16, fontWeight: '800', fontFamily: 'Inter_800ExtraBold' },
  warningBox: { backgroundColor: '#2a1a1a', borderRadius: 10, padding: 12, borderWidth: 0.5, borderColor: '#7a3800', flexDirection: 'row', gap: 8 },
  warningIcon: { fontSize: 16 },
  warningText: { color: '#FFB347', fontSize: 11, lineHeight: 18, flex: 1 },
  btnPrimary: { backgroundColor: GOLD, borderRadius: 14, padding: 16, alignItems: 'center', marginBottom: 10 },
  btnPrimaryText: { color: BLACK, fontSize: 15, fontWeight: '800', fontFamily: 'Inter_800ExtraBold' },
  btnSecondary: { backgroundColor: DARK, borderRadius: 14, padding: 14, alignItems: 'center', borderWidth: 0.5, borderColor: '#444', marginBottom: 12 },
  btnSecondaryText: { color: GREY, fontSize: 13, fontWeight: '700', fontFamily: 'Inter_700Bold' },
  note: { color: '#555', fontSize: 10, textAlign: 'center', lineHeight: 16 },
});