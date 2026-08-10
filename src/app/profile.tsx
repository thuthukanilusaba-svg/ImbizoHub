// app/profile.tsx
// Profile screen with real Supabase data, optional photo upload, stats,
// star rating display, and recent reviews section.
//
// NEW: added the shared bottom nav (Home/Browse/+/Messages/Dashboard/Profile)
// for consistency with Home, Explore, Dealer, and Messages — this screen
// previously had no bottom nav at all.
//
// FIX (found during a full-app review pass): accountTypeLabel()'s map
// was missing 'delivery' — register.tsx stores a delivery operator's
// account_type as the raw string 'delivery' (unlike transport operators,
// which get mapped to 'transport_operator'). Without this entry, the
// fallback displayed the raw unformatted word "delivery" in the profile
// badge instead of a proper label like every other role gets.
//
// FLAGGED, NOT FIXED HERE — a real gap, not a quick patch: the "My
// deliveries" quick-link below always routes to seller-deliveries.tsx,
// which only shows bookings where this user is the SELLER
// (eq('seller_id', userId)). There is currently no screen anywhere in
// this app for a BUYER to track a delivery they booked as the
// purchaser — despite delivery-booking.tsx explicitly telling buyers
// "You'll receive a PIN to confirm receipt when the item is delivered."
// Needs an actual new screen (querying eq('buyer_id', userId) instead),
// not a quick redirect fix — left as-is pending a product decision on
// scope, rather than guessed at here.
//
// ALSO WORTH NOTING: "My trip requests" links to quotes.tsx, which only
// ever shows the single most recent OPEN trip request
// (.order(...).limit(1) in quotes.tsx's loadData()), not a list — so the
// plural label is a little misleading for someone who's posted more than
// one trip over time. Low priority, not fixed here.
//
// FIX: bottom nav now accounts for the device's own safe-area inset
// (gesture bar / nav buttons) instead of a hardcoded paddingBottom,
// which was overlapping with the system navigation on some phones.
//
// FIX: wrapped only the scrollable content area (not the whole screen)
// in KeyboardAvoidingView — this screen has a persistent, absolutely-
// positioned bottom nav bar, and wrapping the entire screen would have
// shifted that nav bar around unexpectedly whenever the keyboard opened
// (e.g. while editing Personal info). Keeping the nav bar as a plain
// sibling outside the KeyboardAvoidingView means it stays fixed at the
// real screen bottom regardless of keyboard state, while the scrollable
// form content above it still shifts to keep the focused field visible.
//
// NEW: "Earn with ImbizoHub" card given a genuine highlight treatment —
// a gold border on the card itself plus a small "💰 Earn" tag on each
// row — rather than introducing a new accent hue. Reuses the exact
// gold (#B8860B) already used throughout the app for anything meant to
// stand out (dealer.tsx's PRO/DRIVER badges, listing.tsx's promo
// buttons, register.tsx's active-toggle state), so this reads as "the
// same app being consistent," not a different visual language bolted
// onto one card. MenuRow gained an optional `highlighted` prop so only
// these two rows opt into the treatment — every other MenuRow usage on
// this screen (My activity, etc.) is completely unaffected.

import * as ImagePicker from 'expo-image-picker';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator, Alert, Image, KeyboardAvoidingView, Platform,
  ScrollView,
  StyleSheet,
  Text, TextInput, TouchableOpacity,
  View
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { supabase } from '../../lib/supabase';
import { prepareUpload } from '../../lib/uploadHelpers';

const GOLD = '#B8860B';
const BLACK = '#1A1A18';
const DARK = '#2a2a2a';
const GREY = '#AAAAAA';

