// app/admin-reports-review.tsx
//
// FIX (real bug in this file's own earlier rewrite, found while
// reviewing the actual RLS policies and RPCs for the first time this
// sweep): this used to do a raw `supabase.from('reports').select('*')`
// client-side, plus separate lookups against `profiles`/`listings` to
// resolve names. That looked reasonable without visibility into the
// database layer, but `reports` RLS only grants
// "reporters can view their own submitted reports" — scoped to
// `reporter_id = auth.uid()`. There's no admin-read policy on the
// table at all. That meant this screen, even for a genuine admin,
// would only ever show reports THEY THEMSELVES had filed as a
// reporter — never reports filed by anyone else, which is the entire
// point of an admin review queue. It turns out the database already
// has exactly the right tool for this: `admin_list_reports()` and
// `admin_review_report()`, both SECURITY DEFINER functions that check
// `profiles.is_admin` internally and then deliberately bypass RLS to
// return/act on every report, not just the caller's own. This rewrite
// switches to those two RPCs, which also resolves reporter/reported
// names and the listing title server-side (no more client-side
// lookups needed), exposes each reported user's current
// suspension status for context, and adds the review-status workflow
// (open/reviewed/dismissed) the previous version explicitly avoided
// building because it wasn't sure a status column existed — it does,
// and `admin_review_report()` is the real, already-built way to change
// it.
//
// Usage: router.push('/admin-reports-review')

import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator, Platform, RefreshControl, ScrollView, StyleSheet,
  Text, TouchableOpacity, View,
} from 'react-native';
import { supabase } from '../../lib/supabase';

const GOLD = '#B8860B';
const BLACK = '#1A1A18';
const DARK = '#2a2a2a';
const GREY = '#AAAAAA';
const RED = '#ff8a8a';
const GREEN = '#4fc96e';

type StatusFilter = 'open' | 'reviewed' | 'dismissed' | 'all';

type Report = {
  report_id: string;
  reporter_name: string | null;
  reported_user_name: string | null;
  reported_user_id: string;
  reported_user_suspended_until: string | null;
  context: string;
  listing_id: number | null;
  listing_title: string | null;
  reason: string;
  details: string | null;
  status: string;
  created_at: string;
};

const CONTEXT_LABEL: Record<string, string> = {
  listing: '🏷️ Listing',
  chat: '💬 Chat',
  wanted: '🔍 Wanted post',
  other: '❓ Other',
};

const FILTERS: { key: StatusFilter; label: string }[] = [
  { key: 'open', label: 'Open' },
  { key: 'reviewed', label: 'Reviewed' },
  { key: 'dismissed', label: 'Dismissed' },
  { key: 'all', label: 'All' },
];

