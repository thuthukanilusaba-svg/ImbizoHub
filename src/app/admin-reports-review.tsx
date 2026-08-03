// app/admin-reports-review.tsx
//
// Closes the reporting gap: submission (report-user.tsx) and its RLS
// were already confirmed secure, but nothing existed for an admin to
// actually see or act on a submitted report before this — it just sat
// in the table indefinitely, invisible without a direct database
// query. Mirrors admin-verification-review.tsx's pattern: all reads
// and writes go through security-definer RPC functions
// (admin_list_reports / admin_review_report — see
// admin-reports-functions.sql), never direct table access, so this
// screen's own client-side isAdmin state is only ever a UI convenience
// — the real authorization check lives server-side in those functions.
//
// Usage: router.push('/admin-reports-review')

import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { supabase } from '../../lib/supabase';

const GOLD = '#B8860B';
const BLACK = '#1A1A18';
const DARK = '#2a2a2a';
const GREY = '#AAAAAA';

// FIX (proactive, same class of bug already found and fixed in
// chat.tsx and meetpay.tsx): Postgres's default text rendering for
// timestamptz uses a space instead of 'T' and a short timezone offset,
// which JS's native Date constructor parses inconsistently across
// engines — sometimes silently returning an Invalid Date (NaN).
// Applying the same normalization here up front rather than waiting
// for "currently suspended" to incorrectly show as false the same way
// "Expired" incorrectly showed as true elsewhere.
function parsePgTimestamp(value: string): number {
  const normalized = value
    .replace(' ', 'T')
    .replace(/([+-]\d{2})$/, '$1:00');
  return new Date(normalized).getTime();
}

type StatusFilter = 'open' | 'resolved' | 'dismissed' | 'all';

