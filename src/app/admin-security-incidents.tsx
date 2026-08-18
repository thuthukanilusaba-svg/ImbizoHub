// app/admin-security-incidents.tsx
// Admin screen for the security_incidents table (see
// security-incidents-table.sql) — closes the real gap flagged when
// that table was first built: a table with no interface isn't
// actually usable, just a database row waiting for someone to run raw
// SQL. This is that interface.
//
// Same admin-only pattern as admin-verification-review.tsx and
// admin-reports-review.tsx: RLS on security_incidents itself is the
// real gate (admin-only select/insert/update), not this screen's own
// client-side check — that check only controls whether the UI shows
// at all, matching the same reasoning used throughout this app's
// other admin screens.
//
// No nav entry point added anywhere else in the app, same as the
// other two admin screens — reach via a direct link. Cross-links to
// both existing admin screens, and they're updated to link here too,
// so all three admin areas are reachable from one another once an
// admin is on any of them.
//
// Usage: router.push('/admin-security-incidents')

import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator, Platform, ScrollView, StyleSheet,
  Text, TextInput, TouchableOpacity, View,
} from 'react-native';
import { supabase } from '../../lib/supabase';

const GOLD = '#B8860B';
const BLACK = '#1A1A18';
const DARK = '#2a2a2a';
const GREY = '#AAAAAA';
const GREEN = '#4fc96e';
const RED = '#ff8a8a';

type Severity = 'low' | 'medium' | 'high' | 'critical';

const SEVERITY_COLOR: Record<Severity, string> = {
  low: '#4fc96e',
  medium: '#B8860B',
  high: '#ff9a4a',
  critical: '#ff5a5a',
};

const DATA_CATEGORIES = [
  'id_documents', 'payment_records', 'messages', 'profile_data', 'location_data', 'other',
];

type Incident = {
  id: string;
  discovered_at: string;
  occurred_at: string | null;
  description: string;
  data_categories_affected: string[];
  severity: Severity;
  approx_individuals_affected: number | null;
  containment_steps_taken: string | null;
  reported_to_potraz: boolean;
  potraz_reported_at: string | null;
  users_notified: boolean;
  users_notified_at: string | null;
  resolved: boolean;
  resolved_at: string | null;
};

