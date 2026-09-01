// app/my-responses.tsx
// "My responses" — everything this person has offered on OTHER people's
// Wanted posts, with the price they quoted, and the ability to change it
// while the offer is still waiting.
//
// WHY THIS EXISTS (reported 1 Sep 2026: "after posting I want to go back
// and see or edit what I posted"). Three things can be posted in this app
// and only two of them could be found again:
//
//   listing        -> Profile > My listings          (existed)
//   wanted post    -> Profile > My wanted posts      (existed)
//   response       -> nowhere at all                 (this screen)
//
// browse-wanted.tsx inserts the response and then shows "✓ You've
// responded" forever. That tick was the entire record: no way to see what
// price you offered, no way to change it. Quote $30 when you meant $300
// and it was simply gone.
//
// The database was already ready for this and had been all along — the
// policies are exactly right:
//
//   item_responses_select_owner_or_responder   read your own
//   item_responses_update_own                  edit your own
//   item_responses_delete_own                  withdraw your own
//
// and the prevent_item_response_privilege_escalation trigger refuses any
// change to status, commission_paid or commission_amount from a normal
// caller. So a responder can move their own price and message and nothing
// else — they cannot mark their own offer accepted or its commission
// paid. Only the screen was missing.
//
// WHAT IS EDITABLE, AND WHY THE LINE IS THERE:
//   waiting   -> price and message editable, offer can be withdrawn
//   accepted  -> read-only. The buyer has accepted at that price and paid
//                a commission calculated FROM it; letting the seller move
//                it afterwards would make the amount they were charged
//                wrong retroactively. Opens the chat instead.
//   closed    -> read-only. The want was matched with someone else, or is
//                no longer open. Nothing to change.
//
// Two queries rather than a PostgREST embed, matching the pattern
// my-wanted-posts.tsx already uses on the mirror-image data — one less
// thing depending on a foreign-key relationship being named the way the
// embed syntax expects.

import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator, Alert, FlatList, Keyboard, Modal, Platform, RefreshControl,
  ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { supabase } from '../../lib/supabase';

const GOLD = '#B8860B';
const BLACK = '#1A1A18';
const DARK = '#2a2a2a';
const GREY = '#AAAAAA';
const GREEN = '#4fc96e';

type MyResponse = {
  id: string;
  item_request_id: string;
  price: number | null;
  message: string | null;
  status: string;
  created_at: string;
  // From the want it was made against.
  requestTitle: string;
  requestStatus: string;
  requestOwnerId: string | null;
  requestLocation: string | null;
};

/** Waiting / Accepted / Not selected / Closed — from BOTH statuses. */
function offerState(r: MyResponse): 'waiting' | 'accepted' | 'declined' | 'closed' {
  if (r.status === 'accepted') return 'accepted';
  if (r.status === 'declined') return 'declined';
  // Still pending on this side, but the want itself has moved on — the
  // buyer matched with somebody else. Showing this as "waiting" would be
  // a small lie the person acts on by continuing to wait.
  if (r.requestStatus !== 'open') return 'closed';
  return 'waiting';
}

const STATE_LABEL: Record<string, string> = {
  waiting: 'Waiting',
  accepted: 'Accepted',
  declined: 'Not selected',
  closed: 'Closed',
};

const STATE_COLOUR: Record<string, string> = {
  waiting: GOLD,
  accepted: GREEN,
  declined: GREY,
  closed: GREY,
};

function formatDate(iso: string): string {
  try {
    return new Date(iso.replace(' ', 'T')).toLocaleDateString(undefined, {
      day: 'numeric', month: 'short',
    });
  } catch {
    return '';
  }
}