export default function AdminReportsReviewScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [reports, setReports] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<StatusFilter>('open');
  const [actioningId, setActioningId] = useState<string | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    loadReports();
  }, [filter]);

  async function loadReports() {
    setLoading(true);
    setError('');
    const { data, error: rpcError } = await supabase.rpc('admin_list_reports', {
      p_status: filter === 'all' ? null : filter,
    });

    if (rpcError) {
      setError(rpcError.message);
      setLoading(false);
      return;
    }

    setReports(data ?? []);
    setLoading(false);
  }

  async function handleReview(reportId: string, newStatus: 'resolved' | 'dismissed') {
    setActioningId(reportId);
    setError('');

    const { error: rpcError } = await supabase.rpc('admin_review_report', {
      p_report_id: reportId,
      p_new_status: newStatus,
    });

    setActioningId(null);

    if (rpcError) {
      setError(rpcError.message);
      return;
    }

    setReports((prev) => prev.filter((r) => r.report_id !== reportId));
  }

  // NEW: real enforcement, not just report record-keeping. Suspends the
  // REPORTED USER (not the report itself) — separate action from
  // Resolve/Dismiss, since you might resolve a report without
  // suspending (e.g. a misunderstanding that got sorted out) or
  // suspend without resolving yet (investigating further). Updates the
  // affected report(s) in local state to reflect the new
  // suspended_until rather than removing them, since suspending doesn't
  // change the report's own status.
  async function handleSuspend(userId: string, days: number, reportId: string) {
    setActioningId(reportId);
    setError('');

    const report = reports.find((r) => r.report_id === reportId);
    const { error: rpcError } = await supabase.rpc('admin_suspend_user', {
      p_user_id: userId,
      p_days: days,
      p_reason: report ? `${report.reason}${report.details ? ' — ' + report.details : ''}` : null,
    });

    setActioningId(null);

    if (rpcError) {
      setError(rpcError.message);
      return;
    }

    const newSuspendedUntil = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
    setReports((prev) =>
      prev.map((r) =>
        r.reported_user_id === userId ? { ...r, reported_user_suspended_until: newSuspendedUntil } : r
      )
    );
  }

  async function handleUnsuspend(userId: string, reportId: string) {
    setActioningId(reportId);
    setError('');

    const { error: rpcError } = await supabase.rpc('admin_unsuspend_user', {
      p_user_id: userId,
    });

    setActioningId(null);

    if (rpcError) {
      setError(rpcError.message);
      return;
    }

    setReports((prev) =>
      prev.map((r) => (r.reported_user_id === userId ? { ...r, reported_user_suspended_until: null } : r))
    );
  }

  function isCurrentlySuspended(suspendedUntil: string | null): boolean {
    return !!suspendedUntil && parsePgTimestamp(suspendedUntil) > Date.now();
  }

  function statusBadgeStyle(status: string) {
    if (status === 'resolved') return styles.badgeResolved;
    if (status === 'dismissed') return styles.badgeDismissed;
    return styles.badgeOpen;
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()}>
          <Text style={styles.backText}>← Back</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Reports</Text>
        <TouchableOpacity onPress={() => router.push('/admin-verification-review')}>
          <Text style={styles.crossLinkText}>Verification →</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.filterRow}>
        {(['open', 'resolved', 'dismissed', 'all'] as StatusFilter[]).map((f) => (
          <TouchableOpacity
            key={f}
            style={[styles.filterChip, filter === f && styles.filterChipActive]}
            onPress={() => setFilter(f)}
          >
            <Text style={[styles.filterChipText, filter === f && styles.filterChipTextActive]}>
              {f.charAt(0).toUpperCase() + f.slice(1)}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {error ? (
        <View style={styles.errorBar}>
          <Text style={styles.errorText}>⚠️ {error}</Text>
        </View>
      ) : null}

      {loading ? (
        <ActivityIndicator color={GOLD} style={{ marginTop: 40 }} />
      ) : (
        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 + insets.bottom }}>
          {reports.length === 0 && (
            <Text style={styles.emptyText}>No {filter !== 'all' ? filter : ''} reports.</Text>
          )}

          {reports.map((r) => (
            <View key={r.report_id} style={styles.card}>
              <View style={styles.cardTopRow}>
                <Text style={styles.reportedName}>
                  {r.reported_user_name || 'Unknown user'}
                </Text>
                <View style={statusBadgeStyle(r.status)}>
                  <Text style={styles.badgeText}>{r.status}</Text>
                </View>
              </View>

              <Text style={styles.reason}>{r.reason}</Text>

              {r.details ? (
                <Text style={styles.details}>"{r.details}"</Text>
              ) : null}

              <View style={styles.metaRow}>
                <Text style={styles.metaText}>
                  Reported by {r.reporter_name || 'someone'} · {r.context}
                  {r.listing_title ? ` · ${r.listing_title}` : ''}
                </Text>
              </View>
              <Text style={styles.dateText}>
                {new Date(r.created_at).toLocaleDateString()}
              </Text>

              {isCurrentlySuspended(r.reported_user_suspended_until) ? (
                <View style={styles.suspendedBox}>
                  <Text style={styles.suspendedText}>
                    🚫 Suspended until {new Date(r.reported_user_suspended_until).toLocaleDateString()}
                  </Text>
                  <TouchableOpacity
                    style={styles.liftBtn}
                    onPress={() => handleUnsuspend(r.reported_user_id, r.report_id)}
                    disabled={actioningId === r.report_id}
                  >
                    {actioningId === r.report_id
                      ? <ActivityIndicator color={GOLD} size="small" />
                      : <Text style={styles.liftBtnText}>Lift suspension</Text>
                    }
                  </TouchableOpacity>
                </View>
              ) : (
                <View style={styles.suspendRow}>
                  <TouchableOpacity
                    style={styles.suspendChip}
                    onPress={() => handleSuspend(r.reported_user_id, 7, r.report_id)}
                    disabled={actioningId === r.report_id}
                  >
                    <Text style={styles.suspendChipText}>Suspend 7d</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.suspendChip}
                    onPress={() => handleSuspend(r.reported_user_id, 30, r.report_id)}
                    disabled={actioningId === r.report_id}
                  >
                    <Text style={styles.suspendChipText}>Suspend 30d</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.suspendChipPermanent}
                    onPress={() => handleSuspend(r.reported_user_id, 36500, r.report_id)}
                    disabled={actioningId === r.report_id}
                  >
                    <Text style={styles.suspendChipPermanentText}>Permanent</Text>
                  </TouchableOpacity>
                </View>
              )}

              {r.status === 'open' && (
                <View style={styles.actionsRow}>
                  <TouchableOpacity
                    style={[styles.actionBtn, styles.dismissBtn]}
                    onPress={() => handleReview(r.report_id, 'dismissed')}
                    disabled={actioningId === r.report_id}
                  >
                    <Text style={styles.dismissBtnText}>Dismiss</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.actionBtn, styles.resolveBtn]}
                    onPress={() => handleReview(r.report_id, 'resolved')}
                    disabled={actioningId === r.report_id}
                  >
                    {actioningId === r.report_id
                      ? <ActivityIndicator color={BLACK} size="small" />
                      : <Text style={styles.resolveBtnText}>Mark Resolved</Text>
                    }
                  </TouchableOpacity>
                </View>
              )}
            </View>
          ))}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#111111' },
  header: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    padding: 16, paddingTop: 50, backgroundColor: BLACK,
  },
  backText: { color: GOLD, fontSize: 14 },
  crossLinkText: { color: GOLD, fontSize: 13, fontWeight: '700' },
  headerTitle: { color: '#fff', fontSize: 16, fontWeight: '700' },
  filterRow: { flexDirection: 'row', gap: 8, paddingHorizontal: 16, paddingVertical: 12, backgroundColor: BLACK },
  filterChip: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20, backgroundColor: DARK, borderWidth: 0.5, borderColor: '#333' },
  filterChipActive: { backgroundColor: GOLD, borderColor: GOLD },
  filterChipText: { color: GREY, fontSize: 12, fontWeight: '600' },
  filterChipTextActive: { color: BLACK },
  errorBar: { backgroundColor: '#3a1a1a', padding: 10, paddingHorizontal: 16 },
  errorText: { color: '#ff8a8a', fontSize: 12 },
  emptyText: { color: GREY, textAlign: 'center', marginTop: 40, fontSize: 13 },
  card: {
    backgroundColor: DARK, borderRadius: 14, padding: 16, marginBottom: 12,
    borderWidth: 0.5, borderColor: '#333',
  },
  cardTopRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  reportedName: { color: '#fff', fontSize: 14, fontWeight: '700' },
  badgeOpen: { backgroundColor: '#3a2800', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 },
  badgeResolved: { backgroundColor: '#1a3a1a', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 },
  badgeDismissed: { backgroundColor: '#333', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 },
  badgeText: { color: '#fff', fontSize: 10, fontWeight: '700', textTransform: 'uppercase' },
  reason: { color: GOLD, fontSize: 13, fontWeight: '700', marginBottom: 4 },
  details: { color: '#ccc', fontSize: 12, fontStyle: 'italic', marginBottom: 8, lineHeight: 17 },
  metaRow: { marginTop: 4 },
  metaText: { color: GREY, fontSize: 11 },
  dateText: { color: '#555', fontSize: 10, marginTop: 4 },
  actionsRow: { flexDirection: 'row', gap: 10, marginTop: 14 },
  suspendedBox: {
    marginTop: 12, backgroundColor: '#3a1a1a', borderRadius: 10, padding: 12,
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    borderWidth: 0.5, borderColor: '#5a2a2a',
  },
  suspendedText: { color: '#ff8a8a', fontSize: 12, fontWeight: '700', flex: 1 },
  liftBtn: { backgroundColor: DARK, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6, marginLeft: 8 },
  liftBtnText: { color: GOLD, fontSize: 11, fontWeight: '700' },
  suspendRow: { flexDirection: 'row', gap: 8, marginTop: 12 },
  suspendChip: { backgroundColor: '#2a1a1a', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 7, borderWidth: 0.5, borderColor: '#5a2a2a' },
  suspendChipText: { color: '#ff8a8a', fontSize: 11, fontWeight: '600' },
  suspendChipPermanent: { backgroundColor: '#8a2a2a', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 7 },
  suspendChipPermanentText: { color: '#fff', fontSize: 11, fontWeight: '700' },
  actionBtn: { flex: 1, borderRadius: 10, paddingVertical: 11, alignItems: 'center' },
  dismissBtn: { backgroundColor: '#222', borderWidth: 0.5, borderColor: '#444' },
  dismissBtnText: { color: GREY, fontSize: 12, fontWeight: '700' },
  resolveBtn: { backgroundColor: GOLD },
  resolveBtnText: { color: BLACK, fontSize: 12, fontWeight: '700' },
});