export default function ProfileScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState(false);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [error, setError] = useState('');

  const [userId, setUserId] = useState('');
  const [email, setEmail] = useState('');
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [location, setLocation] = useState('');
  const [accountType, setAccountType] = useState('');
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [createdAt, setCreatedAt] = useState('');
  const [listingCount, setListingCount] = useState(0);
  const [rating, setRating] = useState(0);
  const [ratingCount, setRatingCount] = useState(0);
  const [recentReviews, setRecentReviews] = useState<any[]>([]);
  const [isActiveOperator, setIsActiveOperator] = useState(false);
  const [wantedResponseCount, setWantedResponseCount] = useState(0);

  const [draftName, setDraftName] = useState('');
  const [draftPhone, setDraftPhone] = useState('');
  const [draftLocation, setDraftLocation] = useState('');

  useEffect(() => { loadProfile(); }, []);

  async function loadProfile() {
    setLoading(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { router.replace('/login'); return; }

    setUserId(user.id);
    setEmail(user.email ?? '');

    const { data: profile } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', user.id)
      .maybeSingle();

    if (profile) {
      setFullName(profile.full_name ?? '');
      setPhone(profile.phone ?? '');
      setLocation(profile.location ?? '');
      setAccountType(profile.account_type ?? 'buyer');
      setAvatarUrl(profile.avatar_url ?? null);
      setCreatedAt(profile.created_at ?? '');
      setRating(profile.rating ?? 0);
      setRatingCount(profile.rating_count ?? 0);
      setDraftName(profile.full_name ?? '');
      setDraftPhone(profile.phone ?? '');
      setDraftLocation(profile.location ?? '');
    }

    const { count } = await supabase
      .from('listings')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', user.id);
    setListingCount(count ?? 0);

    const { data: reviews } = await supabase
      .from('ratings')
      .select('stars, review, role, created_at')
      .eq('reviewee_id', user.id)
      .order('created_at', { ascending: false })
      .limit(5);
    setRecentReviews(reviews ?? []);

    const { data: operator } = await supabase
      .from('delivery_operators')
      .select('registration_paid, registration_expires_at')
      .eq('user_id', user.id)
      .maybeSingle();

    setIsActiveOperator(!!(
      operator?.registration_paid &&
      operator?.registration_expires_at &&
      new Date(operator.registration_expires_at).getTime() > Date.now()
    ));

    const { data: myOpenRequests } = await supabase
      .from('item_requests')
      .select('id')
      .eq('user_id', user.id)
      .eq('status', 'open');

    if (myOpenRequests && myOpenRequests.length > 0) {
      const { count } = await supabase
        .from('item_responses')
        .select('*', { count: 'exact', head: true })
        .in('item_request_id', myOpenRequests.map((r) => r.id));
      setWantedResponseCount(count ?? 0);
    } else {
      setWantedResponseCount(0);
    }

    setLoading(false);
  }

  async function uploadAvatarUri(uri: string) {
    setUploadingAvatar(true);
    try {
      const { data: uploadData, contentType, extension } = await prepareUpload(uri);
      const fileName = `${userId}/avatar-${Date.now()}.${extension}`;

      const { error: uploadError } = await supabase.storage
        .from('avatars')
        .upload(fileName, uploadData, { contentType, upsert: false });

      if (uploadError) throw uploadError;

      const { data: urlData } = supabase.storage.from('avatars').getPublicUrl(fileName);
      await supabase.from('profiles').update({ avatar_url: urlData.publicUrl }).eq('id', userId);
      setAvatarUrl(urlData.publicUrl);
    } catch (err: any) {
      setError(`Upload failed: ${err.message}`);
    }
    setUploadingAvatar(false);
  }

  function chooseAvatarSource() {
    Alert.alert(
      'Update profile photo',
      undefined,
      [
        { text: 'Take Photo', onPress: takeAvatarPhoto },
        { text: 'Choose from Gallery', onPress: pickAvatar },
        { text: 'Cancel', style: 'cancel' },
      ]
    );
  }

  async function pickAvatar() {
    setError('');
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) { setError('Permission to access photos is required.'); return; }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true, aspect: [1, 1], quality: 0.7,
    });

    if (result.canceled) return;
    await uploadAvatarUri(result.assets[0].uri);
  }

  async function takeAvatarPhoto() {
    setError('');
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) { setError('Camera permission is required to take a photo.'); return; }

    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true, aspect: [1, 1], quality: 0.7,
    });

    if (result.canceled) return;
    await uploadAvatarUri(result.assets[0].uri);
  }

  function startEditing() {
    setDraftName(fullName); setDraftPhone(phone); setDraftLocation(location);
    setEditing(true); setError('');
  }

  async function saveProfile() {
    setError(''); setSaving(true);
    const { error: updateError } = await supabase
      .from('profiles')
      .update({ full_name: draftName.trim(), phone: draftPhone.trim(), location: draftLocation.trim() })
      .eq('id', userId);
    setSaving(false);
    if (updateError) { setError(updateError.message); return; }
    setFullName(draftName.trim()); setPhone(draftPhone.trim()); setLocation(draftLocation.trim());
    setEditing(false);
  }

  async function handleBecomeDeliveryOperator() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    await supabase.from('delivery_operators').upsert({
      user_id: user.id,
      full_name: fullName || '',
      verification_tier: 'unverified',
      status: 'active',
    }, { onConflict: 'user_id' });

    router.push('/delivery-operator-register-pay');
  }

  async function handleLogout() {
    await supabase.auth.signOut();
    router.replace('/login');
  }

  function initials() {
    if (fullName) return fullName.split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase();
    return email ? email[0].toUpperCase() : '?';
  }

  function joinedDate() {
    if (!createdAt) return '';
    return new Date(createdAt).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
  }

  function accountTypeLabel() {
    const map: Record<string, string> = {
      buyer: 'Buyer', seller: 'Seller', transport_operator: 'Transport Operator',
      delivery: 'Delivery Operator',
    };
    return map[accountType] || accountType;
  }

  function renderStars(count: number, size = 16) {
    return (
      <View style={{ flexDirection: 'row', gap: 2 }}>
        {[1, 2, 3, 4, 5].map((s) => (
          <Text key={s} style={{ fontSize: size, color: s <= Math.round(count) ? GOLD : '#333' }}>★</Text>
        ))}
      </View>
    );
  }

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={GOLD} />
      </View>
    );
  }

  const showDashboardTab = listingCount > 0 || isActiveOperator;

  return (
    <View style={styles.screen}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <ScrollView style={styles.container} contentContainerStyle={styles.content}>
          <View style={styles.header}>
            <Text style={styles.headerTitle}>Profile</Text>
            <TouchableOpacity onPress={handleLogout}>
              <Text style={styles.logoutText}>Logout</Text>
            </TouchableOpacity>
          </View>

          {/* Avatar + name */}
          <View style={styles.avatarSection}>
            <TouchableOpacity onPress={chooseAvatarSource} disabled={uploadingAvatar} style={styles.avatarWrap}>
              {avatarUrl ? (
                <Image source={{ uri: avatarUrl }} style={styles.avatarImage} />
              ) : (
                <View style={styles.avatarPlaceholder}>
                  <Text style={styles.avatarInitials}>{initials()}</Text>
                </View>
              )}
              {uploadingAvatar ? (
                <View style={styles.avatarOverlay}>
                  <ActivityIndicator color="#fff" size="small" />
                </View>
              ) : (
                <View style={styles.avatarEditBadge}>
                  <Text style={styles.avatarEditIcon}>📷</Text>
                </View>
              )}
            </TouchableOpacity>

            <Text style={styles.name}>{fullName || 'Add your name'}</Text>
            <Text style={styles.email}>{email}</Text>

            {ratingCount > 0 && (
              <View style={styles.ratingRow}>
                {renderStars(rating)}
                <Text style={styles.ratingText}>{rating.toFixed(1)} ({ratingCount} review{ratingCount === 1 ? '' : 's'})</Text>
              </View>
            )}

            <View style={styles.accountTypeBadge}>
              <Text style={styles.accountTypeText}>{accountTypeLabel()}</Text>
            </View>
          </View>

          {/* Stats */}
          <View style={styles.statsRow}>
            <View style={styles.statBox}>
              <Text style={styles.statValue}>{listingCount}</Text>
              <Text style={styles.statLabel}>Listings</Text>
            </View>
            <View style={styles.statDivider} />
            <View style={styles.statBox}>
              <Text style={styles.statValue}>
                {ratingCount > 0 ? rating.toFixed(1) : '—'}
              </Text>
              <Text style={styles.statLabel}>
                {ratingCount > 0 ? `Rating (${ratingCount})` : 'No ratings yet'}
              </Text>
            </View>
            <View style={styles.statDivider} />
            <View style={styles.statBox}>
              <Text style={styles.statValueSmall}>{joinedDate() || '—'}</Text>
              <Text style={styles.statLabel}>Joined</Text>
            </View>
          </View>

          {error ? (
            <View style={styles.errorBox}>
              <Text style={styles.errorText}>⚠️ {error}</Text>
            </View>
          ) : null}

          <View style={styles.card}>
            <Text style={styles.cardTitle}>My activity</Text>
            <MenuRow icon="🏷️" label="My listings" onPress={() => router.push('/my-listings')} />
            <MenuRow icon="📥" label="Deliveries to me" onPress={() => router.push('/buyer-deliveries')} />
            <MenuRow icon="📤" label="Deliveries from my listings" onPress={() => router.push('/seller-deliveries')} />
            <MenuRow icon="🚐" label="My trip requests" onPress={() => router.push('/quotes')} />
            <MenuRow
              icon="🔍"
              label="My wanted posts"
              badge={wantedResponseCount > 0 ? wantedResponseCount : undefined}
              onPress={() => router.push('/my-wanted-posts')}
            />
            <MenuRow icon="💬" label="Messages" onPress={() => router.push('/messages')} />
            {accountType === 'transport_operator' && (
              <MenuRow icon="📋" label="Browse trip requests" onPress={() => router.push('/operator-requests')} />
            )}
          </View>

          {/* NEW: highlighted card — gold border on the card itself,
              plus a "💰 Earn" tag on each row (see MenuRow's new
              `highlighted` prop). Same gold already used everywhere
              else in the app for "this matters" states, not a new hue —
              keeps this card visually distinct without teaching users a
              second accent color. */}
          <View style={[styles.card, styles.earnCard]}>
            <View style={styles.earnCardHeader}>
              <Text style={styles.cardTitle}>Earn with ImbizoHub</Text>
              <View style={styles.earnHeaderBadge}>
                <Text style={styles.earnHeaderBadgeText}>💰 Earn money</Text>
              </View>
            </View>
            {accountType !== 'delivery' && (
              <MenuRow
                icon="📦"
                label="Become a Delivery Operator"
                onPress={handleBecomeDeliveryOperator}
                highlighted
              />
            )}
            {accountType !== 'transport_operator' && (
              <MenuRow
                icon="🚐"
                label="Become a Transport Operator"
                onPress={() => router.push('/operator-register-pay')}
                highlighted
              />
            )}
          </View>

          {/* Editable info */}
          <View style={styles.card}>
            <View style={styles.cardHeader}>
              <Text style={styles.cardTitle}>Personal info</Text>
              {!editing && (
                <TouchableOpacity onPress={startEditing}>
                  <Text style={styles.editLink}>Edit</Text>
                </TouchableOpacity>
              )}
            </View>

            {editing ? (
              <>
                <Text style={styles.label}>Full name</Text>
                <TextInput style={styles.input} value={draftName} onChangeText={setDraftName}
                  placeholder="Your full name" placeholderTextColor="#666" />
                <Text style={styles.label}>Phone</Text>
                <TextInput style={styles.input} value={draftPhone} onChangeText={setDraftPhone}
                  placeholder="e.g. +263 77 123 4567" placeholderTextColor="#666" keyboardType="phone-pad" />
                <Text style={styles.label}>Location</Text>
                <TextInput style={styles.input} value={draftLocation} onChangeText={setDraftLocation}
                  placeholder="e.g. Harare" placeholderTextColor="#666" />
                <View style={styles.editActions}>
                  <TouchableOpacity style={styles.cancelBtn} onPress={() => setEditing(false)}>
                    <Text style={styles.cancelBtnText}>Cancel</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={[styles.saveBtn, saving && { opacity: 0.6 }]}
                    onPress={saveProfile} disabled={saving}>
                    {saving ? <ActivityIndicator color={BLACK} /> : <Text style={styles.saveBtnText}>Save</Text>}
                  </TouchableOpacity>
                </View>
              </>
            ) : (
              <>
                <InfoRow label="Full name" value={fullName || 'Not set'} />
                <InfoRow label="Phone" value={phone || 'Not set'} />
                <InfoRow label="Location" value={location || 'Not set'} />
              </>
            )}
          </View>

          {/* Recent reviews */}
          {recentReviews.length > 0 && (
            <View style={styles.card}>
              <Text style={styles.cardTitle}>Recent reviews</Text>
              {recentReviews.map((r, i) => (
                <View key={i} style={styles.reviewItem}>
                  <View style={styles.reviewHeader}>
                    {renderStars(r.stars, 14)}
                    <Text style={styles.reviewRole}>
                      {r.role === 'buyer' ? 'Buyer' : 'Seller'} · {new Date(r.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
                    </Text>
                  </View>
                  {r.review ? <Text style={styles.reviewText}>{r.review}</Text> : null}
                </View>
              ))}
            </View>
          )}

          {/* NEW: account deletion entry point — the real foundation
              the data retention policy depends on. Deliberately placed
              here, low-key, at the very bottom of the screen, rather
              than near the header's Logout button — this is a far
              more consequential action and shouldn't be one accidental
              tap away from something routine. account-delete.tsx
              itself handles the actual typed confirmation. */}
          <TouchableOpacity
            style={styles.deleteAccountLink}
            onPress={() => router.push('/account-delete')}
          >
            <Text style={styles.deleteAccountLinkText}>Delete my account</Text>
          </TouchableOpacity>

          <View style={{ height: 100 + insets.bottom }} />
        </ScrollView>
      </KeyboardAvoidingView>

      <View style={[styles.bottomNav, { paddingBottom: 24 + insets.bottom }]}>
        <TouchableOpacity style={styles.navItem} onPress={() => router.push('/')}>
          <Text style={styles.navIcon}>🏠</Text>
          <Text style={styles.navLabel}>Home</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.navItem} onPress={() => router.push('/explore')}>
          <Text style={styles.navIcon}>🔍</Text>
          <Text style={styles.navLabel}>Browse</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.navPost} onPress={() => router.push('/post')}>
          <Text style={styles.navPostText}>+</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.navItem} onPress={() => router.push('/messages')}>
          <Text style={styles.navIcon}>💬</Text>
          <Text style={styles.navLabel}>Messages</Text>
        </TouchableOpacity>
        {showDashboardTab && (
          <TouchableOpacity style={styles.navItem} onPress={() => router.push('/dealer')}>
            <Text style={styles.navIcon}>🏪</Text>
            <Text style={styles.navLabel}>Dashboard</Text>
          </TouchableOpacity>
        )}
        <TouchableOpacity style={styles.navItem}>
          <Text style={styles.navIconActive}>👤</Text>
          <Text style={styles.navLabelActive}>Profile</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.infoRow}>
      <Text style={styles.infoLabel}>{label}</Text>
      <Text style={styles.infoValue}>{value}</Text>
    </View>
  );
}

