// app/browse-wanted.tsx
// "Wanted" tab — sellers browse what buyers are looking for and respond
// with a price. Free and open to EVERY account type (buyer, seller,
// delivery operator, transport operator) — deliberately NOT gated behind
// a paid registration like operator-requests.tsx, since responding here
// isn't a professional service with capacity constraints, it's "I happen
// to have this thing." See ImbizoHub_Wanted_Tab_Spec.md Section 5 for
// the reasoning.
//
// FIX: "+ Post a want" moved from the header (top of screen, competing
// for attention with the page title on first load) down to the bottom
// of the list instead — this screen's primary job is browsing and
// responding to EXISTING wants; posting a new one is a secondary,
// occasional action that doesn't need top billing every time someone
// opens this screen.
//
// FIX: the "Your response" Modal (price + message text fields) is
// wrapped in its own KeyboardAvoidingView — React Native's Modal
// component renders in a separate native layer, so a
// KeyboardAvoidingView wrapping the rest of the SCREEN has no effect on
// content inside a Modal. Without this, the price/message fields inside
// the modal were covered by the keyboard the same way every other
// screen's fields were, and wrapping the screen alone wouldn't have
// fixed it — the Modal's own content needs its own wrapper.
//
// FIX: modalSheet's paddingBottom was a hardcoded per-platform guess
// (40 iOS / 24 Android), never accounting for the real device
// safe-area inset — same root cause already fixed on
// operator-requests.tsx and quotes.tsx's modal sheets. On any phone
// with a real gesture-nav bar or home indicator, "Send response" sat
// partially or fully under the phone's OWN system UI, not the app's.
//
// FIX (real staleness bug, found during a thorough review): the
// success message told every responder a chat would open "once they've
// paid ImbizoHub's small commission" — unconditionally, even though
// accepting a Wanted response is currently FREE under the launch promo
// (through Jan 31, 2027). Same category of pricing-text-accuracy issue
// spent real effort fixing across the app earlier — now branches on
// the same isPromoActive() pattern used everywhere else.
//
// FIX (real gap, found during the same review): submitResponse() never
// re-checked that the want was still 'open' before inserting — the
// modal can stay open indefinitely while someone fills in price,
// message, and an optional photo, during which the want could have
// been matched by someone else entirely. Low severity (no money/
// security at stake, just a stray response nobody will ever act on and
// mild confusion for the responder), but worth a real check rather
// than silently allowing it.

import * as ImagePicker from 'expo-image-picker';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Image,
  KeyboardAvoidingView,
  Modal,
  Platform,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { normalizeImageOrientation } from '../../lib/imageOrientation';
import { supabase } from '../../lib/supabase';
import { prepareUpload } from '../../lib/uploadHelpers';

const GOLD = '#B8860B';
const BLACK = '#1A1A18';
const DARK = '#2a2a2a';
const GREY = '#AAAAAA';

// NEW: same launch promo window used everywhere else today — the
// success message needs to know whether accepting is currently free.
const FREE_PROMO_END = new Date('2027-01-31T23:59:59Z');
const isPromoActive = () => new Date() < FREE_PROMO_END;

type ItemRequest = {
  id: string;
  title: string;
  description: string;
  category: string;
  budget_min: number | null;
  budget_max: number | null;
  location: string;
  status: string;
  created_at: string;
};

function budgetLabel(min: number | null, max: number | null): string | null {
  if (min == null && max == null) return null;
  if (min != null && max != null) return `$${min} – $${max}`;
  if (min != null) return `$${min}+`;
  return `Up to $${max}`;
}

