// app/admin-verification-review.tsx
// Admin screen for reviewing pending ID verification submissions —
// covers Verified Seller, delivery operator, and transport operator
// verification in one queue, since they now share one backend (see
// unified-verification.sql).
//
// Every action here goes through admin_list_pending_verifications() /
// admin_review_verification() — both security-definer functions that
// check is_admin themselves, same reasoning as submit_verification()
// being the only door for a regular user's own submission. This screen
// never writes to profiles/delivery_operators/verification_requests
// directly and never trusts a client-side "am I an admin" check for
// anything beyond hiding the UI — the real gate is server-side.
//
// No nav entry point added anywhere else in the app on purpose — reach
// this via a direct link (/admin-verification-review) for now. UPDATED:
// now cross-links to /admin-reports-review (and that screen links back)
// so once an admin reaches EITHER screen via a direct link, they can
// move between the two admin areas without needing to remember two
// separate URLs — still no entry point from the main app nav itself.
//
// Usage: router.push('/admin-verification-review')

import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator, Image, Platform, RefreshControl, ScrollView, StyleSheet,
  Text, TextInput, TouchableOpacity, View,
} from 'react-native';
import { supabase } from '../../lib/supabase';

const GOLD = '#B8860B';
const BLACK = '#1A1A18';
const DARK = '#2a2a2a';
const GREY = '#AAAAAA';
const GREEN = '#4fc96e';
const RED = '#ff8a8a';

const SIGNED_URL_TTL_SECONDS = 300;

type VerificationType = 'seller' | 'delivery_operator' | 'transport_operator';

const TYPE_LABEL: Record<VerificationType, string> = {
  seller: '🏪 Verified Seller',
  delivery_operator: '📦 Delivery Operator',
  transport_operator: '🚐 Transport Operator',
};

type PendingItem = {
  request_id: string;
  user_id: string;
  verification_type: VerificationType;
  full_name: string;
  email: string;
  document_path: string;
  submitted_at: string;
  signedUrl?: string;
};

const FILTERS: { label: string; value: VerificationType | null }[] = [
  { label: 'All', value: null },
  { label: 'Seller', value: 'seller' },
  { label: 'Delivery', value: 'delivery_operator' },
  { label: 'Transport', value: 'transport_operator' },
];