export default function AdminSecurityIncidentsScreen() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [authorized, setAuthorized] = useState(false);
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [error, setError] = useState('');

  const [showNewForm, setShowNewForm] = useState(false);
  const [description, setDescription] = useState('');
  const [severity, setSeverity] = useState<Severity>('medium');
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);
  const [individualsAffected, setIndividualsAffected] = useState('');
  const [containmentSteps, setContainmentSteps] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const [updatingId, setUpdatingId] = useState<string | null>(null);

  useEffect(() => { load(); }, []);

  async function load() {
    setLoading(true);
    setError('');

    // FIX (real bug, found during a thorough review): this used to
    // infer admin status purely from whether the incidents query
    // below returned an error — but RLS on a plain SELECT typically
    // filters rows SILENTLY rather than raising an error (unlike the
    // RPC-based admin screens, which explicitly raise an exception).
    // That meant a non-admin reaching this screen would never actually
    // see "Not authorized" — they'd see the full admin UI with just an
    // empty list, since RLS quietly returned zero rows instead of
    // erroring. The underlying data was always protected either way,
    // but the UI-gating didn't match what it claimed to do. Checking
    // profiles.is_admin explicitly instead of inferring it.
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
      .from('security_incidents')
      .select('*')
      .order('discovered_at', { ascending: false });

    if (fetchError) {
      setError(fetchError.message);
      setLoading(false);
      return;
    }

    setIncidents(data ?? []);
    setLoading(false);
  }

  function toggleCategory(cat: string) {
    setSelectedCategories((prev) =>
      prev.includes(cat) ? prev.filter((c) => c !== cat) : [...prev, cat]
    );
  }

  async function handleLogIncident() {
    setError('');
    if (!description.trim()) {
      setError('Please describe what happened.');
      return;
    }

    setSubmitting(true);
    const { data: { user } } = await supabase.auth.getUser();

    const { error: insertError } = await supabase.from('security_incidents').insert({
      description: description.trim(),
      severity,
      data_categories_affected: selectedCategories,
      approx_individuals_affected: individualsAffected ? parseInt(individualsAffected, 10) : null,
      containment_steps_taken: containmentSteps.trim() || null,
      logged_by: user?.id ?? null,
    });

    setSubmitting(false);

    if (insertError) {
      setError(insertError.message);
      return;
    }

    setDescription('');
    setSeverity('medium');
    setSelectedCategories([]);
    setIndividualsAffected('');
    setContainmentSteps('');
    setShowNewForm(false);
    await load();
  }

  async function toggleStatus(
    incident: Incident,
    field: 'reported_to_potraz' | 'users_notified' | 'resolved',
    timestampField: 'potraz_reported_at' | 'users_notified_at' | 'resolved_at'
  ) {
    setUpdatingId(incident.id);
    const newValue = !incident[field];

    const { error: updateError } = await supabase
      .from('security_incidents')
      .update({ [field]: newValue, [timestampField]: newValue ? new Date().toISOString() : null })
      .eq('id', incident.id);

    setUpdatingId(null);

    if (updateError) {
      setError(updateError.message);
      return;
    }

    setIncidents((prev) =>
      prev.map((i) => (i.id === incident.id ? { ...i, [field]: newValue, [timestampField]: newValue ? new Date().toISOString() : null } : i))
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
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.topRow}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
            <Text style={styles.backText}><Text style={styles.backArrow}>‹</Text> Back</Text>
          </TouchableOpacity>
          <View style={styles.crossLinkRow}>
            <TouchableOpacity onPress={() => router.push('/admin-verification-review')}>
              <Text style={styles.crossLinkText}>Verification</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => router.push('/admin-reports-review')}>
              <Text style={styles.crossLinkText}>Reports</Text>
            </TouchableOpacity>
          </View>
        </View>

        <Text style={styles.heading}>Security incidents</Text>
        <Text style={styles.subheading}>
          {incidents.length === 0
            ? 'No incidents logged.'
            : `${incidents.length} incident${incidents.length === 1 ? '' : 's'} logged.`}
        </Text>

        {error ? (
          <View style={styles.errorBox}><Text style={styles.errorText}>⚠️ {error}</Text></View>
        ) : null}

        {!showNewForm ? (
          <TouchableOpacity style={styles.newIncidentBtn} onPress={() => setShowNewForm(true)}>
            <Text style={styles.newIncidentBtnText}>+ Log new incident</Text>
          </TouchableOpacity>
        ) : (
          <View style={styles.formCard}>
            <Text style={styles.formTitle}>Log a new incident</Text>

            <Text style={styles.label}>What happened? *</Text>
            <TextInput
              style={[styles.input, styles.textArea]}
              value={description}
              onChangeText={setDescription}
              placeholder="Describe what happened, what was discovered, and when"
              placeholderTextColor="#666"
              multiline
              numberOfLines={4}
            />

            <Text style={styles.label}>Severity</Text>
            <View style={styles.chipRow}>
              {(['low', 'medium', 'high', 'critical'] as Severity[]).map((s) => (
                <TouchableOpacity
                  key={s}
                  style={[
                    styles.severityChip,
                    severity === s && { backgroundColor: SEVERITY_COLOR[s], borderColor: SEVERITY_COLOR[s] },
                  ]}
                  onPress={() => setSeverity(s)}
                >
                  <Text style={[styles.severityChipText, severity === s && { color: BLACK, fontWeight: '800' }]}>
                    {s}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            <Text style={styles.label}>Data categories affected</Text>
            <View style={styles.chipRow}>
              {DATA_CATEGORIES.map((cat) => (
                <TouchableOpacity
                  key={cat}
                  style={[styles.catChip, selectedCategories.includes(cat) && styles.catChipActive]}
                  onPress={() => toggleCategory(cat)}
                >
                  <Text style={[styles.catChipText, selectedCategories.includes(cat) && styles.catChipTextActive]}>
                    {cat.replace('_', ' ')}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            <Text style={styles.label}>Approx. individuals affected</Text>
            <TextInput
              style={styles.input}
              value={individualsAffected}
              onChangeText={setIndividualsAffected}
              placeholder="e.g. 12"
              placeholderTextColor="#666"
              keyboardType="number-pad"
            />

            <Text style={styles.label}>Containment steps taken</Text>
            <TextInput
              style={[styles.input, styles.textArea]}
              value={containmentSteps}
              onChangeText={setContainmentSteps}
              placeholder="e.g. Rotated service role key, tightened RLS policy on..."
              placeholderTextColor="#666"
              multiline
              numberOfLines={3}
            />

            <View style={styles.formActions}>
              <TouchableOpacity
                style={styles.cancelBtn}
                onPress={() => setShowNewForm(false)}
                disabled={submitting}
              >
                <Text style={styles.cancelBtnText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.submitBtn, submitting && { opacity: 0.6 }]}
                onPress={handleLogIncident}
                disabled={submitting}
              >
                {submitting
                  ? <ActivityIndicator color={BLACK} size="small" />
                  : <Text style={styles.submitBtnText}>Log incident</Text>
                }
              </TouchableOpacity>
            </View>
          </View>
        )}

        {incidents.map((incident) => {
          const isUpdating = updatingId === incident.id;
          return (
            <View key={incident.id} style={styles.card}>
              <View style={styles.cardTop}>
                <View style={[styles.severityBadge, { backgroundColor: SEVERITY_COLOR[incident.severity] }]}>
                  <Text style={styles.severityBadgeText}>{incident.severity.toUpperCase()}</Text>
                </View>
                <Text style={styles.discoveredAt}>
                  {new Date(incident.discovered_at).toLocaleDateString('en-GB', {
                    day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
                  })}
                </Text>
              </View>

              <Text style={styles.description}>{incident.description}</Text>

              {incident.data_categories_affected.length > 0 && (
                <View style={styles.catRow}>
                  {incident.data_categories_affected.map((cat) => (
                    <View key={cat} style={styles.catBadge}>
                      <Text style={styles.catBadgeText}>{cat.replace('_', ' ')}</Text>
                    </View>
                  ))}
                </View>
              )}

              {incident.approx_individuals_affected != null && (
                <Text style={styles.metaText}>~{incident.approx_individuals_affected} individuals affected</Text>
              )}

              {incident.containment_steps_taken ? (
                <Text style={styles.containmentText}>Containment: {incident.containment_steps_taken}</Text>
              ) : null}

              <View style={styles.statusRow}>
                <TouchableOpacity
                  style={[styles.statusToggle, incident.reported_to_potraz && styles.statusToggleActive]}
                  onPress={() => toggleStatus(incident, 'reported_to_potraz', 'potraz_reported_at')}
                  disabled={isUpdating}
                >
                  <Text style={[styles.statusToggleText, incident.reported_to_potraz && styles.statusToggleTextActive]}>
                    {incident.reported_to_potraz ? '✓' : '○'} Reported to POTRAZ
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.statusToggle, incident.users_notified && styles.statusToggleActive]}
                  onPress={() => toggleStatus(incident, 'users_notified', 'users_notified_at')}
                  disabled={isUpdating}
                >
                  <Text style={[styles.statusToggleText, incident.users_notified && styles.statusToggleTextActive]}>
                    {incident.users_notified ? '✓' : '○'} Users notified
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.statusToggle, incident.resolved && styles.statusToggleResolved]}
                  onPress={() => toggleStatus(incident, 'resolved', 'resolved_at')}
                  disabled={isUpdating}
                >
                  <Text style={[styles.statusToggleText, incident.resolved && styles.statusToggleTextActive]}>
                    {incident.resolved ? '✓' : '○'} Resolved
                  </Text>
                </TouchableOpacity>
              </View>
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

  newIncidentBtn: { backgroundColor: GOLD, borderRadius: 12, paddingVertical: 14, alignItems: 'center', marginBottom: 20 },
  newIncidentBtnText: { color: BLACK, fontSize: 14, fontWeight: '800' },

  formCard: { backgroundColor: BLACK, borderRadius: 14, padding: 18, marginBottom: 20, borderWidth: 1, borderColor: GOLD },
  formTitle: { color: '#fff', fontSize: 16, fontWeight: '800', marginBottom: 4 },
  label: { fontSize: 12, fontWeight: '700', color: '#fff', marginBottom: 6, marginTop: 14 },
  input: {
    backgroundColor: DARK, borderRadius: 10, paddingHorizontal: 14,
    paddingVertical: Platform.OS === 'ios' ? 13 : 10, fontSize: 14, color: '#fff',
    borderWidth: 0.5, borderColor: '#333',
  },
  textArea: { height: 80, textAlignVertical: 'top', paddingTop: 10 },

  chipRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  severityChip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, backgroundColor: DARK, borderWidth: 1, borderColor: '#333' },
  severityChipText: { color: GREY, fontSize: 12, fontWeight: '600', textTransform: 'capitalize' },
  catChip: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 18, backgroundColor: DARK, borderWidth: 1, borderColor: '#333' },
  catChipActive: { backgroundColor: '#2a2200', borderColor: GOLD },
  catChipText: { color: GREY, fontSize: 11, fontWeight: '600', textTransform: 'capitalize' },
  catChipTextActive: { color: GOLD },

  formActions: { flexDirection: 'row', gap: 10, marginTop: 20 },
  cancelBtn: { flex: 1, borderRadius: 10, paddingVertical: 13, alignItems: 'center', backgroundColor: DARK },
  cancelBtnText: { color: GREY, fontWeight: '600' },
  submitBtn: { flex: 2, borderRadius: 10, paddingVertical: 13, alignItems: 'center', backgroundColor: GOLD },
  submitBtnText: { color: BLACK, fontWeight: '800' },

  card: { backgroundColor: BLACK, borderRadius: 14, padding: 16, marginBottom: 14, borderWidth: 0.5, borderColor: '#333' },
  cardTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  severityBadge: { borderRadius: 6, paddingHorizontal: 10, paddingVertical: 4 },
  severityBadgeText: { color: BLACK, fontSize: 10, fontWeight: '800' },
  discoveredAt: { color: '#666', fontSize: 11 },

  description: { color: '#fff', fontSize: 13, lineHeight: 19, marginBottom: 10 },

  catRow: { flexDirection: 'row', gap: 6, flexWrap: 'wrap', marginBottom: 10 },
  catBadge: { backgroundColor: DARK, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 },
  catBadgeText: { color: GREY, fontSize: 10, textTransform: 'capitalize' },

  metaText: { color: GREY, fontSize: 12, marginBottom: 6 },
  containmentText: { color: GREY, fontSize: 12, lineHeight: 17, marginBottom: 12, fontStyle: 'italic' },

  statusRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap', marginTop: 6 },
  statusToggle: { paddingHorizontal: 10, paddingVertical: 7, borderRadius: 8, backgroundColor: DARK, borderWidth: 0.5, borderColor: '#444' },
  statusToggleActive: { backgroundColor: '#1a2a1a', borderColor: '#2a4a2a' },
  statusToggleResolved: { backgroundColor: '#1a2a1a', borderColor: GREEN },
  statusToggleText: { color: GREY, fontSize: 11, fontWeight: '600' },
  statusToggleTextActive: { color: GREEN },
});
