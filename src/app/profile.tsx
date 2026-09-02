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
// RESOLVED (comment was stale): the gap noted here previously — no
// screen for a BUYER to track a delivery they booked — is closed by
// buyer-deliveries.tsx (queries eq('buyer_id', userId)), linked below
// as "Deliveries to me". seller-deliveries.tsx remains the SELLER-side
// list ("Deliveries from my listings"), so both directions are covered.
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
// FIX (found during a full-codebase sweep): loadProfile() only checked
// `!user`, missing the same `user.is_anonymous` gap found on roughly a
// dozen other account-gated screens — anonymous sessions have a real
// `user` object, so `!user` alone doesn't exclude them. This let an
// anonymous browsing session reach the full profile editor, upload an
// avatar under its (throwaway) ID, and reach "Become a Delivery
// Operator" / "Become a Transport Operator", which write real rows.
// Now redirects to /register like every other account screen.
//
// FIX (same pass): handleBecomeDeliveryOperator() unconditionally
// upserted verification_tier: 'unverified' / status: 'active' on every
// tap. Supabase upsert updates whatever columns you pass on conflict —
// so a user who had already been ID-verified via operator-id-verify.tsx
// before finishing registration payment (account_type only flips to
// 'delivery' after payment, in become-operator.tsx, so this button
// stays visible and re-tappable until then) would have their
// verification_tier silently reset back to 'unverified' just by
// revisiting this screen and tapping the button again. Now only inserts
// the starter row when one doesn't exist yet; an existing row's
// verification_tier/status is never touched here.
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
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import {
  ActivityIndicator, Alert, Image, KeyboardAvoidingView, Platform,
  ScrollView,
  StyleSheet,
  Text, TextInput, TouchableOpacity,
  View
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import BottomNav from '../../components/BottomNav';
import { DELIVERY_BOOKING_ENABLED, DELIVERY_OPERATOR_SIGNUP_PAUSED_MESSAGE, DELIVERY_PAUSED_TITLE } from '../../lib/featureFlags';
import { normalizeImageOrientation } from '../../lib/imageOrientation';
import { supabase } from '../../lib/supabase';
import CityPicker from '../../components/CityPicker';
import { prepareUpload } from '../../lib/uploadHelpers';
import { checkName } from '../../lib/nameValidation';

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
  // Ratings earned on the other side of a transaction — as a buyer or a
  // passenger. Kept apart from the selling reputation above, because the
  // public profile presents that one as a reason to trust a seller. Shown
  // here only when there is no selling rating to show instead, so someone
  // who has only ever bought still sees the reputation they have earned.
  const [buyerRating, setBuyerRating] = useState(0);
  const [buyerRatingCount, setBuyerRatingCount] = useState(0);
  const [recentReviews, setRecentReviews] = useState<any[]>([]);
  const [isActiveOperator, setIsActiveOperator] = useState(false);
  const [wantedResponseCount, setWantedResponseCount] = useState(0);
  // NEW (1 Sep 2026): how many offers THIS person has made on other
  // people's wants — the mirror of wantedResponseCount, which counts
  // offers made TO them. Feeds the new "My responses" row.
  const [myResponseCount, setMyResponseCount] = useState(0);
  // NEW: per-row counts for the "My activity" card — used to grey out
  // rows with nothing in them yet (see MenuRow's new `dimmed` prop).
  // Purely visual: every row stays tappable regardless of count, since
  // an empty list screen usually has its own "nothing here yet"/"go do
  // X" state that's worth reaching even at zero. This is about
  // reducing visual noise for the common case (a mostly-empty account),
  // not restricting navigation.
  const [deliveriesToMeCount, setDeliveriesToMeCount] = useState(0);
  const [deliveriesFromMeCount, setDeliveriesFromMeCount] = useState(0);
  const [tripRequestCount, setTripRequestCount] = useState(0);
  const [wantedPostCount, setWantedPostCount] = useState(0);
  const [messageCount, setMessageCount] = useState(0);

  const [draftName, setDraftName] = useState('');
  const [draftPhone, setDraftPhone] = useState('');
  const [draftLocation, setDraftLocation] = useState('');
  // Transport operators only. base_city decides which trips they are
  // shown (see lib/cities.ts), and until now it could only be set once,
  // during registration — an operator who moved city, or simply tapped
  // the wrong one, had no route back to that form and was stuck seeing
  // the wrong city's work permanently.
  const [baseCity, setBaseCity] = useState('');
  const [draftBaseCity, setDraftBaseCity] = useState('');

  // Reloads whenever the screen is focused, not only when it first
  // mounts. Editing a profile, changing a base city or completing
  // operator registration all happen on other screens and come back
  // here — and a screen that read the row once showed the value from
  // before the change, indistinguishable from the save having failed.
  // Skipped while the edit form is open. Reloading mid-edit would replace
  // what the person is typing with the values already in the database —
  // and because the form then saves those, the edit is lost silently and
  // looks exactly like a save that does not work.
  useFocusEffect(useCallback(() => {
    if (!editing) loadProfile();
  }, [editing]));

  async function loadProfile() {
    setLoading(true);
    const { data: { user } } = await supabase.auth.getUser();
    // FIX: was `if (!user)`, missing user.is_anonymous — see top-of-file
    // comment. Redirect to /register (not /login) to match the pattern
    // used everywhere else in the app for account-gated screens.
    if (!user || user.is_anonymous) { router.replace('/register'); return; }

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
      setBaseCity(profile.base_city ?? '');
      setAccountType(profile.account_type ?? 'buyer');
      setAvatarUrl(profile.avatar_url ?? null);
      setCreatedAt(profile.created_at ?? '');
      setRating(profile.rating ?? 0);
      setRatingCount(profile.rating_count ?? 0);
      setBuyerRating(profile.buyer_rating ?? 0);
      setBuyerRatingCount(profile.buyer_rating_count ?? 0);
      // Drafts are deliberately NOT set here. startEditing() seeds them
      // from these same values at the moment the form opens, which is the
      // only time they should change. Setting them on every load meant a
      // reload could overwrite an edit in progress.

    }

    const { count } = await supabase
      .from('listings')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', user.id);
    setListingCount(count ?? 0);

    // Only ratings that actually SAY something.
    //
    // This list used to show every rating, so a bare five stars with no
    // words became a row of its own. Ten silent five-star ratings produced
    // ten identical rows carrying no more information than the average
    // already shown above — the same problem the public profile had, fixed
    // there and missed here. The count and the average live at the top of
    // this screen; this section is for what people wrote.
    const { data: reviews } = await supabase
      .from('ratings')
      .select('stars, review, role, created_at')
      .eq('reviewee_id', user.id)
      .not('review', 'is', null)
      .neq('review', '')
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
        .in('item_request_id', myOpenRequests.map((r: any) => r.id));
      setWantedResponseCount(count ?? 0);
    } else {
      setWantedResponseCount(0);
    }

    // NEW: counts feeding the "My activity" card's grey-out treatment.
    // Cheap head-only count queries, same pattern as listingCount above
    // — run in parallel rather than sequentially awaited one-by-one.
    const [
      { count: deliveriesToMe },
      { count: deliveriesFromMe },
      { count: tripRequests },
      { count: wantedPosts },
      { count: messages },
      { count: myResponses },
    ] = await Promise.all([
      supabase.from('delivery_bookings').select('*', { count: 'exact', head: true }).eq('buyer_id', user.id),
      supabase.from('delivery_bookings').select('*', { count: 'exact', head: true }).eq('seller_id', user.id),
      supabase.from('requests').select('*', { count: 'exact', head: true }).eq('user_id', user.id),
      supabase.from('item_requests').select('*', { count: 'exact', head: true }).eq('user_id', user.id),
      supabase.from('messages').select('*', { count: 'exact', head: true }).or(`sender_id.eq.${user.id},receiver_id.eq.${user.id}`),
      supabase.from('item_responses').select('*', { count: 'exact', head: true }).eq('responder_id', user.id),
    ]);
    setDeliveriesToMeCount(deliveriesToMe ?? 0);
    setDeliveriesFromMeCount(deliveriesFromMe ?? 0);
    setTripRequestCount(tripRequests ?? 0);
    setWantedPostCount(wantedPosts ?? 0);
    setMessageCount(messages ?? 0);
    setMyResponseCount(myResponses ?? 0);

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
    // WEB FIX (reported: the camera icon does nothing on the website).
    //
    // react-native-web maps Alert.alert onto the browser's own
    // window.alert / window.confirm, which shows at most TWO buttons
    // and has nowhere to put an onPress callback. A three-button
    // action sheet therefore does not degrade gracefully — it does
    // nothing at all, which is exactly how it looked: a button that
    // swallows every tap.
    //
    // Straight to the gallery on web rather than rebuilding the sheet.
    // launchImageLibraryAsync renders the browser file picker, and on
    // a laptop that dialog already reaches whatever camera the OS
    // exposes. launchCameraAsync has no dependable web implementation,
    // so offering "Take Photo" there would only move the dead button.
    if (Platform.OS === 'web') { pickAvatar(); return; }

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
      exif: true,
    });

    if (result.canceled) return;
    const asset = result.assets[0];
    await uploadAvatarUri(await normalizeImageOrientation(asset.uri, asset.exif));
  }

  async function takeAvatarPhoto() {
    setError('');
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) { setError('Camera permission is required to take a photo.'); return; }

    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true, aspect: [1, 1], quality: 0.7,
      exif: true,
    });

    if (result.canceled) return;
    const asset = result.assets[0];
    await uploadAvatarUri(await normalizeImageOrientation(asset.uri, asset.exif));
  }

  function startEditing() {
    setDraftName(fullName); setDraftPhone(phone); setDraftLocation(location);
    setDraftBaseCity(baseCity);
    setEditing(true); setError('');
  }

  async function saveProfile() {
    setError('');

    // Editing a name went through no validation at all, so anything
    // registration would now reject could still be set here afterwards.
    // Same rule, same helper, both doors.
    const nameCheck = checkName(draftName);
    if (!nameCheck.ok) {
      setError(nameCheck.error);
      return;
    }

    setSaving(true);
    // .select() so we can see WHICH rows changed. Without it a Supabase
    // update that matches nothing returns success, and the screen happily
    // reports a save that never happened.
    //
    // That is not hypothetical: the row only matches while the security
    // policy's id = auth.uid() holds. If the session token has expired,
    // auth.uid() is null, zero rows update, and no error is raised —
    // while reads carry on working, because profiles are publicly
    // readable. The result is a profile screen that shows the right data
    // and silently discards every edit.
    const { data: updatedRows, error: updateError } = await supabase
      .from('profiles')
      .update({
        full_name: nameCheck.value,
        phone: draftPhone.trim(),
        location: draftLocation.trim(),
        // Only written for transport operators. Sending base_city for
        // everyone else would put a value on accounts the filter never
        // consults, which is harmless today but misleading to anyone
        // reading the table later.
        ...(accountType === 'transport_operator' ? { base_city: draftBaseCity || null } : {}),
      })
      .eq('id', userId)
      .select('id');
    setSaving(false);
    if (updateError) { setError(updateError.message); return; }
    if (!updatedRows || updatedRows.length === 0) {
      setError('Your changes were not saved. Your session may have expired — please sign out and sign in again.');
      return;
    }
    setFullName(draftName.trim()); setPhone(draftPhone.trim()); setLocation(draftLocation.trim());
    if (accountType === 'transport_operator') setBaseCity(draftBaseCity);
    setEditing(false);
  }

  async function handleBecomeDeliveryOperator() {
    // NEW: new delivery-operator registrations are paused — see
    // lib/featureFlags.ts's own header comment for why. Checked before
    // touching auth/DB at all, so this is a pure no-op besides the
    // message when paused. Existing operators (accountType === 'delivery'
    // already) never reach this handler in the first place — the
    // MenuRow that calls it is conditionally hidden for them.
    if (!DELIVERY_BOOKING_ENABLED) {
      Alert.alert(DELIVERY_PAUSED_TITLE, DELIVERY_OPERATOR_SIGNUP_PAUSED_MESSAGE || undefined);
      return;
    }

    const { data: { user } } = await supabase.auth.getUser();
    if (!user || user.is_anonymous) { router.push('/register'); return; }

    setError('');

    // FIX: see top-of-file comment — only insert the starter row when
    // one doesn't exist yet. Never overwrite verification_tier/status on
    // an existing row here; that's operator-id-verify.tsx and admin
    // approval's job.
    const { data: existing } = await supabase
      .from('delivery_operators')
      .select('id')
      .eq('user_id', user.id)
      .maybeSingle();

    if (!existing) {
      // FIX (real bug, root cause of a "null value in column full_name"
      // error surfacing on delivery-operator-register-pay.tsx): this
      // insert never supplied `phone`, which — same as full_name — is a
      // NOT NULL column on delivery_operators with no default. Every
      // single call here was silently failing on that constraint (the
      // insert's own `error` was never even checked, so nothing
      // surfaced it). The user would then get pushed forward to
      // /delivery-operator-register-pay anyway with no row actually
      // created, where the free-promo path's own fallback insert (also
      // now fixed, see register_operator_free_promo.sql) would hit the
      // exact same constraint and finally leak a raw Postgres error
      // onto the screen. Now supplies phone, and genuinely checks the
      // error instead of assuming success and navigating forward
      // regardless.
      const { error: insertError } = await supabase.from('delivery_operators').insert({
        user_id: user.id,
        full_name: fullName || '',
        phone: phone || '',
        verification_tier: 'unverified',
        status: 'active',
      });

      if (insertError) {
        setError('Could not start delivery operator registration: ' + insertError.message);
        return;
      }
    }

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

            {ratingCount === 0 && buyerRatingCount > 0 && (
              <View style={styles.ratingRow}>
                {renderStars(buyerRating)}
                <Text style={styles.ratingText}>
                  {buyerRating.toFixed(1)} as a buyer ({buyerRatingCount})
                </Text>
              </View>
            )}
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
            {/* NEW: entry point to the new public, shareable seller
                profile — leaning into today's strategy work turning
                the ratings system into real lock-in. */}
            <MenuRow icon="🔗" label="View my public profile" onPress={() => router.push(`/seller?id=${userId}`)} />
            <MenuRow icon="🏷️" label="My listings" dimmed={listingCount === 0} onPress={() => router.push('/my-listings')} />
            <MenuRow icon="📥" label="Deliveries to me" dimmed={deliveriesToMeCount === 0} onPress={() => router.push('/buyer-deliveries')} />
            <MenuRow icon="📤" label="Deliveries from my listings" dimmed={deliveriesFromMeCount === 0} onPress={() => router.push('/seller-deliveries')} />
            <MenuRow icon="🚐" label="My trip requests" dimmed={tripRequestCount === 0} onPress={() => router.push('/quotes')} />
            <MenuRow
              icon="🔍"
              label="What I'm looking for"
              dimmed={wantedPostCount === 0}
              badge={wantedResponseCount > 0 ? wantedResponseCount : undefined}
              onPress={() => router.push('/my-wanted-posts')}
            />
            {/* NEW (1 Sep 2026, reported: "after posting I want to go back
                and see or edit what I posted"). Listings and wanted posts
                both had a "mine" screen; responses to OTHER people's wants
                had none at all. You responded with a price and the only
                record was a "✓ You've responded" tick on the browse list —
                no way to see what you offered, no way to change it. */}
            <MenuRow
              icon="🏷️"
              label="Prices I've offered"
              dimmed={myResponseCount === 0}
              onPress={() => router.push('/my-responses')}
            />
            <MenuRow icon="💬" label="Messages" dimmed={messageCount === 0} onPress={() => router.push('/messages')} />
            {accountType === 'transport_operator' && (
              // RENAMED: was "Browse trip requests" — shortened and made
              // more explicit about the actual action taken on this
              // screen (submitting a quote), and reads more distinctly
              // from "My trip requests" two rows up (the buyer-side
              // list), which "Browse trip requests" was easy to
              // confuse with at a glance. Not part of the dimmed/empty
              // treatment above — this is a discovery/browse action for
              // operators, not a personal data list that can be "empty".
              <MenuRow icon="📋" label="Quote on trips" onPress={() => router.push('/operator-requests')} />
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

                {/* Operators only. This is the field that decides which
                    trips they are shown, so it is worth naming that
                    consequence here rather than leaving them to work out
                    why their list changed. */}
                {accountType === 'transport_operator' && (
                  <>
                    <Text style={styles.label}>Base city</Text>
                    <CityPicker
                      value={draftBaseCity}
                      onChange={setDraftBaseCity}
                      placeholder="Select your city"
                    />
                    <Text style={styles.baseCityHint}>
                      You&apos;ll see trips starting in this city. Change it if you move.
                    </Text>
                  </>
                )}
                {/* The shared error box lives near the top of this screen,
                    beside the stats. That is far above the edit form on
                    anything but a very tall display, so a failed save
                    reported there is invisible to the person who just
                    pressed Save — they see the form stay open and nothing
                    else, which reads as the button not working.

                    Shown here as well, next to the button that caused it.
                    Duplicating the message is a smaller fault than putting
                    it where nobody will read it. */}
                {error ? (
                  <View style={styles.errorBox}>
                    <Text style={styles.errorText}>⚠️ {error}</Text>
                  </View>
                ) : null}

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
                      {/* role names the REVIEWER's side, so 'Buyer' here
                          means a buyer wrote this — i.e. it is feedback on
                          you as a seller. Spelling that out avoids reading
                          it as a label for the person being reviewed. */}
                      {r.role === 'buyer' ? 'From a buyer' : 'From a seller'} · {new Date(r.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
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

      <BottomNav active="profile" showDashboardTab={showDashboardTab} />
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
//
// NEW: `dimmed` prop — lowers opacity on the icon/label/arrow for rows
// whose underlying list is currently empty (0 deliveries, 0 messages,
// etc. — see the count queries in loadProfile()). Purely a visual
// de-emphasis, not a disabled state: onPress is completely unchanged,
// so an empty row is still fully tappable and lands on that screen's
// own empty state. Ignored when a badge is present (badge!=null &&
// badge>0 already implies real content, so it wins over dimmed even
// if the caller passed both) and never combined with `highlighted` in
// practice — no screen currently needs both at once.
function MenuRow({ icon, label, badge, onPress, highlighted, dimmed }: { icon: string; label: string; badge?: number; onPress: () => void; highlighted?: boolean; dimmed?: boolean }) {
  const isDimmed = dimmed && !(badge != null && badge > 0);
  return (
    <TouchableOpacity
      style={[styles.menuRow, highlighted && styles.menuRowHighlighted]}
      onPress={onPress}
    >
      <Text style={[styles.menuIcon, isDimmed && styles.menuIconDimmed]}>{icon}</Text>
      <Text style={[styles.menuLabel, highlighted && styles.menuLabelHighlighted, isDimmed && styles.menuLabelDimmed]}>{label}</Text>
      {badge != null && badge > 0 ? (
        <View style={styles.menuBadge}>
          <Text style={styles.menuBadgeText}>{badge}</Text>
        </View>
      ) : null}
      <Text style={[styles.menuArrow, highlighted && { color: GOLD }, isDimmed && styles.menuArrowDimmed]}>›</Text>
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
  avatarOverlay: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, borderRadius: 48, backgroundColor: 'rgba(0,0,0,0.5)', alignItems: 'center', justifyContent: 'center' },
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
  baseCityHint: { color: '#888', fontSize: 12, marginTop: 6, marginBottom: 4 },
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
  // NEW: grey-out treatment for empty rows — see MenuRow's `dimmed`
  // prop. Opacity rather than a different color, so it stays a clear
  // "less relevant right now" signal without introducing a whole new
  // muted-text color into the palette.
  menuIconDimmed: { opacity: 0.4 },
  menuLabelDimmed: { color: GREY, opacity: 0.7 },
  menuArrowDimmed: { opacity: 0.4 },
  menuBadge: { backgroundColor: GOLD, borderRadius: 10, minWidth: 20, height: 20, paddingHorizontal: 6, alignItems: 'center', justifyContent: 'center', marginRight: 8 },
  menuBadgeText: { color: BLACK, fontSize: 11, fontWeight: '800' },
  menuArrow: { fontSize: 18, color: GREY },

});