export default function AdminVerificationReviewScreen() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [authorized, setAuthorized] = useState(true);
  const [items, setItems] = useState<PendingItem[]>([]);
  const [filter, setFilter] = useState<VerificationType | null>(null);
  const [error, setError] = useState('');

  const [actioningId, setActioningId] = useState<string | null>(null);
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  // NEW: document signed URLs expire after SIGNED_URL_TTL_SECONDS (5
  // minutes) — an admin who leaves this screen open longer than that
  // would see broken images with no obvious way to fix it. Pull-to-
  // refresh gives a direct, discoverable way to regenerate them,
  // instead of navigating away and back.
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => { load(); }, [filter]);

  async function handleRefresh() {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }

  async function load() {
    setLoading(true);
    setError('');

    const { data, error: rpcError } = await supabase.rpc('admin_list_pending_verifications', {
      p_verification_type: filter,
    });

    if (rpcError) {
      setAuthorized(false);
      setLoading(false);
      return;
    }

    const list: PendingItem[] = data ?? [];

    const withUrls = await Promise.all(
      list.map(async (item) => {
        const { data: signed } = await supabase.storage
          .from('verification-documents')
          .createSignedUrl(item.document_path, SIGNED_URL_TTL_SECONDS);
        return { ...item, signedUrl: signed?.signedUrl };
      })
    );

    setItems(withUrls);
    setLoading(false);
  }

  async function handleApprove(requestId: string) {
    setActioningId(requestId);
    setError('');

    const { error: rpcError } = await supabase.rpc('admin_review_verification', {
      p_request_id: requestId,
      p_approve: true,
    });

    setActioningId(null);

    if (rpcError) {
      setError(rpcError.message);
      return;
    }

    setItems((prev) => prev.filter((i) => i.request_id !== requestId));
  }

  async function handleReject(requestId: string) {
    setActioningId(requestId);
    setError('');

    const { error: rpcError } = await supabase.rpc('admin_review_verification', {
      p_request_id: requestId,
      p_approve: false,
      p_reason: rejectReason.trim() || null,
    });

    setActioningId(null);

    if (rpcError) {
      setError(rpcError.message);
      return;
    }

    setRejectingId(null);
    setRejectReason('');
    setItems((prev) => prev.filter((i) => i.request_id !== requestId));
  }

  if (loading && items.length === 0) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={GOLD} />
      </View>
    );
  }

  if (!authorized) {
    return (
      <View style={styles.center}>
        <Text style={styles.deniedTitle}>Not authorized</Text>
        <Text style={styles.deniedBody}>This screen is only available to admin accounts.</Text>
        <TouchableOpacity style={styles.backBtnCentered} onPress={() => router.replace('/')}>
          <Text style={styles.backBtnCenteredText}><Text style={styles.backArrow}>‹</Text> Back to home</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* style={{flex:1}} required for web scrolling — contentContainerStyle
          alone leaves the ScrollView itself unbounded, so it grows to fit
          its content and never overflows. Same fix as dealer.tsx. */}
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={GOLD} />}
      >
        <View style={styles.topRow}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
            <Text style={styles.backText}><Text style={styles.backArrow}>‹</Text> Back</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => router.push('/admin-reports-review')}>
            <Text style={styles.crossLinkText}>Reports →</Text>
          </TouchableOpacity>
        </View>

        <Text style={styles.heading}>Verification review</Text>
        <Text style={styles.subheading}>
          {items.length === 0
            ? 'No submissions waiting for review.'
            : `${items.length} submission${items.length === 1 ? '' : 's'} waiting for review.`}
        </Text>

        <View style={styles.filterRow}>
          {FILTERS.map((f) => (
            <TouchableOpacity
              key={f.label}
              style={[styles.filterChip, filter === f.value && styles.filterChipActive]}
              onPress={() => setFilter(f.value)}
            >
              <Text style={[styles.filterChipText, filter === f.value && styles.filterChipTextActive]}>
                {f.label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {error ? (
          <View style={styles.errorBox}><Text style={styles.errorText}>⚠️ {error}</Text></View>
        ) : null}

        {items.map((item) => {
          const isActioning = actioningId === item.request_id;
          const isRejecting = rejectingId === item.request_id;

          return (
            <View key={item.request_id} style={styles.card}>
              <Text style={styles.typeLabel}>{TYPE_LABEL[item.verification_type]}</Text>
              <Text style={styles.name}>{item.full_name || 'No name on file'}</Text>
              <Text style={styles.email}>{item.email}</Text>
              <Text style={styles.submittedAt}>
                Submitted {new Date(item.submitted_at).toLocaleString('en-GB', {
                  day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
                })}
              </Text>

              {item.signedUrl ? (
                <Image source={{ uri: item.signedUrl }} style={styles.documentImage} resizeMode="contain" />
              ) : (
                <View style={styles.documentMissing}>
                  <Text style={styles.documentMissingText}>Could not load document image</Text>
                </View>
              )}

              {isRejecting ? (
                <View style={styles.rejectBox}>
                  <Text style={styles.rejectLabel}>Reason (shown to the applicant)</Text>
                  <TextInput
                    style={styles.rejectInput}
                    value={rejectReason}
                    onChangeText={setRejectReason}
                    placeholder="e.g. Photo is blurry, please retake"
                    placeholderTextColor="#666"
                    multiline
                  />
                  <View style={styles.actionRow}>
                    <TouchableOpacity
                      style={[styles.rejectConfirmBtn, isActioning && { opacity: 0.6 }]}
                      onPress={() => handleReject(item.request_id)}
                      disabled={isActioning}
                    >
                      {isActioning
                        ? <ActivityIndicator color="#fff" size="small" />
                        : <Text style={styles.rejectConfirmBtnText}>Confirm reject</Text>
                      }
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={styles.cancelBtn}
                      onPress={() => { setRejectingId(null); setRejectReason(''); }}
                      disabled={isActioning}
                    >
                      <Text style={styles.cancelBtnText}>Cancel</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              ) : (
                <View style={styles.actionRow}>
                  <TouchableOpacity
                    style={[styles.approveBtn, isActioning && { opacity: 0.6 }]}
                    onPress={() => handleApprove(item.request_id)}
                    disabled={isActioning}
                  >
                    {isActioning
                      ? <ActivityIndicator color={BLACK} size="small" />
                      : <Text style={styles.approveBtnText}>✓ Approve</Text>
                    }
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.rejectBtn}
                    onPress={() => {
                      // FIX (real bug, found during a thorough review):
                      // rejectReason is a single shared string across
                      // every item in this list, not per-item. Without
                      // resetting it here, an admin who starts typing a
                      // reason for one applicant, then taps "Reject" on
                      // a DIFFERENT applicant instead (without
                      // confirming the first), would carry that
                      // still-typed text over — potentially confirming
                      // a rejection for the second applicant using a
                      // reason actually written about the first.
                      // Resetting on open, not just on cancel/confirm,
                      // closes that gap.
                      setRejectReason('');
                      setRejectingId(item.request_id);
                    }}
                    disabled={isActioning}
                  >
                    <Text style={styles.rejectBtnText}>✕ Reject</Text>
                  </TouchableOpacity>
                </View>
              )}
            </View>
          );
        })}

        <View style={{ height: 40 }} />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#111111' },
  content: { padding: 20, paddingTop: Platform.OS === 'ios' ? 56 : 40, paddingBottom: 48 },
  center: { flex: 1, backgroundColor: '#111', alignItems: 'center', justifyContent: 'center', padding: 30 },

  topRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
  backBtn: {},
  backText: { color: GREY, fontSize: 14 },
  // NEW: bigger than the label text so the '‹' glyph reads clearly — direct product decision ("back symbol too small").
  backArrow: { fontSize: 20 },
  crossLinkText: { color: GOLD, fontSize: 13, fontWeight: '700' },
  heading: { fontSize: 24, fontWeight: '800', color: '#fff', marginBottom: 6 },
  subheading: { fontSize: 13, color: GREY, marginBottom: 16 },

  filterRow: { flexDirection: 'row', gap: 8, marginBottom: 20 },
  filterChip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, backgroundColor: DARK, borderWidth: 1, borderColor: '#333' },
  filterChipActive: { backgroundColor: GOLD, borderColor: GOLD },
  filterChipText: { color: GREY, fontSize: 12, fontWeight: '600' },
  filterChipTextActive: { color: BLACK },

  deniedTitle: { color: '#fff', fontSize: 20, fontWeight: '800', marginBottom: 10 },
  deniedBody: { color: GREY, fontSize: 13, textAlign: 'center', marginBottom: 24 },
  backBtnCentered: { backgroundColor: DARK, borderRadius: 12, paddingVertical: 12, paddingHorizontal: 24 },
  backBtnCenteredText: { color: '#fff', fontSize: 14, fontWeight: '600' },

  errorBox: { backgroundColor: '#3a1a1a', borderRadius: 10, padding: 12, marginBottom: 16 },
  errorText: { color: RED, fontSize: 13 },

  card: { backgroundColor: BLACK, borderRadius: 14, padding: 18, marginBottom: 16, borderWidth: 0.5, borderColor: '#333' },
  typeLabel: { color: GOLD, fontSize: 11, fontWeight: '700', marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.5 },
  name: { color: '#fff', fontSize: 15, fontWeight: '700' },
  email: { color: GREY, fontSize: 12, marginTop: 2 },
  submittedAt: { color: '#666', fontSize: 11, marginTop: 4, marginBottom: 14 },

  documentImage: { width: '100%', height: 260, borderRadius: 10, backgroundColor: DARK, marginBottom: 16 },
  documentMissing: { width: '100%', height: 120, borderRadius: 10, backgroundColor: DARK, alignItems: 'center', justifyContent: 'center', marginBottom: 16 },
  documentMissingText: { color: '#666', fontSize: 12 },

  actionRow: { flexDirection: 'row', gap: 10 },
  approveBtn: { flex: 1, backgroundColor: GREEN, borderRadius: 12, paddingVertical: 14, alignItems: 'center' },
  approveBtnText: { color: BLACK, fontSize: 14, fontWeight: '800' },
  rejectBtn: { flex: 1, backgroundColor: DARK, borderRadius: 12, paddingVertical: 14, alignItems: 'center', borderWidth: 1, borderColor: '#553333' },
  rejectBtnText: { color: RED, fontSize: 14, fontWeight: '700' },

  rejectBox: { marginTop: 4 },
  rejectLabel: { color: GREY, fontSize: 12, marginBottom: 8 },
  rejectInput: { backgroundColor: DARK, borderRadius: 10, padding: 12, color: '#fff', fontSize: 13, minHeight: 70, textAlignVertical: 'top', borderWidth: 0.5, borderColor: '#444', marginBottom: 12 },
  rejectConfirmBtn: { flex: 1, backgroundColor: '#8a2a2a', borderRadius: 12, paddingVertical: 14, alignItems: 'center' },
  rejectConfirmBtnText: { color: '#fff', fontSize: 14, fontWeight: '800' },
  cancelBtn: { flex: 1, backgroundColor: DARK, borderRadius: 12, paddingVertical: 14, alignItems: 'center', borderWidth: 1, borderColor: '#444' },
  cancelBtnText: { color: GREY, fontSize: 14, fontWeight: '600' },
});
