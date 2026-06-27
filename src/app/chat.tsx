import { StatusBar } from 'expo-status-bar';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

const GOLD = '#B8860B';
const BLACK = '#1A1A18';
const DARK = '#2a2a2a';
const GREY = '#AAAAAA';

const messages = [
  { id: 1, sender: 'seller', text: 'Hello! Yes the phone is still available. Battery health is 89% and no scratches at all.', time: '9:15 AM' },
  { id: 2, sender: 'buyer', text: 'Great! Can we meet at Sam Levy\'s today around 3pm? I prefer Meet & Pay.', time: '9:18 AM' },
  { id: 3, sender: 'seller', text: '3pm works perfectly. I\'ll be near the main entrance. See you then!', time: '9:20 AM' },
  { id: 4, sender: 'buyer', text: 'Perfect. Will you take $300?', time: '9:22 AM' },
  { id: 5, sender: 'seller', text: 'Best I can do is $310. Final price.', time: '9:25 AM' },
];

export default function ChatScreen() {
  return (
    <View style={styles.container}>
      <StatusBar style="light" />

      {/* Header */}
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <Text style={styles.backBtn}>←</Text>
          <View style={styles.avatarWrap}>
            <View style={styles.avatar}>
              <Text style={styles.avatarText}>TM</Text>
            </View>
            <View style={styles.onlineDot} />
          </View>
          <View>
            <Text style={styles.sellerName}>Tatenda Moyo</Text>
            <Text style={styles.onlineStatus}>Online now</Text>
          </View>
        </View>
        <View style={styles.headerIcons}>
          <Text style={styles.headerIcon}>📞</Text>
          <Text style={styles.headerIcon}>⋮</Text>
        </View>
      </View>

      {/* Listing bar */}
      <View style={styles.listingBar}>
        <View style={styles.listingThumb}>
          <Text style={styles.listingEmoji}>📱</Text>
        </View>
        <View style={styles.listingInfo}>
          <Text style={styles.listingTitle}>iPhone 13 Pro 256GB</Text>
          <Text style={styles.listingPrice}>$310</Text>
        </View>
        <TouchableOpacity style={styles.viewBtn}>
          <Text style={styles.viewBtnText}>View listing</Text>
        </TouchableOpacity>
      </View>

      {/* Contact blocker warning */}
      <View style={styles.warningBar}>
        <Text style={styles.warningIcon}>🔒</Text>
        <Text style={styles.warningText}>Contact details are hidden until 5% deposit is paid</Text>
      </View>

      {/* Messages */}
      <ScrollView style={styles.messages} showsVerticalScrollIndicator={false}>
        <View style={styles.dateStamp}>
          <Text style={styles.dateText}>Today</Text>
        </View>

        {messages.map((msg) => (
          <View key={msg.id} style={[styles.msgRow, msg.sender === 'buyer' && styles.msgRowMine]}>
            {msg.sender === 'seller' && (
              <View style={styles.msgAvatar}>
                <Text style={styles.msgAvatarText}>TM</Text>
              </View>
            )}
            <View style={styles.bubble}>
              <View style={msg.sender === 'seller' ? styles.bubbleSeller : styles.bubbleBuyer}>
                <Text style={msg.sender === 'seller' ? styles.bubbleTextSeller : styles.bubbleTextBuyer}>
                  {msg.text}
                </Text>
              </View>
              <Text style={[styles.msgTime, msg.sender === 'buyer' && styles.msgTimeMine]}>
                {msg.time}{msg.sender === 'buyer' ? ' · ✓✓' : ''}
              </Text>
            </View>
          </View>
        ))}

        {/* Meet & Pay prompt */}
        <View style={styles.meetPayCard}>
          <View style={styles.meetPayHeader}>
            <Text style={styles.meetPayIcon}>📍</Text>
            <Text style={styles.meetPayTitle}>Ready to trade?</Text>
          </View>
          <Text style={styles.meetPayText}>
            You have agreed on $310. Pay the 5% deposit ($15.50) now to unlock each other's phone numbers and confirm the meetup.
          </Text>
          <TouchableOpacity style={styles.depositBtn}>
            <Text style={styles.depositBtnText}>Pay 5% Deposit — $15.50</Text>
          </TouchableOpacity>
        </View>

        {/* Typing indicator */}
        <View style={styles.msgRow}>
          <View style={styles.msgAvatar}>
            <Text style={styles.msgAvatarText}>TM</Text>
          </View>
          <View style={styles.typingBubble}>
            <View style={styles.typingDot} />
            <View style={[styles.typingDot, { opacity: 0.5 }]} />
            <View style={[styles.typingDot, { opacity: 0.3 }]} />
          </View>
        </View>

        <View style={{ height: 80 }} />
      </ScrollView>

      {/* Input */}
      <View style={styles.inputRow}>
        <Text style={styles.attachIcon}>📎</Text>
        <View style={styles.inputBar}>
          <Text style={styles.inputPlaceholder}>Type a message... (contact details are hidden)</Text>
        </View>
        <TouchableOpacity style={styles.sendBtn}>
          <Text style={styles.sendIcon}>➤</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#111111' },
  header: { backgroundColor: BLACK, padding: 16, paddingTop: 50, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  backBtn: { color: '#fff', fontSize: 22 },
  avatarWrap: { position: 'relative' },
  avatar: { width: 38, height: 38, backgroundColor: GOLD, borderRadius: 19, alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: BLACK, fontSize: 14, fontWeight: '800', fontFamily: 'Inter_800ExtraBold' },
  onlineDot: { position: 'absolute', bottom: 0, right: 0, width: 10, height: 10, backgroundColor: '#4A90D9', borderRadius: 5, borderWidth: 2, borderColor: BLACK },
  sellerName: { color: '#fff', fontSize: 14, fontWeight: '700', fontFamily: 'Inter_700Bold' },
  onlineStatus: { color: '#4A90D9', fontSize: 11 },
  headerIcons: { flexDirection: 'row', gap: 14 },
  headerIcon: { color: GOLD, fontSize: 20 },
  listingBar: { backgroundColor: DARK, padding: 10, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', gap: 10, borderBottomWidth: 0.5, borderBottomColor: '#333' },
  listingThumb: { width: 38, height: 38, backgroundColor: '#333', borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  listingEmoji: { fontSize: 18 },
  listingInfo: { flex: 1 },
  listingTitle: { color: '#fff', fontSize: 12, fontWeight: '700', fontFamily: 'Inter_700Bold' },
  listingPrice: { color: GOLD, fontSize: 12, fontWeight: '800', fontFamily: 'Inter_800ExtraBold' },
  viewBtn: { backgroundColor: '#3a2800', borderRadius: 20, paddingHorizontal: 10, paddingVertical: 4, borderWidth: 0.5, borderColor: GOLD },
  viewBtnText: { color: GOLD, fontSize: 10 },
  warningBar: { backgroundColor: '#1a1a2e', padding: 8, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', gap: 8, borderBottomWidth: 0.5, borderBottomColor: '#333' },
  warningIcon: { fontSize: 14 },
  warningText: { color: '#8888ff', fontSize: 11, flex: 1 },
  messages: { flex: 1, backgroundColor: '#111', padding: 16 },
  dateStamp: { alignItems: 'center', marginBottom: 16 },
  dateText: { color: '#444', fontSize: 10, backgroundColor: '#1a1a1a', paddingHorizontal: 10, paddingVertical: 3, borderRadius: 20 },
  msgRow: { flexDirection: 'row', gap: 8, marginBottom: 14, alignItems: 'flex-end' },
  msgRowMine: { justifyContent: 'flex-end' },
  msgAvatar: { width: 28, height: 28, backgroundColor: GOLD, borderRadius: 14, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  msgAvatarText: { color: BLACK, fontSize: 10, fontWeight: '800', fontFamily: 'Inter_800ExtraBold' },
  bubble: { maxWidth: '70%' },
  bubbleSeller: { backgroundColor: DARK, borderRadius: 14, borderBottomLeftRadius: 2, padding: 10, borderWidth: 0.5, borderColor: '#333' },
  bubbleBuyer: { backgroundColor: GOLD, borderRadius: 14, borderBottomRightRadius: 2, padding: 10 },
  bubbleTextSeller: { color: '#fff', fontSize: 13, lineHeight: 20 },
  bubbleTextBuyer: { color: BLACK, fontSize: 13, lineHeight: 20 },
  msgTime: { color: '#444', fontSize: 10, marginTop: 3 },
  msgTimeMine: { textAlign: 'right' },
  meetPayCard: { backgroundColor: DARK, borderRadius: 12, padding: 12, borderWidth: 1, borderColor: GOLD, marginBottom: 14 },
  meetPayHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  meetPayIcon: { fontSize: 16 },
  meetPayTitle: { color: GOLD, fontSize: 12, fontWeight: '700', fontFamily: 'Inter_700Bold' },
  meetPayText: { color: '#ccc', fontSize: 11, lineHeight: 18, marginBottom: 10 },
  depositBtn: { backgroundColor: GOLD, borderRadius: 10, padding: 10, alignItems: 'center' },
  depositBtnText: { color: BLACK, fontSize: 12, fontWeight: '800', fontFamily: 'Inter_800ExtraBold' },
  typingBubble: { backgroundColor: DARK, borderRadius: 14, borderBottomLeftRadius: 2, padding: 12, flexDirection: 'row', gap: 4, alignItems: 'center', borderWidth: 0.5, borderColor: '#333' },
  typingDot: { width: 6, height: 6, backgroundColor: GOLD, borderRadius: 3 },
  inputRow: { backgroundColor: BLACK, padding: 10, paddingHorizontal: 16, paddingBottom: 30, flexDirection: 'row', alignItems: 'center', gap: 10, borderTopWidth: 0.5, borderTopColor: DARK },
  attachIcon: { fontSize: 20, color: GREY },
  inputBar: { flex: 1, backgroundColor: DARK, borderRadius: 24, padding: 10, paddingHorizontal: 16, borderWidth: 0.5, borderColor: '#333' },
  inputPlaceholder: { color: '#555', fontSize: 13 },
  sendBtn: { width: 40, height: 40, backgroundColor: GOLD, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  sendIcon: { color: BLACK, fontSize: 18 },
});