export default function AdminReportsReviewScreen() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [authorized, setAuthorized] = useState(false);
  const [reports, setReports] = useState<Report[]>([]);
  const [filter, setFilter] = useState<StatusFilter>('open');
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [error, setError] = useState('');

  useEffect(() => { load(filter); }, [filter]);

  async function handleRefresh() {
    setRefreshing(true);
    await load(filter);
    setRefreshing(false);
  }

  async function load(currentFilter: StatusFilter) {
    setLoading(true);
    setError('');

    // Friendly "Not authorized" screen for non-admins, same pattern as
    // admin-security-incidents.tsx — the RPC below independently
    // enforces this too (raises an exception for non-admins), so this
    // client-side check is a UX nicety, not the real security boundary.
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      setAuthorized(false);
      setLoading(false);
      return;
    }

    const { data: profile } = await supabase
      .from('profiles')
      .select('is_admin')
      .eq('id', user.id)
      .maybeSingle();

    if (!profile?.is_admin) {
      setAuthorized(false);
      setLoading(false);
      return;
    }

    setAuthorized(true);

    const { data, error: rpcError } = await supabase.rpc('admin_list_reports', {
      p_status: currentFilter === 'all' ? null : currentFilter,
    });

    if (rpcError) {
      setError(rpcError.message);
      setLoading(false);
      return;
    }

    setReports((data ?? []) as Report[]);
    setLoading(false);
  }

  async function handleReview(reportId: string, newStatus: 'reviewed' | 'dismissed') {
    setUpdatingId(reportId);
    const { error: rpcError } = await supabase.rpc('admin_review_report', {
      p_report_id: reportId,
      p_new_status: newStatus,
    });
    setUpdatingId(null);

    if (rpcError) {
      setError(rpcError.message);
      return;
    }

    // Remove it from the current view if we're looking at a specific
    // status filter it no longer matches; otherwise just patch its
    // status in place.
    setReports((prev) =>
      filter !== 'all' && filter !== newStatus
        ? prev.filter((r) => r.report_id !== reportId)
        : prev.map((r) => (r.report_id === reportId ? { ...r, status: newStatus } : r))
    );
  }

  if (loading) {
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
          <Text style={styles.backBtnCenteredText}>‹ Back to home</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={GOLD} />}
      >
        <View style={styles.topRow}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
            <Text style={styles.backText}>‹ Back</Text>
          </TouchableOpacity>
          <View style={styles.crossLinkRow}>
            <TouchableOpacity onPress={() => router.push('/admin-verification-review')}>
              <Text style={styles.crossLinkText}>Verification</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => router.push('/admin-security-incidents')}>
              <Text style={styles.crossLinkText}>Incidents</Text>
            </TouchableOpacity>
          </View>
        </View>

        <Text style={styles.heading}>User reports</Text>
        <Text style={styles.subheading}>
          {reports.length === 0
            ? 'No reports match this filter.'
            : `${reports.length} report${reports.length === 1 ? '' : 's'}.`}
        </Text>

        <View style={styles.filterRow}>
          {FILTERS.map((f) => (
            <TouchableOpacity
              key={f.key}
              style={[styles.filterChip, filter === f.key && styles.filterChipActive]}
              onPress={() => setFilter(f.key)}
            >
              <Text style={[styles.filterChipText, filter === f.key && styles.filterChipTextActive]}>
                {f.label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {error ? (
          <View style={styles.errorBox}><Text style={styles.errorText}>⚠️ {error}</Text></View>
        ) : null}

        {reports.map((r) => {
          const isSuspended = !!r.reported_user_suspended_until
            && new Date(r.reported_user_suspended_until).getTime() > Date.now();

          return (
            <View key={r.report_id} style={styles.card}>
              <View style={styles.cardTop}>
                <Text style={styles.contextLabel}>{CONTEXT_LABEL[r.context] ?? `❓ ${r.context}`}</Text>
                <Text style={styles.createdAt}>
                  {new Date(r.created_at).toLocaleDateString('en-GB', {
                    day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
                  })}
                </Text>
              </View>

              <Text style={styles.reason}>{r.reason}</Text>
              {r.details ? <Text style={styles.details}>{r.details}</Text> : null}

              <View style={styles.partiesBox}>
                <Text style={styles.partyLine}>
                  <Text style={styles.partyLabel}>Reported by: </Text>{r.reporter_name ?? 'Unknown user'}
                </Text>
                <Text style={styles.partyLine}>
                  <Text style={styles.partyLabel}>Reported user: </Text>{r.reported_user_name ?? 'Unknown user'}
                  {isSuspended ? ' (currently suspended)' : ''}
                </Text>
                {r.listing_title ? (
                  <Text style={styles.partyLine}>
                    <Text style={styles.partyLabel}>Listing: </Text>{r.listing_title}
                  </Text>
                ) : null}
              </View>

              {r.status === 'open' ? (
                <View style={styles.actionRow}>
                  <TouchableOpacity
                    style={[styles.actionBtn, styles.reviewBtn, updatingId === r.report_id && styles.actionBtnDisabled]}
                    disabled={updatingId === r.report_id}
                    onPress={() => handleReview(r.report_id, 'reviewed')}
                  >
                    <Text style={styles.reviewBtnText}>
                      {updatingId === r.report_id ? '...' : 'Mark reviewed'}
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.actionBtn, styles.dismissBtn, updatingId === r.report_id && styles.actionBtnDisabled]}
                    disabled={updatingId === r.report_id}
                    onPress={() => handleReview(r.report_id, 'dismissed')}
                  >
                    <Text style={styles.dismissBtnText}>
                      {updatingId === r.report_id ? '...' : 'Dismiss'}
                    </Text>
                  </TouchableOpacity>
                </View>
              ) : (
                <Text style={styles.statusTag}>Status: {r.status}</Text>
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
  crossLinkRow: { flexDirection: 'row', gap: 14 },
  crossLinkText: { color: GOLD, fontSize: 13, fontWeight: '700' },
  heading: { fontSize: 24, fontWeight: '800', color: '#fff', marginBottom: 6 },
  subheading: { fontSize: 13, color: GREY, marginBottom: 16 },

  filterRow: { flexDirection: 'row', flexWrap: 'wrap', marginBottom: 16 },
  filterChip: {
    backgroundColor: DARK, borderRadius: 20, paddingVertical: 8, paddingHorizontal: 16,
    marginRight: 8, marginBottom: 8,
  },
  filterChipActive: { backgroundColor: GOLD },
  filterChipText: { color: GREY, fontSize: 12, fontWeight: '700' },
  filterChipTextActive: { color: BLACK },

  deniedTitle: { color: '#fff', fontSize: 20, fontWeight: '800', marginBottom: 10 },
  deniedBody: { color: GREY, fontSize: 13, textAlign: 'center', marginBottom: 24 },
  backBtnCentered: { backgroundColor: DARK, borderRadius: 12, paddingVertical: 12, paddingHorizontal: 24 },
  backBtnCenteredText: { color: '#fff', fontSize: 14, fontWeight: '600' },

  errorBox: { backgroundColor: '#3a1a1a', borderRadius: 10, padding: 12, marginBottom: 16 },
  errorText: { color: RED, fontSize: 13 },

  card: { backgroundColor: BLACK, borderRadius: 14, padding: 16, marginBottom: 14, borderWidth: 0.5, borderColor: '#333' },
  cardTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  contextLabel: { color: GOLD, fontSize: 11, fontWeight: '700' },
  createdAt: { color: '#666', fontSize: 11 },

  reason: { color: '#fff', fontSize: 14, fontWeight: '700', marginBottom: 6 },
  details: { color: GREY, fontSize: 13, lineHeight: 19, marginBottom: 12 },

  partiesBox: { paddingTop: 10, borderTopWidth: 0.5, borderTopColor: '#2a2a2a' },
  partyLine: { color: GREY, fontSize: 12, marginBottom: 4 },
  partyLabel: { color: '#888', fontWeight: '600' },

  actionRow: { flexDirection: 'row', gap: 10, marginTop: 14 },
  actionBtn: { flex: 1, borderRadius: 10, paddingVertical: 10, alignItems: 'center' },
  actionBtnDisabled: { opacity: 0.6 },
  reviewBtn: { backgroundColor: GREEN },
  reviewBtnText: { color: BLACK, fontSize: 12, fontWeight: '800' },
  dismissBtn: { backgroundColor: DARK, borderWidth: 0.5, borderColor: '#444' },
  dismissBtnText: { color: GREY, fontSize: 12, fontWeight: '800' },
  statusTag: { color: '#666', fontSize: 11, marginTop: 12, fontStyle: 'italic' },
});