export default function BrowseWantedScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [requests, setRequests] = useState<ItemRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [myId, setMyId] = useState('');

  const [myResponseIds, setMyResponseIds] = useState<Set<string>>(new Set());

  const [modalVisible, setModalVisible] = useState(false);
  const [selected, setSelected] = useState<ItemRequest | null>(null);
  const [price, setPrice] = useState('');
  const [message, setMessage] = useState('');
  const [isPhysicalItem, setIsPhysicalItem] = useState(true);
  const [pickedImageUri, setPickedImageUri] = useState<string | null>(null);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [submitError, setSubmitError] = useState('');

  useEffect(() => {
    init();
  }, []);

  async function init() {
    const { data: { user } } = await supabase.auth.getUser();
    if (user) setMyId(user.id);
    await fetchRequests(user?.id);
  }

  async function fetchRequests(uid?: string) {
    setLoading(true);
    const { data } = await supabase
      .from('item_requests')
      .select('*')
      .eq('status', 'open')
      .order('created_at', { ascending: false });
    setRequests(data ?? []);

    const currentUid = uid ?? myId;
    if (currentUid && data && data.length > 0) {
      const ids = data.map((r) => r.id);
      const { data: myResponses } = await supabase
        .from('item_responses')
        .select('item_request_id')
        .eq('responder_id', currentUid)
        .in('item_request_id', ids);
      setMyResponseIds(new Set((myResponses ?? []).map((r) => r.item_request_id)));
    }

    setLoading(false);
  }

  async function handleRefresh() {
    setRefreshing(true);
    await fetchRequests();
    setRefreshing(false);
  }

  function openModal(req: ItemRequest) {
    setSelected(req);
    setPrice('');
    setMessage('');
    setIsPhysicalItem(true);
    setPickedImageUri(null);
    setSubmitted(false);
    setSubmitError('');
    setModalVisible(true);
  }

  async function pickPhoto() {
    setSubmitError('');
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) { setSubmitError('Permission to access photos is required.'); return; }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true, quality: 0.7,
      exif: true,
    });

    if (!result.canceled && result.assets?.[0]) {
      const asset = result.assets[0];
      setPickedImageUri(await normalizeImageOrientation(asset.uri, asset.exif));
    }
  }

  async function takePhoto() {
    setSubmitError('');
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) { setSubmitError('Camera permission is required.'); return; }

    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true, quality: 0.7,
      exif: true,
    });

    if (!result.canceled && result.assets?.[0]) {
      const asset = result.assets[0];
      setPickedImageUri(await normalizeImageOrientation(asset.uri, asset.exif));
    }
  }

  async function submitResponse() {
    setSubmitError('');

    if (!price) {
      setSubmitError('Enter a price.');
      return;
    }
    const priceNum = parseFloat(price);
    if (isNaN(priceNum) || priceNum <= 0) {
      setSubmitError('Enter a valid price.');
      return;
    }

    if (!selected) {
      setSubmitError('Something went wrong. Please try again.');
      return;
    }

    // FIX: re-check the want is still open right before submitting —
    // see top-of-file comment. The modal can stay open a long time
    // (filling in price, message, an optional photo), during which the
    // want could have been matched by someone else. Cheap check, real
    // gap it closes.
    const { data: stillOpen } = await supabase
      .from('item_requests')
      .select('status')
      .eq('id', selected.id)
      .maybeSingle();

    if (!stillOpen || stillOpen.status !== 'open') {
      setSubmitError('This want has already been matched with someone else.');
      return;
    }

    let { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      const { data, error: signInError } = await supabase.auth.signInAnonymously();
      if (signInError) {
        setSubmitError('Couldn\'t submit — please check your connection and try again.');
        return;
      }
      user = data.user;
    }
    if (!user) {
      setSubmitError('Something went wrong. Please try again.');
      return;
    }

    setSubmitting(true);

    let imageUrl: string | null = null;
    if (pickedImageUri) {
      setUploadingPhoto(true);
      try {
        const { data: uploadData, contentType, extension } = await prepareUpload(pickedImageUri);
        const fileName = `${user.id}/wanted-response-${Date.now()}.${extension}`;

        const { error: uploadError } = await supabase.storage
          .from('listing-photos')
          .upload(fileName, uploadData, { contentType, upsert: false });

        if (uploadError) {
          setUploadingPhoto(false);
          setSubmitting(false);
          setSubmitError(`Photo upload failed: ${uploadError.message}`);
          return;
        }

        const { data: urlData } = supabase.storage.from('listing-photos').getPublicUrl(fileName);
        imageUrl = urlData.publicUrl;
      } catch (err: any) {
        setUploadingPhoto(false);
        setSubmitting(false);
        setSubmitError(`Photo upload failed: ${err.message}`);
        return;
      }
      setUploadingPhoto(false);
    }

    // FIX (real bug, reported: submitting a response with a photo
    // failed with "Could not find the 'image_url' column of
    // 'item_responses' in the schema cache"): this wasn't a stale
    // schema cache — that column has never existed. item_responses'
    // real column is photo_url; this insert always used the wrong name
    // whenever a photo was attached, so the whole response (price,
    // message, everything) failed to save, not just the photo. A
    // response with no photo never hit this line at all (imageUrl
    // stays null either way), which is why this went unnoticed until
    // someone actually attached a photo.
    const { error } = await supabase.from('item_responses').insert({
      item_request_id: selected.id,
      responder_id: user.id,
      price: priceNum,
      message: message.trim(),
      status: 'pending',
      is_physical_item: isPhysicalItem,
      photo_url: imageUrl,
    });

    setSubmitting(false);
    if (error) { setSubmitError(error.message); return; }

    setSubmitted(true);
    setMyResponseIds((prev) => new Set(prev).add(selected.id));
  }

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={GOLD} />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()}>
          <Text style={styles.backText}>← Back</Text>
        </TouchableOpacity>
        <Text style={styles.heading}>What people are looking for</Text>
        <Text style={styles.subheading}>
          {requests.length} open want{requests.length !== 1 ? 's' : ''} · respond with your price, free
        </Text>
      </View>

      <FlatList
        data={requests}
        keyExtractor={(item) => item.id}
        contentContainerStyle={[styles.list, { paddingBottom: 16 + insets.bottom }]}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={GOLD} />}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyEmoji}>🔍</Text>
            <Text style={styles.emptyText}>No open wants right now.</Text>
            <Text style={styles.emptySubtext}>Pull down to refresh.</Text>
          </View>
        }
        renderItem={({ item }) => {
          const budget = budgetLabel(item.budget_min, item.budget_max);
          const alreadyResponded = myResponseIds.has(item.id);
          return (
            <View style={styles.card}>
              <View style={styles.cardTop}>
                <Text style={styles.cardTitle} numberOfLines={1}>{item.title}</Text>
                <View style={styles.categoryBadge}>
                  <Text style={styles.categoryBadgeText}>{item.category}</Text>
                </View>
              </View>

              {item.description ? (
                <Text style={styles.cardDesc} numberOfLines={2}>{item.description}</Text>
              ) : null}

              <View style={styles.chips}>
                {budget && <Chip label={`💰 ${budget}`} />}
                <Chip label={`📍 ${item.location}`} />
              </View>

              {alreadyResponded ? (
                <View style={styles.respondedBadge}>
                  <Text style={styles.respondedBadgeText}>✓ You've responded</Text>
                </View>
              ) : (
                <TouchableOpacity style={styles.respondBtn} onPress={() => openModal(item)} activeOpacity={0.85}>
                  <Text style={styles.respondBtnText}>I have this — respond</Text>
                </TouchableOpacity>
              )}
            </View>
          );
        }}
        ListFooterComponent={
          <TouchableOpacity style={styles.postWantBtnBottom} onPress={() => router.push('/post-wanted')}>
            <Text style={styles.postWantBtnBottomText}>+ Post a want</Text>
          </TouchableOpacity>
        }
      />

      <Modal visible={modalVisible} animationType="slide" transparent onRequestClose={() => setModalVisible(false)}>
        <KeyboardAvoidingView
          style={styles.modalOverlay}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        >
          {/* FIX (real bug, reported: "the page does not scroll down to
              see what i add on the top" — after picking a photo, the
              response form grew taller than the screen with no way to
              reach the fields pushed off the top). This sheet had no
              ScrollView at all — it was a plain View anchored to the
              bottom of the screen (modalOverlay's justifyContent:
              'flex-end'), just growing with its content and getting
              clipped by the screen edge once it overflowed, the same
              missing-ScrollView pattern already fixed elsewhere in this
              app (rating.tsx, listing.tsx's carousel). maxHeight below
              gives the sheet a bounded box to scroll within — without
              it, a ScrollView here would still just grow unbounded
              alongside its content instead of actually scrolling. */}
          <View style={[styles.modalSheet, { paddingBottom: (Platform.OS === 'ios' ? 40 : 24) + insets.bottom }]}>
            <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
            {!submitted ? (
              <>
                <Text style={styles.modalTitle}>Your response</Text>
                {selected && (
                  <Text style={styles.modalItemTitle}>{selected.title}</Text>
                )}

                <Text style={styles.modalLabel}>Your price (USD) *</Text>
                <TextInput
                  style={styles.modalInput}
                  placeholder="e.g. 260"
                  placeholderTextColor="#666"
                  value={price}
                  onChangeText={setPrice}
                  keyboardType="decimal-pad"
                />

                <Text style={styles.modalLabel}>Message (optional)</Text>
                <TextInput
                  style={[styles.modalInput, styles.modalTextArea]}
                  placeholder="Condition, extras, anything the buyer should know..."
                  placeholderTextColor="#666"
                  value={message}
                  onChangeText={setMessage}
                  multiline
                  numberOfLines={3}
                />

                <Text style={styles.modalLabel}>What are you offering?</Text>
                <View style={styles.itemTypeRow}>
                  <TouchableOpacity
                    style={[styles.itemTypeChip, isPhysicalItem && styles.itemTypeChipActive]}
                    onPress={() => setIsPhysicalItem(true)}
                  >
                    <Text style={[styles.itemTypeChipText, isPhysicalItem && styles.itemTypeChipTextActive]}>
                      📦 A physical item
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.itemTypeChip, !isPhysicalItem && styles.itemTypeChipActive]}
                    onPress={() => setIsPhysicalItem(false)}
                  >
                    <Text style={[styles.itemTypeChipText, !isPhysicalItem && styles.itemTypeChipTextActive]}>
                      🛠️ A service
                    </Text>
                  </TouchableOpacity>
                </View>
                <Text style={styles.itemTypeHint}>
                  {isPhysicalItem
                    ? 'The buyer will be able to book delivery for this once matched.'
                    : 'Services (like a builder or mechanic) aren\'t deliverable — the buyer will arrange details with you directly in chat.'}
                </Text>

                <Text style={styles.modalLabel}>Photo of the item (optional)</Text>
                {pickedImageUri ? (
                  <>
                    <Image source={{ uri: pickedImageUri }} style={styles.responsePhotoPreview} />
                    <TouchableOpacity onPress={() => setPickedImageUri(null)}>
                      <Text style={styles.removePhotoText}>Remove photo</Text>
                    </TouchableOpacity>
                  </>
                ) : (
                  <View style={styles.photoOptionsRow}>
                    <TouchableOpacity style={styles.photoOptionBtn} onPress={takePhoto}>
                      <Text style={styles.photoOptionBtnText}>📸 Take Photo</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={styles.photoOptionBtn} onPress={pickPhoto}>
                      <Text style={styles.photoOptionBtnText}>🖼️ Choose from Gallery</Text>
                    </TouchableOpacity>
                  </View>
                )}

                {submitError ? <Text style={styles.submitErrorText}>{submitError}</Text> : null}

                <View style={styles.modalActions}>
                  <TouchableOpacity style={styles.cancelBtn} onPress={() => setModalVisible(false)}>
                    <Text style={styles.cancelText}>Cancel</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.submitModalBtn, (submitting || uploadingPhoto) && { opacity: 0.6 }]}
                    onPress={submitResponse}
                    disabled={submitting || uploadingPhoto}
                  >
                    {submitting || uploadingPhoto
                      ? <ActivityIndicator color={BLACK} />
                      : <Text style={styles.submitModalBtnText}>Send response</Text>
                    }
                  </TouchableOpacity>
                </View>
              </>
            ) : (
              <View style={styles.successBox}>
                <Text style={styles.successEmoji}>✅</Text>
                <Text style={styles.successTitle}>Response sent!</Text>
                <Text style={styles.successBody}>
                  {isPromoActive()
                    ? 'The buyer will review your price. If they pick you, you\'ll be notified and a chat will open right away — free, launch promotion through Jan 31, 2027.'
                    : 'The buyer will review your price. If they pick you, you\'ll be notified and a chat will open once they\'ve paid ImbizoHub\'s small commission.'}
                </Text>
                <TouchableOpacity style={styles.submitModalBtn} onPress={() => setModalVisible(false)}>
                  <Text style={styles.submitModalBtnText}>Done</Text>
                </TouchableOpacity>
              </View>
            )}
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

