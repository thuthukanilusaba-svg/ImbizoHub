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
  ActivityIndicator, Alert, Modal, Platform, RefreshControl, ScrollView, StyleSheet,
  Text, TextInput, TouchableOpacity, View,
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

/**
 * A permanent block writes suspended_until = 'infinity', which PostgREST
 * serialises as the literal string "infinity".
 *
 * new Date("infinity") is an Invalid Date and NaN > Date.now() is FALSE,
 * so the plain date comparison this screen used would have shown a
 * blocked scammer as not suspended at all — offering to block him again
 * and hiding the button that lifts it. Every read of suspended_until
 * goes through these two.
 */
function isBlockedForever(until: string | null): boolean {
  return until === 'infinity';
}

function isCurrentlyStopped(until: string | null): boolean {
  if (!until) return false;
  if (isBlockedForever(until)) return true;
  return new Date(until).getTime() > Date.now();
}

/**
 * Written to profiles.suspension_reason, pushed to the person by
 * notify-user-suspended, AND read back at them by
 * enforce_not_suspended() every time they try to act. So this text is
 * the whole explanation they ever get — it is phrased for the person
 * being blocked, not for the moderation queue.
 */
const BLOCK_REASONS = [
  'Scamming — took payment and did not deliver',
  'Fake or misleading listings',
  'Impersonating someone else',
  'Harassment or abusive messages',
  'Selling prohibited or stolen goods',
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

  // The report whose account is being blocked, null when the sheet is
  // closed. Holding the report rather than a boolean keeps the reason
  // typed so far bound to the person it is about.
  const [blocking, setBlocking] = useState<Report | null>(null);
  const [blockReason, setBlockReason] = useState('');
  const [blockError, setBlockError] = useState('');

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

    // is_admin is no longer exposed on the table — it told an attacker
    // exactly which account to go after. my_profile() returns it for
    // the caller's own row only. The RPCs behind this screen re-check
    // is_admin server-side regardless; this only decides what to render.
    const { data: profile } = await supabase.rpc('my_profile').single();

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

  // THE ACTION THIS SCREEN WAS MISSING.
  //
  // Until now the only buttons here were "Mark reviewed" and "Dismiss",
  // and admin_review_report() does exactly one thing: update the report's
  // status. Nothing reached the reported ACCOUNT. admin_suspend_user() has
  // existed and worked the whole time — it sets suspended_until, records a
  // reason, and calls notify-user-suspended to tell the person — but no
  // screen in the app ever called it. The only way to suspend anybody was
  // to open the Supabase dashboard and write SQL by hand.
  //
  // The report is marked reviewed at the same time, because suspending
  // someone over a report and leaving that report sitting in Open is how a
  // queue stops meaning anything.
  async function handleSuspend(report: Report, days: number) {
    const label = report.reported_user_name ?? 'this user';
    Alert.alert(
      `Suspend ${label}?`,
      `They will not be able to post listings, send messages, post or answer Wanted posts, post trips, quote, or leave ratings for ${days} day${days === 1 ? '' : 's'}. They are told why.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: `Suspend ${days}d`,
          style: 'destructive',
          onPress: async () => {
            setUpdatingId(report.report_id);
            const { error: rpcError } = await supabase.rpc('admin_suspend_user', {
              p_user_id: report.reported_user_id,
              p_days: days,
              p_reason: report.reason ?? 'Reported by another user',
            });

            if (rpcError) {
              setUpdatingId(null);
              setError(rpcError.message);
              return;
            }

            // A suspension IS the review. Leaving the report Open after
            // acting on it would mean the queue no longer reflects what
            // has actually been dealt with.
            await supabase.rpc('admin_review_report', {
              p_report_id: report.report_id,
              p_new_status: 'reviewed',
            });

            setUpdatingId(null);
            load(filter);
          },
        },
      ]
    );
  }

  // BLOCKING. Separate from suspension on purpose: a suspension is a
  // cooling-off period and its reason can be the reporter's category, but
  // a block is permanent and the reason is the only thing the person ever
  // gets told, so it is typed by a moderator and admin_block_user()
  // rejects an empty one.
  //
  // A modal rather than Alert.alert with a text field: RN has no cross
  // platform prompt (Alert.prompt is iOS-only), and react-native-web
  // ignores Alert's buttons array entirely — the same thing that made the
  // chat attachment menu look dead on web. This screen is used from a
  // desktop browser as often as a phone.
  function openBlockSheet(report: Report) {
    setBlocking(report);
    setBlockReason('');
  }

  async function confirmBlock() {
    if (!blocking) return;
    const reason = blockReason.trim();
    if (!reason) {
      setBlockError('Give a reason — the person is shown this text and nothing else.');
      return;
    }

    setBlockError('');
    setUpdatingId(blocking.report_id);

    const { error: rpcError } = await supabase.rpc('admin_block_user', {
      p_user_id: blocking.reported_user_id,
      p_reason: reason,
    });

    if (rpcError) {
      setUpdatingId(null);
      setBlockError(rpcError.message);
      return;
    }

    // Same reasoning as handleSuspend: acting on a report IS reviewing
    // it, and a queue that still shows it as Open stops meaning anything.
    await supabase.rpc('admin_review_report', {
      p_report_id: blocking.report_id,
      p_new_status: 'reviewed',
    });

    setUpdatingId(null);
    setBlocking(null);
    setBlockReason('');
    load(filter);
  }

  async function handleUnsuspend(report: Report) {
    setUpdatingId(report.report_id);
    const { error: rpcError } = await supabase.rpc('admin_unsuspend_user', {
      p_user_id: report.reported_user_id,
    });
    setUpdatingId(null);
    if (rpcError) {
      setError(rpcError.message);
      return;
    }
    load(filter);
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
          const isSuspended = isCurrentlyStopped(r.reported_user_suspended_until);
          const isBlocked = isBlockedForever(r.reported_user_suspended_until);

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
                  {isBlocked ? ' (BLOCKED)' : isSuspended ? ' (currently suspended)' : ''}
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

              {/* Suspension is offered on EVERY report, not only open ones.
                  A report already marked reviewed can turn out to matter
                  after a second complaint about the same person, and
                  having to reopen it first would be friction at exactly
                  the wrong moment. */}
              {isSuspended ? (
                <TouchableOpacity
                  style={[styles.actionBtn, styles.unsuspendBtn, updatingId === r.report_id && styles.actionBtnDisabled]}
                  disabled={updatingId === r.report_id}
                  onPress={() => handleUnsuspend(r)}
                >
                  <Text style={styles.unsuspendBtnText}>
                    {updatingId === r.report_id ? '...' : isBlocked ? 'Unblock this account' : 'Lift suspension'}
                  </Text>
                </TouchableOpacity>
              ) : (
                <View style={styles.suspendRow}>
                  {/* 3 days removed: too short to be a real consequence
                      and it made the row read as a sliding scale, which
                      invited picking the smallest option by default. 7
                      and 30 are the cooling-off periods; anything worse
                      than 30 days is not a longer suspension, it is a
                      block. */}
                  <Text style={styles.suspendLabel}>Suspend this account</Text>
                  <View style={styles.actionRow}>
                    {[7, 30].map((days) => (
                      <TouchableOpacity
                        key={days}
                        style={[styles.actionBtn, styles.suspendBtn, updatingId === r.report_id && styles.actionBtnDisabled]}
                        disabled={updatingId === r.report_id}
                        onPress={() => handleSuspend(r, days)}
                      >
                        <Text style={styles.suspendBtnText}>{days} days</Text>
                      </TouchableOpacity>
                    ))}
                  </View>

                  <Text style={[styles.suspendLabel, styles.blockLabel]}>Scamming? Block permanently</Text>
                  <TouchableOpacity
                    style={[styles.actionBtn, styles.blockBtn, updatingId === r.report_id && styles.actionBtnDisabled]}
                    disabled={updatingId === r.report_id}
                    onPress={() => openBlockSheet(r)}
                  >
                    <Text style={styles.blockBtnText}>
                      🚫 Block {r.reported_user_name ?? 'this account'}
                    </Text>
                  </TouchableOpacity>
                </View>
              )}
            </View>
          );
        })}

        <View style={{ height: 40 }} />
      </ScrollView>

      {/* THE BLOCK SHEET. The reason typed here is the entire explanation
          the person ever receives, through three channels:
            1. profiles.suspension_reason  (the record)
            2. notify-user-suspended       (a push, if they have a token)
            3. enforce_not_suspended()     (raised at them the next time
                                            they try to post or message)
          (3) is the one that always lands, which is why the wording is
          addressed to them rather than filed as a moderator's note. */}
      <Modal visible={!!blocking} transparent animationType="fade" onRequestClose={() => setBlocking(null)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>
              Block {blocking?.reported_user_name ?? 'this account'}?
            </Text>
            <Text style={styles.modalBody}>
              Permanent. They keep their login but cannot post listings, send messages,
              post or answer Wanted posts, post trips, quote, or leave ratings — ever,
              until you unblock them. They are told the reason below.
            </Text>

            <Text style={styles.modalLabel}>Reason (they see this)</Text>
            <View style={styles.reasonChips}>
              {BLOCK_REASONS.map((preset) => (
                <TouchableOpacity
                  key={preset}
                  style={[styles.reasonChip, blockReason === preset && styles.reasonChipActive]}
                  onPress={() => { setBlockReason(preset); setBlockError(''); }}
                >
                  <Text style={[styles.reasonChipText, blockReason === preset && styles.reasonChipTextActive]}>
                    {preset}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            <TextInput
              style={styles.reasonInput}
              value={blockReason}
              onChangeText={(t) => { setBlockReason(t); setBlockError(''); }}
              placeholder="Or write your own reason"
              placeholderTextColor="#666"
              multiline
              maxLength={300}
            />

            {blockError ? <Text style={styles.modalError}>{blockError}</Text> : null}

            <View style={styles.modalActions}>
              <TouchableOpacity style={styles.modalCancel} onPress={() => setBlocking(null)}>
                <Text style={styles.modalCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalConfirm, !!updatingId && styles.actionBtnDisabled]}
                disabled={!!updatingId}
                onPress={confirmBlock}
              >
                <Text style={styles.modalConfirmText}>
                  {updatingId ? 'Blocking…' : 'Block permanently'}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
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

  // Suspension is set apart from Mark reviewed / Dismiss on purpose: those
  // two file a report away, this one takes something from a person. It
  // gets its own label, its own row, and a red that appears nowhere else
  // on the screen, so it can never be the button you meant to hit.
  suspendRow: { marginTop: 16, borderTopWidth: 0.5, borderTopColor: '#333', paddingTop: 12 },
  suspendLabel: { color: GREY, fontSize: 11, fontWeight: '700', letterSpacing: 0.4, textTransform: 'uppercase' },
  suspendBtn: { backgroundColor: '#3a1a1a', borderWidth: 0.5, borderColor: '#7a2f2f' },
  suspendBtnText: { color: '#ff8a8a', fontSize: 12, fontWeight: '800' },
  unsuspendBtn: { backgroundColor: DARK, borderWidth: 0.5, borderColor: '#444', marginTop: 14, alignSelf: 'flex-start' },
  unsuspendBtnText: { color: GREEN, fontSize: 12, fontWeight: '800' },

  // Deliberately louder than suspendBtn — a solid red fill against that
  // one's muted outline. This action does not expire and cannot be
  // undone by waiting, so it should not look like the next notch along
  // from "30 days".
  blockLabel: { marginTop: 16 },
  blockBtn: { backgroundColor: '#7a1f1f', borderWidth: 0.5, borderColor: '#a83232', marginTop: 8, flex: 0 },
  blockBtnText: { color: '#ffd9d9', fontSize: 12, fontWeight: '800' },

  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.75)', justifyContent: 'center', padding: 20 },
  modalCard: { backgroundColor: '#1f1f1d', borderRadius: 16, padding: 20, borderWidth: 0.5, borderColor: '#3a3a3a' },
  modalTitle: { color: '#fff', fontSize: 18, fontWeight: '800', marginBottom: 8 },
  modalBody: { color: GREY, fontSize: 13, lineHeight: 19, marginBottom: 16 },
  modalLabel: { color: GREY, fontSize: 11, fontWeight: '700', letterSpacing: 0.4, textTransform: 'uppercase', marginBottom: 8 },
  reasonChips: { flexDirection: 'row', flexWrap: 'wrap', marginBottom: 12 },
  reasonChip: { borderWidth: 0.5, borderColor: '#444', borderRadius: 999, paddingHorizontal: 12, paddingVertical: 7, marginRight: 8, marginBottom: 8 },
  reasonChipActive: { backgroundColor: '#3a1a1a', borderColor: '#a83232' },
  reasonChipText: { color: GREY, fontSize: 12, fontWeight: '600' },
  reasonChipTextActive: { color: '#ffd9d9' },
  reasonInput: {
    backgroundColor: BLACK, borderRadius: 10, borderWidth: 0.5, borderColor: '#444',
    color: '#fff', fontSize: 14, padding: 12, minHeight: 64, textAlignVertical: 'top',
  },
  modalError: { color: RED, fontSize: 12, marginTop: 10 },
  modalActions: { flexDirection: 'row', marginTop: 18 },
  modalCancel: { flex: 1, paddingVertical: 14, alignItems: 'center', borderRadius: 12, borderWidth: 0.5, borderColor: '#444', marginRight: 10 },
  modalCancelText: { color: GREY, fontSize: 14, fontWeight: '700' },
  modalConfirm: { flex: 2, paddingVertical: 14, alignItems: 'center', borderRadius: 12, backgroundColor: '#7a1f1f', borderWidth: 0.5, borderColor: '#a83232' },
  modalConfirmText: { color: '#ffd9d9', fontSize: 14, fontWeight: '800' },
  statusTag: { color: '#666', fontSize: 11, marginTop: 12, fontStyle: 'italic' },
});