// NEW: `highlighted` prop — when true, applies the gold-tinted row
// treatment used by the "Earn with ImbizoHub" card. Every other
// MenuRow usage on this screen omits the prop entirely (defaults to
// false) and renders exactly as it did before this change.
function MenuRow({ icon, label, badge, onPress, highlighted }: { icon: string; label: string; badge?: number; onPress: () => void; highlighted?: boolean }) {
  return (
    <TouchableOpacity
      style={[styles.menuRow, highlighted && styles.menuRowHighlighted]}
      onPress={onPress}
    >
      <Text style={styles.menuIcon}>{icon}</Text>
      <Text style={[styles.menuLabel, highlighted && styles.menuLabelHighlighted]}>{label}</Text>
      {badge != null && badge > 0 ? (
        <View style={styles.menuBadge}>
          <Text style={styles.menuBadgeText}>{badge}</Text>
        </View>
      ) : null}
      <Text style={[styles.menuArrow, highlighted && { color: GOLD }]}>›</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#111111' },
  container: { flex: 1, backgroundColor: '#111111' },
  content: { padding: 20, paddingTop: Platform.OS === 'ios' ? 56 : 40, paddingBottom: 60 },
  center: { flex: 1, backgroundColor: '#111', alignItems: 'center', justifyContent: 'center' },

  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 },
  headerTitle: { fontSize: 22, fontWeight: '800', color: '#fff' },
  logoutText: { color: '#ff8a8a', fontSize: 13, fontWeight: '600' },
  // NEW: deliberately understated — a plain text link, no card, no
  // icon, no color beyond muted grey — this shouldn't visually compete
  // for attention the way every other action on this screen does.
  deleteAccountLink: { alignItems: 'center', paddingVertical: 16, marginTop: 8 },
  deleteAccountLinkText: { color: '#555', fontSize: 12 },

  avatarSection: { alignItems: 'center', marginBottom: 24 },
  avatarWrap: { position: 'relative', marginBottom: 14 },
  avatarImage: { width: 96, height: 96, borderRadius: 48 },
  avatarPlaceholder: { width: 96, height: 96, borderRadius: 48, backgroundColor: GOLD, alignItems: 'center', justifyContent: 'center' },
  avatarInitials: { color: BLACK, fontSize: 32, fontWeight: '800' },
  avatarOverlay: { ...StyleSheet.absoluteFillObject, borderRadius: 48, backgroundColor: 'rgba(0,0,0,0.5)', alignItems: 'center', justifyContent: 'center' },
  avatarEditBadge: { position: 'absolute', bottom: 0, right: 0, width: 30, height: 30, borderRadius: 15, backgroundColor: DARK, borderWidth: 2, borderColor: '#111', alignItems: 'center', justifyContent: 'center' },
  avatarEditIcon: { fontSize: 14 },

  name: { fontSize: 19, fontWeight: '800', color: '#fff' },
  email: { fontSize: 13, color: GREY, marginTop: 2 },

  ratingRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8 },
  ratingText: { fontSize: 12, color: GREY },

  accountTypeBadge: { backgroundColor: '#3a2800', borderRadius: 20, paddingHorizontal: 12, paddingVertical: 5, marginTop: 10 },
  accountTypeText: { color: GOLD, fontSize: 11, fontWeight: '700' },

  statsRow: { flexDirection: 'row', backgroundColor: BLACK, borderRadius: 14, padding: 16, marginBottom: 16, borderWidth: 0.5, borderColor: '#333' },
  statBox: { flex: 1, alignItems: 'center' },
  statValue: { fontSize: 20, fontWeight: '800', color: '#fff' },
  statValueSmall: { fontSize: 13, fontWeight: '700', color: '#fff', textAlign: 'center' },
  statLabel: { fontSize: 10, color: GREY, marginTop: 4, textAlign: 'center' },
  statDivider: { width: 0.5, backgroundColor: '#333', marginHorizontal: 8 },

  errorBox: { backgroundColor: '#3a1a1a', borderRadius: 10, padding: 12, marginBottom: 16 },
  errorText: { color: '#ff8a8a', fontSize: 13 },

  card: { backgroundColor: BLACK, borderRadius: 14, padding: 18, marginBottom: 16, borderWidth: 0.5, borderColor: '#333' },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 },
  cardTitle: { fontSize: 14, fontWeight: '700', color: '#fff', marginBottom: 4 },
  editLink: { color: GOLD, fontSize: 13, fontWeight: '600' },

  // NEW: "Earn with ImbizoHub" card highlight — gold border on the
  // card itself, plus a small header badge, using the exact gold
  // already used everywhere else for "this matters" states.
  earnCard: { borderColor: GOLD, borderWidth: 1.5 },
  earnCardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  earnHeaderBadge: { backgroundColor: '#3a2800', borderRadius: 20, paddingHorizontal: 10, paddingVertical: 4 },
  earnHeaderBadgeText: { color: GOLD, fontSize: 10, fontWeight: '700' },

  label: { fontSize: 12, fontWeight: '600', color: GREY, marginBottom: 6, marginTop: 12 },
  input: {
    backgroundColor: DARK, borderRadius: 10, paddingHorizontal: 14,
    paddingVertical: Platform.OS === 'ios' ? 13 : 10, fontSize: 14, color: '#fff',
    borderWidth: 0.5, borderColor: '#333',
  },
  editActions: { flexDirection: 'row', gap: 10, marginTop: 18 },
  cancelBtn: { flex: 1, borderRadius: 10, paddingVertical: 12, alignItems: 'center', backgroundColor: DARK },
  cancelBtnText: { color: GREY, fontWeight: '600' },
  saveBtn: { flex: 2, borderRadius: 10, paddingVertical: 12, alignItems: 'center', backgroundColor: GOLD },
  saveBtnText: { color: BLACK, fontWeight: '700' },

  infoRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 10, borderBottomWidth: 0.5, borderBottomColor: '#2a2a2a' },
  infoLabel: { fontSize: 13, color: GREY },
  infoValue: { fontSize: 13, color: '#fff', fontWeight: '600' },

  reviewItem: { paddingVertical: 12, borderBottomWidth: 0.5, borderBottomColor: '#2a2a2a' },
  reviewHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 },
  reviewRole: { fontSize: 11, color: GREY },
  reviewText: { fontSize: 13, color: '#ccc', lineHeight: 19 },

  menuRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, borderBottomWidth: 0.5, borderBottomColor: '#2a2a2a' },
  // NEW: highlighted row variant — subtle gold-tinted background,
  // rounded corners, and internal padding so it reads as its own
  // distinct "card within a card" rather than a plain list divider row.
  menuRowHighlighted: {
    backgroundColor: '#2a2200', borderRadius: 10, borderBottomWidth: 0,
    paddingHorizontal: 12, marginBottom: 8,
  },
  menuIcon: { fontSize: 18, marginRight: 12 },
  menuLabel: { flex: 1, fontSize: 14, color: '#fff' },
  menuLabelHighlighted: { fontWeight: '700', color: GOLD },
  menuBadge: { backgroundColor: GOLD, borderRadius: 10, minWidth: 20, height: 20, paddingHorizontal: 6, alignItems: 'center', justifyContent: 'center', marginRight: 8 },
  menuBadgeText: { color: BLACK, fontSize: 11, fontWeight: '800' },
  menuArrow: { fontSize: 18, color: GREY },

  bottomNav: { position: 'absolute', bottom: 0, left: 0, right: 0, backgroundColor: BLACK, borderTopWidth: 0.5, borderTopColor: DARK, paddingVertical: 10, flexDirection: 'row', justifyContent: 'space-around', alignItems: 'center' },
  navItem: { alignItems: 'center' },
  navIcon: { fontSize: 22, color: '#555' },
  navIconActive: { fontSize: 22, color: GOLD },
  navLabel: { fontSize: 9, color: '#555', marginTop: 2 },
  navLabelActive: { fontSize: 9, color: GOLD, marginTop: 2 },
  navPost: { width: 44, height: 44, backgroundColor: GOLD, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  navPostText: { color: BLACK, fontSize: 24, fontWeight: '700', lineHeight: 28 },
});