function Chip({ label }: { label: string }) {
  return (
    <View style={styles.chip}>
      <Text style={styles.chipText}>{label}</Text>
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
  heading: { color: '#fff', fontSize: 22, fontWeight: '800' },
  subheading: { color: GREY, fontSize: 13, marginTop: 4 },

  postWantBtnBottom: { backgroundColor: GOLD, borderRadius: 14, paddingVertical: 16, alignItems: 'center', marginTop: 4, marginBottom: 20 },
  postWantBtnBottomText: { color: BLACK, fontSize: 14, fontWeight: '800' },

  list: { padding: 16 },
  card: {
    backgroundColor: BLACK, borderRadius: 14, padding: 16,
    borderWidth: 0.5, borderColor: '#333',
    marginBottom: 14,
  },
  cardTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10, marginBottom: 6 },
  cardTitle: { color: '#fff', fontSize: 15, fontWeight: '700', flex: 1 },
  categoryBadge: { backgroundColor: '#3a2800', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 },
  categoryBadgeText: { color: GOLD, fontSize: 10, fontWeight: '700' },
  cardDesc: { color: GREY, fontSize: 13, lineHeight: 18, marginBottom: 10 },

  chips: { flexDirection: 'row', gap: 8, marginBottom: 12, flexWrap: 'wrap' },
  chip: { backgroundColor: DARK, borderRadius: 20, paddingHorizontal: 10, paddingVertical: 4, borderWidth: 0.5, borderColor: '#333' },
  chipText: { fontSize: 12, color: GREY },

  respondBtn: { backgroundColor: GOLD, borderRadius: 10, paddingVertical: 12, alignItems: 'center' },
  respondBtnText: { color: BLACK, fontWeight: '800', fontSize: 14 },
  respondedBadge: { backgroundColor: '#1a2a1a', borderRadius: 10, paddingVertical: 12, alignItems: 'center', borderWidth: 0.5, borderColor: '#2a4a2a' },
  respondedBadgeText: { color: '#4fc96e', fontWeight: '700', fontSize: 13 },

  empty: { alignItems: 'center', paddingTop: 60 },
  emptyEmoji: { fontSize: 40, marginBottom: 12 },
  emptyText: { fontSize: 16, color: '#fff', fontWeight: '600' },
  emptySubtext: { fontSize: 13, color: GREY, marginTop: 6 },

  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
  // FIX: added maxHeight so the ScrollView wrapping this sheet's
  // content (see the modal's render) actually has a bounded box to
  // scroll within — without a bounded parent height, a ScrollView just
  // grows unbounded alongside its content like the plain View it
  // replaced, and still doesn't scroll. See the comment at the modal's
  // render for the reported bug this fixes.
  modalSheet: {
    backgroundColor: BLACK, borderTopLeftRadius: 20, borderTopRightRadius: 20,
    padding: 24, paddingBottom: Platform.OS === 'ios' ? 40 : 24,
    maxHeight: '85%',
  },
  modalTitle: { fontSize: 18, fontWeight: '800', color: '#fff', marginBottom: 4 },
  modalItemTitle: { fontSize: 13, color: GREY, marginBottom: 16 },
  modalLabel: { fontSize: 13, fontWeight: '700', color: '#fff', marginBottom: 6, marginTop: 14 },
  modalInput: {
    backgroundColor: DARK, borderRadius: 10,
    paddingHorizontal: 14, paddingVertical: Platform.OS === 'ios' ? 13 : 10,
    fontSize: 14, color: '#fff', borderWidth: 0.5, borderColor: '#333',
  },
  modalTextArea: { height: 80, textAlignVertical: 'top', paddingTop: 10 },
  itemTypeRow: { flexDirection: 'row', gap: 8 },
  itemTypeChip: { flex: 1, backgroundColor: DARK, borderRadius: 10, paddingVertical: 12, alignItems: 'center', borderWidth: 1, borderColor: '#333' },
  itemTypeChipActive: { borderColor: GOLD, backgroundColor: '#2a2200' },
  itemTypeChipText: { color: GREY, fontSize: 12, fontWeight: '600' },
  itemTypeChipTextActive: { color: GOLD, fontWeight: '700' },
  itemTypeHint: { color: '#888', fontSize: 11, marginTop: 8, lineHeight: 15 },
  photoOptionsRow: { flexDirection: 'row', gap: 8 },
  photoOptionBtn: { flex: 1, backgroundColor: DARK, borderRadius: 10, paddingVertical: 14, alignItems: 'center', borderWidth: 1, borderColor: '#444', borderStyle: 'dashed' },
  photoOptionBtnText: { color: '#fff', fontSize: 12, fontWeight: '700', textAlign: 'center' },
  responsePhotoPreview: { width: '100%', height: 160, borderRadius: 10, backgroundColor: DARK, marginBottom: 8 },
  removePhotoText: { color: GREY, fontSize: 12, textAlign: 'center', marginBottom: 4 },
  submitErrorText: { color: '#ff8a8a', fontSize: 13, marginTop: 10 },
  modalActions: { flexDirection: 'row', gap: 12, marginTop: 20 },
  cancelBtn: { flex: 1, borderRadius: 10, paddingVertical: 13, alignItems: 'center', backgroundColor: DARK },
  cancelText: { color: GREY, fontWeight: '600' },
  submitModalBtn: { flex: 2, borderRadius: 10, paddingVertical: 13, alignItems: 'center', backgroundColor: GOLD },
  submitModalBtnText: { color: BLACK, fontWeight: '800', fontSize: 15 },

  successBox: { alignItems: 'center', paddingVertical: 16 },
  successEmoji: { fontSize: 48, marginBottom: 12 },
  successTitle: { fontSize: 20, fontWeight: '800', color: '#fff', marginBottom: 8 },
  successBody: { fontSize: 14, color: GREY, textAlign: 'center', lineHeight: 20, marginBottom: 24 },
});