export default function MyResponsesScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [needsAccount, setNeedsAccount] = useState(false);
  const [responses, setResponses] = useState<MyResponse[]>([]);

  const [editing, setEditing] = useState<MyResponse | null>(null);
  const [editPrice, setEditPrice] = useState('');
  const [editMessage, setEditMessage] = useState('');
  const [saving, setSaving] = useState(false);
  const [editError, setEditError] = useState('');

  // Same approach as chat.tsx's Meet & Pay sheet, for the same reason: a
  // React Native <Modal> renders in its own native view hierarchy, so no
  // KeyboardAvoidingView on this screen can reach inside it. Measuring the
  // keyboard directly is the one thing that behaves the same on both
  // platforms.
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  useEffect(() => {
    if (Platform.OS === 'web') return;
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const showSub = Keyboard.addListener(showEvent, (e: any) =>
      setKeyboardHeight(e?.endCoordinates?.height ?? 0)
    );
    const hideSub = Keyboard.addListener(hideEvent, () => setKeyboardHeight(0));
    return () => { showSub.remove(); hideSub.remove(); };
  }, []);

  // Refetch on focus, not just on mount: coming back from the chat after a
  // buyer accepted should show "Accepted", not the stale "Waiting" this
  // screen was left on.
  useFocusEffect(useCallback(() => { fetchMine(); }, []));

  async function fetchMine() {
    const { data: { user } } = await supabase.auth.getUser();
    // Anonymous sessions can respond to a want, but "everything I have
    // ever offered" is a come-back-later history and an anonymous session
    // cannot durably carry one. Same line messages.tsx and
    // my-wanted-posts.tsx already draw.
    if (!user || user.is_anonymous) {
      setNeedsAccount(true);
      setLoading(false);
      return;
    }

    const { data: mine } = await supabase
      .from('item_responses')
      .select('id, item_request_id, price, message, status, created_at')
      .eq('responder_id', user.id)
      .order('created_at', { ascending: false });

    if (!mine || mine.length === 0) {
      setResponses([]);
      setLoading(false);
      return;
    }

    const requestIds = Array.from(new Set(mine.map((r: any) => r.item_request_id)));
    const { data: requests } = await supabase
      .from('item_requests')
      .select('id, title, status, user_id, location')
      .in('id', requestIds);

    const byId: Record<string, any> = {};
    (requests ?? []).forEach((r: any) => { byId[r.id] = r; });

    setResponses(
      mine.map((r: any) => ({
        ...r,
        // A want can be deleted out from under a response. Say so rather
        // than rendering a blank card.
        requestTitle: byId[r.item_request_id]?.title ?? 'This want was removed',
        requestStatus: byId[r.item_request_id]?.status ?? 'closed',
        requestOwnerId: byId[r.item_request_id]?.user_id ?? null,
        requestLocation: byId[r.item_request_id]?.location ?? null,
      }))
    );
    setLoading(false);
  }

  async function handleRefresh() {
    setRefreshing(true);
    await fetchMine();
    setRefreshing(false);
  }

  function openEditor(r: MyResponse) {
    setEditing(r);
    setEditPrice(r.price != null ? String(r.price) : '');
    setEditMessage(r.message ?? '');
    setEditError('');
  }

  async function saveEdit() {
    if (!editing) return;
    const priceNum = parseFloat(editPrice);
    if (!editPrice.trim() || Number.isNaN(priceNum) || priceNum <= 0) {
      setEditError('Enter the price you are offering.');
      return;
    }

    setEditError('');
    setSaving(true);

    // Only price and message. status and the commission fields are
    // deliberately absent — the database would refuse them anyway
    // (prevent_item_response_privilege_escalation), and sending them would
    // turn a clear refusal into a confusing one.
    const { error } = await supabase
      .from('item_responses')
      .update({ price: priceNum, message: editMessage.trim() || null })
      .eq('id', editing.id);

    setSaving(false);

    if (error) {
      setEditError(error.message);
      return;
    }

    setEditing(null);
    await fetchMine();
  }

  async function withdraw(r: MyResponse) {
    const confirmed = await new Promise<boolean>((resolve) => {
      Alert.alert(
        'Withdraw this offer?',
        'The buyer will no longer see your price. You can respond again later while the want is still open.',
        [
          { text: 'Keep it', style: 'cancel', onPress: () => resolve(false) },
          { text: 'Withdraw', style: 'destructive', onPress: () => resolve(true) },
        ]
      );
    });
    if (!confirmed) return;

    const { error } = await supabase.from('item_responses').delete().eq('id', r.id);
    if (error) {
      Alert.alert('Could not withdraw', error.message);
      return;
    }
    setEditing(null);
    await fetchMine();
  }

  function handleCardPress(r: MyResponse) {
    const state = offerState(r);
    if (state === 'waiting') {
      openEditor(r);
      return;
    }
    if (state === 'accepted' && r.requestOwnerId) {
      router.push(`/chat?item_request_id=${r.item_request_id}&receiver_id=${r.requestOwnerId}`);
      return;
    }
    // declined / closed: nothing useful to do. Deliberately silent rather
    // than an alert saying "you can't do anything here" — the card already
    // says Not selected or Closed.
  }

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={GOLD} />
      </View>
    );
  }

  if (needsAccount) {
    return (
      <View style={styles.container}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()}>
            <Text style={styles.backText}><Text style={styles.backArrow}>‹</Text> Back</Text>
          </TouchableOpacity>
          <Text style={styles.heading}>My responses</Text>
        </View>
        <View style={styles.needsAccountCard}>
          <Text style={styles.needsAccountIcon}>🏷️</Text>
          <Text style={styles.needsAccountTitle}>Keep track of what you've offered</Text>
          <Text style={styles.needsAccountBody}>
            You can respond to a want without an account — but a free account lets you come
            back, see every price you've offered, and change one before the buyer decides.
          </Text>
          <TouchableOpacity style={styles.needsAccountBtn} onPress={() => router.push('/register')}>
            <Text style={styles.needsAccountBtnText}>Create free account</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => router.push('/login')}>
            <Text style={styles.needsAccountLoginLink}>Already have an account? Sign in</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  const waitingCount = responses.filter((r) => offerState(r) === 'waiting').length;

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()}>
          <Text style={styles.backText}><Text style={styles.backArrow}>‹</Text> Back</Text>
        </TouchableOpacity>
        <Text style={styles.heading}>My responses</Text>
        <Text style={styles.subheading}>
          {responses.length === 0
            ? 'Prices you have offered on other people’s wants'
            : `${responses.length} offer${responses.length !== 1 ? 's' : ''}${waitingCount > 0 ? ` · ${waitingCount} still waiting — tap to change your price` : ''}`}
        </Text>
      </View>

      <FlatList
        data={responses}
        keyExtractor={(item) => item.id}
        style={styles.listContainer}
        contentContainerStyle={[styles.list, { paddingBottom: 16 + insets.bottom }]}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={GOLD} />}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyEmoji}>🏷️</Text>
            <Text style={styles.emptyText}>You haven't responded to anything yet.</Text>
            <Text style={styles.emptySubtext}>
              Browse what people are looking for and respond with your price — it's free.
            </Text>
            <TouchableOpacity style={styles.postBtn} onPress={() => router.push('/browse-wanted')}>
              <Text style={styles.postBtnText}>See what people want</Text>
            </TouchableOpacity>
          </View>
        }
        renderItem={({ item }) => {
          const state = offerState(item);
          const isEditable = state === 'waiting';
          return (
            <TouchableOpacity
              style={[styles.card, !isEditable && state !== 'accepted' && styles.cardMuted]}
              activeOpacity={state === 'declined' || state === 'closed' ? 1 : 0.85}
              onPress={() => handleCardPress(item)}
            >
              <View style={styles.cardTop}>
                <Text style={styles.cardTitle} numberOfLines={1}>{item.requestTitle}</Text>
                <View style={[styles.statusBadge, { borderColor: STATE_COLOUR[state] }]}>
                  <Text style={[styles.statusBadgeText, { color: STATE_COLOUR[state] }]}>
                    {STATE_LABEL[state]}
                  </Text>
                </View>
              </View>

              <View style={styles.priceRow}>
                <Text style={styles.priceLabel}>Your price</Text>
                <Text style={[styles.priceValue, !isEditable && { color: GREY }]}>
                  {item.price != null ? `$${item.price}` : '—'}
                </Text>
              </View>

              {item.message ? (
                <Text style={styles.messageText} numberOfLines={2}>{item.message}</Text>
              ) : null}

              <View style={styles.cardFooter}>
                <Text style={styles.dateText}>
                  {item.requestLocation ? `📍 ${item.requestLocation} · ` : ''}
                  Offered {formatDate(item.created_at)}
                </Text>
                <Text style={[styles.actionHint, { color: isEditable || state === 'accepted' ? GOLD : '#4a4a4a' }]}>
                  {isEditable ? 'Edit →' : state === 'accepted' ? 'Open chat →' : ''}
                </Text>
              </View>
            </TouchableOpacity>
          );
        }}
      />

      <Modal
        visible={!!editing}
        animationType="slide"
        transparent
        onRequestClose={() => setEditing(null)}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.modalSheet, keyboardHeight > 0 && { marginBottom: keyboardHeight }]}>
            <ScrollView keyboardShouldPersistTaps="handled">
              <Text style={styles.modalTitle}>Change your offer</Text>
              <Text style={styles.modalBody} numberOfLines={2}>
                {editing?.requestTitle}
              </Text>

              {editError ? <Text style={styles.modalError}>⚠️ {editError}</Text> : null}

              <Text style={styles.modalLabel}>Your price (USD) *</Text>
              <TextInput
                style={styles.input}
                value={editPrice}
                onChangeText={setEditPrice}
                placeholder="e.g. 260"
                placeholderTextColor="#555"
                keyboardType="decimal-pad"
              />

              <Text style={styles.modalLabel}>Message (optional)</Text>
              <TextInput
                style={[styles.input, styles.inputMultiline]}
                value={editMessage}
                onChangeText={setEditMessage}
                placeholder="Condition, extras, anything the buyer should know..."
                placeholderTextColor="#555"
                multiline
                numberOfLines={3}
                maxLength={300}
              />

              <TouchableOpacity
                style={[styles.saveBtn, saving && { opacity: 0.6 }]}
                onPress={saveEdit}
                disabled={saving}
              >
                {saving
                  ? <ActivityIndicator color={BLACK} />
                  : <Text style={styles.saveBtnText}>Save changes</Text>}
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.withdrawBtn}
                onPress={() => editing && withdraw(editing)}
                disabled={saving}
              >
                <Text style={styles.withdrawBtnText}>Withdraw this offer</Text>
              </TouchableOpacity>

              <TouchableOpacity style={styles.cancelLink} onPress={() => setEditing(null)}>
                <Text style={styles.cancelLinkText}>Cancel</Text>
              </TouchableOpacity>
            </ScrollView>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#111111' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#111111' },

  header: {
    backgroundColor: BLACK,
    paddingTop: Platform.OS === 'ios' ? 56 : 32,
    paddingBottom: 20, paddingHorizontal: 20,
    borderBottomWidth: 0.5, borderBottomColor: DARK,
  },
  backText: { color: GREY, fontSize: 14, marginBottom: 12 },
  backArrow: { fontSize: 20 },
  heading: { color: '#fff', fontSize: 22, fontWeight: '800' },
  subheading: { color: GREY, fontSize: 13, marginTop: 4 },

  needsAccountCard: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  needsAccountIcon: { fontSize: 48, marginBottom: 20 },
  needsAccountTitle: { color: '#fff', fontSize: 18, fontWeight: '800', textAlign: 'center', marginBottom: 12 },
  needsAccountBody: { color: GREY, fontSize: 13, textAlign: 'center', lineHeight: 20, marginBottom: 28 },
  needsAccountBtn: { backgroundColor: GOLD, borderRadius: 14, paddingVertical: 16, paddingHorizontal: 40, marginBottom: 16 },
  needsAccountBtnText: { color: BLACK, fontSize: 15, fontWeight: '800' },
  needsAccountLoginLink: { color: GREY, fontSize: 13 },

  // `style` as well as contentContainerStyle — without a bounded height a
  // FlatList sizes to its content and stops scrolling once it overflows.
  // Same bug already fixed in operator-requests.tsx and my-wanted-posts.tsx.
  listContainer: { flex: 1 },
  list: { padding: 16 },
  // marginBottom on the card rather than `gap` on the container: `gap` has
  // proven unreliable at list boundaries in this codebase before.
  card: {
    backgroundColor: BLACK, borderRadius: 14, padding: 16,
    borderWidth: 0.5, borderColor: '#333', marginBottom: 14,
  },
  cardMuted: { opacity: 0.55 },
  cardTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10, marginBottom: 10 },
  cardTitle: { color: '#fff', fontSize: 15, fontWeight: '700', flex: 1 },
  statusBadge: { borderRadius: 20, paddingHorizontal: 10, paddingVertical: 3, borderWidth: 1 },
  statusBadgeText: { fontSize: 10, fontWeight: '800' },

  priceRow: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 8 },
  priceLabel: { color: GREY, fontSize: 12 },
  priceValue: { color: GOLD, fontSize: 20, fontWeight: '800' },

  messageText: { color: GREY, fontSize: 12, lineHeight: 17, marginBottom: 10 },

  cardFooter: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 10, paddingTop: 10, borderTopWidth: 0.5, borderTopColor: '#2a2a2a' },
  dateText: { color: '#6f6f6f', fontSize: 11, flex: 1 },
  actionHint: { fontSize: 12, fontWeight: '700' },

  empty: { alignItems: 'center', paddingTop: 60, paddingHorizontal: 30 },
  emptyEmoji: { fontSize: 40, marginBottom: 12 },
  emptyText: { fontSize: 16, color: '#fff', fontWeight: '600', textAlign: 'center' },
  emptySubtext: { fontSize: 13, color: GREY, marginTop: 6, textAlign: 'center', lineHeight: 18 },
  postBtn: { backgroundColor: GOLD, borderRadius: 20, paddingHorizontal: 18, paddingVertical: 10, marginTop: 18 },
  postBtnText: { color: BLACK, fontSize: 13, fontWeight: '800' },

  modalOverlay: { flex: 1, width: '100%', backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end', alignItems: 'center' },
  modalSheet: {
    width: '100%', maxWidth: 640, alignSelf: 'center', maxHeight: '85%',
    backgroundColor: BLACK, borderTopLeftRadius: 22, borderTopRightRadius: 22,
    padding: 24, paddingBottom: 34,
  },
  modalTitle: { color: '#fff', fontSize: 19, fontWeight: '800', marginBottom: 6 },
  modalBody: { color: GREY, fontSize: 13, lineHeight: 19, marginBottom: 18 },
  modalError: { color: '#ff8a8a', fontSize: 13, marginBottom: 12 },
  modalLabel: { color: '#fff', fontSize: 13, fontWeight: '700', marginBottom: 8 },
  input: {
    backgroundColor: DARK, borderRadius: 12, padding: 14,
    color: '#fff', fontSize: 14,
    borderWidth: 0.5, borderColor: '#333', marginBottom: 16,
  },
  inputMultiline: { minHeight: 80, textAlignVertical: 'top', lineHeight: 20 },

  saveBtn: { backgroundColor: GOLD, borderRadius: 14, paddingVertical: 16, alignItems: 'center', marginBottom: 10 },
  saveBtnText: { color: BLACK, fontSize: 15, fontWeight: '800' },
  withdrawBtn: { borderRadius: 14, paddingVertical: 14, alignItems: 'center', borderWidth: 0.5, borderColor: '#5a2a2a', marginBottom: 6 },
  withdrawBtnText: { color: '#e0796b', fontSize: 13, fontWeight: '700' },
  cancelLink: { alignItems: 'center', paddingVertical: 10 },
  cancelLinkText: { color: GREY, fontSize: 13 },
});
