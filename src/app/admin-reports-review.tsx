// app/admin-reports-review.tsx
//
// ⚠️ FIX (serious bug, found during a full-codebase sweep): this file
// was a byte-for-byte duplicate of admin-verification-review.tsx.
// Because Expo Router is file-based, that meant the /admin-reports-
// review route — the one every other admin screen cross-links to as
// "Reports" (see admin-verification-review.tsx and
// admin-security-incidents.tsx, both of which already assumed this
// screen existed and worked) — actually rendered the verification
// queue a second time. There was no way anywhere in the app for an
// admin to actually see what had been submitted via report-user.tsx;
// every report anyone filed just sat in the `reports` table with no
// interface, exactly the same "table with no interface isn't usable"
// gap admin-security-incidents.tsx's own header comment describes
// having fixed for security_incidents.
//
// This is a genuine rebuild, not a tweak — built to match report-
// user.tsx's actual insert shape (reporter_id, reported_user_id,
// listing_id, context, reason, details) and the same admin-gating
// pattern already used by admin-security-incidents.tsx: an explicit
// profiles.is_admin check (not inferred from a query error, which RLS
// can return successfully with zero rows for — see that screen's own
// fix earlier in this sweep), with RLS on `reports` itself as the real
// data-access gate.
//
// NOTE: this is intentionally READ-ONLY for now. There's no confirmed
// `resolved`/status column on `reports` in what's been reviewed so
// far — rather than guess at a schema column that might not exist
// (and silently fail to update if it doesn't), this only lists reports
// with reporter/reported/listing context resolved for readability.
// Add a resolution workflow once that schema decision is made.
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

type Report = {
  id: string;
  reporter_id: string;
  reported_user_id: string;
  listing_id: number | null;
  context: string;
  reason: string;
  details: string | null;
  created_at: string;
};

type EnrichedReport = Report & {
  reporterName: string;
  reportedName: string;
  listingTitle: string | null;
};

const CONTEXT_LABEL: Record<string, string> = {
  listing: '🏷️ Listing',
  chat: '💬 Chat',
  wanted: '🔍 Wanted post',
  other: '❓ Other',
};

export default function AdminReportsReviewScreen() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [authorized, setAuthorized] = useState(false);
  const [reports, setReports] = useState<EnrichedReport[]>([]);
  const [error, setError] = useState('');

  useEffect(() => { load(); }, []);

  async function handleRefresh() {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }

  async function load() {
    setLoading(true);
    setError('');

    // Same explicit is_admin check as admin-security-incidents.tsx —
    // not inferred from a query error, since RLS can return an empty
    // result set successfully instead of erroring.
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

    const { data, error: fetchError } = await supabase
      .from('reports')
      .select('*')
      .order('created_at', { ascending: false });

    if (fetchError) {
      setError(fetchError.message);
      setLoading(false);
      return;
    }

    const list: Report[] = data ?? [];

    // Resolved client-side against separate lookups (same pattern
    // quotes.tsx uses for operator profiles), rather than guessing at
    // Supabase embedded-resource / FK constraint names this sweep
    // hasn't confirmed exist for the `reports` table.
    const userIds = [...new Set(list.flatMap((r) => [r.reporter_id, r.reported_user_id]))];
    const listingIds = [...new Set(list.map((r) => r.listing_id).filter((id): id is number => id != null))];

    const [{ data: profiles }, { data: listings }] = await Promise.all([
      userIds.length > 0
        ? supabase.from('profiles').select('id, full_name, email').in('id', userIds)
        : Promise.resolve({ data: [] as any[] }),
      listingIds.length > 0
        ? supabase.from('listings').select('id, title').in('id', listingIds)
        : Promise.resolve({ data: [] as any[] }),
    ]);

    const profileMap: Record<string, string> = {};
    (profiles ?? []).forEach((p: any) => { profileMap[p.id] = p.full_name || p.email || 'Unknown user'; });
    const listingMap: Record<number, string> = {};
    (listings ?? []).forEach((l: any) => { listingMap[l.id] = l.title; });

    const enriched: EnrichedReport[] = list.map((r) => ({
      ...r,
      reporterName: profileMap[r.reporter_id] ?? 'Unknown user',
      reportedName: profileMap[r.reported_user_id] ?? 'Unknown user',
      listingTitle: r.listing_id != null ? (listingMap[r.listing_id] ?? null) : null,
    }));

    setReports(enriched);
    setLoading(false);
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
          <Text style={styles.backBtnCenteredText}>← Back to home</Text>
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
            <Text style={styles.backText}>← Back</Text>
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
            ? 'No reports have been filed.'
            : `${reports.length} report${reports.length === 1 ? '' : 's'} filed.`}
        </Text>

        {error ? (
          <View style={styles.errorBox}><Text style={styles.errorText}>⚠️ {error}</Text></View>
        ) : null}

        {reports.map((r) => (
          <View key={r.id} style={styles.card}>
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
                <Text style={styles.partyLabel}>Reported by: </Text>{r.reporterName}
              </Text>
              <Text style={styles.partyLine}>
                <Text style={styles.partyLabel}>Reported user: </Text>{r.reportedName}
              </Text>
              {r.listingTitle ? (
                <Text style={styles.partyLine}>
                  <Text style={styles.partyLabel}>Listing: </Text>{r.listingTitle}
                </Text>
              ) : null}
            </View>
          </View>
        ))}

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
});
