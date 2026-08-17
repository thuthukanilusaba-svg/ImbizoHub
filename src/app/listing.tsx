// app/listing.tsx
// Listing detail screen with swipeable photo carousel and mark as sold
//
// NEW: full-screen zoom on the photo carousel. Tapping any photo opens
// it full-screen via react-native-image-viewing — pinch-to-zoom,
// double-tap-to-zoom, and swipe-down-to-dismiss all come built in, no
// custom gesture handling needed. Pure JS library, no native module, so
// no rebuild is required to add this — an OTA update is enough. Opens
// at whichever photo is currently active in the carousel (activeIndex),
// not always the first one, so tapping photo 3 of 5 opens zoomed on
// photo 3, not back at photo 1.
//
// FIX (found during a full-app review pass): when a listing was marked
// sold, the bottom action bar disappeared entirely for the OWNER too —
// not just buyers. The two action-bar blocks were `{!isSold && (...)}`
// (owner's "Message buyers" / buyer's "Message seller") and
// `{isSold && !isOwner && (...)}` ("This item has been sold", buyers
// only) — meaning a seller viewing their own SOLD listing got no action
// bar at all, with no way to message existing buyers about pickup or
// final details from this screen (they could still reach Messages via
// the bottom nav, but this screen offered nothing). Fixed by giving the
// owner their own sold-state action bar too, keeping "Message buyers"
// available regardless of sold status.
//
// ALSO FIXED: handleMarkAsSold() / handleReactivate() previously
// swallowed their own update errors completely — `if (!error) {...}`
// with no else branch, so a failed update just silently stopped the
// loading spinner with zero feedback. Now surfaced via a lightweight
// error message, consistent with the error-handling standard applied
// elsewhere in this app.
//
// FIX: the bottom actionBar (Message buyers / Message seller / sold
// notice) was position: 'absolute', bottom: 0 with a hardcoded
// paddingBottom: 28 — same root cause as the bottom nav bug fixed
// earlier across index.tsx/explore.tsx/messages.tsx/profile.tsx/
// dealer.tsx: a fixed guess at safe-area clearance instead of reading
// the device's real inset, so the button overlapped the phone's own
// system navigation bar on devices with a taller gesture bar/nav
// buttons than 28px. Same fix: useSafeAreaInsets(), real inset added on
// top of the existing padding instead of a hardcoded number.
//
// FIX (found during a thorough review): the Feature-listing button
// always said "$5" regardless of the launch promo (Featured Listing
// has been free through Jan 31, 2027 since earlier today) — same
// stale-text pattern already caught and fixed on browse-wanted.tsx and
// hirevan.tsx. Now branches on the same isPromoActive() check used
// consistently elsewhere.
//
// FIX (found during the same review): handleMarkAsSold() and
// handleReactivate() updated listings by id alone, with no
// .eq('user_id', myId) ownership filter — the one place in this file
// that broke from the pattern used consistently everywhere else in
// this app (dealer.tsx's dispatch photo upload, delivery-track.tsx's
// PIN generation, etc.), where ownership is always filtered directly
// in the query as defense-in-depth, not left to RLS alone. The button
// itself is already owner-gated client-side, so this may have been
// redundant if RLS independently covers it — added anyway for
// consistency and because it's harmless either way, unlike leaving a
// genuine gap if RLS doesn't.

import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator, Alert, Dimensions,
  Image,
  LayoutAnimation,
  NativeScrollEvent,
  NativeSyntheticEvent,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  UIManager,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import PhotoZoomViewer from '../../components/PhotoZoomViewer';
import { supabase } from '../../lib/supabase';

const GOLD = '#B8860B';
const BLACK = '#1A1A18';
const DARK = '#2a2a2a';
const GREY = '#AAAAAA';
const GREEN = '#4fc96e';
const { width: SCREEN_WIDTH } = Dimensions.get('window');

// Old architecture on Android needs this opt-in for LayoutAnimation to
// do anything; the New Architecture (default on recent Expo SDKs)
// doesn't have — and may not export — this method at all, so guard
// against it simply not existing rather than assuming either way.
if (Platform.OS === 'android' && (UIManager as any).setLayoutAnimationEnabledExperimental) {
  (UIManager as any).setLayoutAnimationEnabledExperimental(true);
}

// NEW: same launch promo window used consistently elsewhere today —
// needed here so the Feature-listing button reflects the current
// real price, matching what feature-listing-pay.tsx itself shows.
const FREE_PROMO_END = new Date('2027-01-31T23:59:59Z');
const isPromoActive = () => new Date() < FREE_PROMO_END;

// NEW: the photo carousel box used to be a fixed square, cropping every
// photo to fit regardless of whether it was actually taken portrait or
// landscape. Now it resizes to roughly match the currently-active
// photo's real aspect ratio instead — clamped so an unusually
// tall/thin or short/wide photo can't blow the layout out to something
// absurd. The min/max clamp is derived from the carousel's actual
// measured width (see carouselWidth state below), not this constant,
// since on the website the real width can be narrower than the full
// device/browser window.

export default function ListingScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams();
  const [listing, setListing] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [activeIndex, setActiveIndex] = useState(0);
  const [myId, setMyId] = useState('');
  const [markingAsSold, setMarkingAsSold] = useState(false);
  const [statusError, setStatusError] = useState('');
  const [sellerVerified, setSellerVerified] = useState(false);
  const [zoomVisible, setZoomVisible] = useState(false);
  // NEW: width/height ratio (w/h) for each photo, keyed by its index in
  // the carousel — fetched once per photo via Image.getSize() below,
  // since remote images don't expose their real dimensions any other
  // way before they're actually loaded.
  const [photoAspectRatios, setPhotoAspectRatios] = useState<Record<number, number>>({});
  // FIX (website carousel stretching full browser width instead of
  // staying phone-proportioned): this used to size off the module-level
  // SCREEN_WIDTH constant (the raw window width), which on the website
  // is wrong once _layout.tsx caps the app to a centered phone-width
  // column — the carousel would still measure the full browser window
  // rather than the actual space it has. Measuring the wrapper's real
  // rendered width via onLayout instead makes this correct on both web
  // (narrower than the window) and native (same as SCREEN_WIDTH, since
  // there's nothing constraining it there).
  const [carouselWidth, setCarouselWidth] = useState(SCREEN_WIDTH);
  const scrollRef = useRef<ScrollView>(null);

  useEffect(() => { fetchListing(); fetchMe(); }, [id]);

  useEffect(() => {
    const urls: string[] =
      listing?.image_urls && listing.image_urls.length > 0
        ? listing.image_urls
        : listing?.image_url
          ? [listing.image_url]
          : [];

    urls.forEach((url, i) => {
      if (photoAspectRatios[i] !== undefined) return;
      Image.getSize(
        url,
        (w, h) => {
          if (h > 0) {
            // Animate the resize rather than snapping instantly —
            // matters most for the first photo, whose ratio arrives
            // after the initial fixed-square render.
            if (i === activeIndex) LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
            setPhotoAspectRatios((prev) => ({ ...prev, [i]: w / h }));
          }
        },
        () => {
          // Couldn't read real dimensions (e.g. a transient network
          // error) — fall back to a square box for this one photo
          // rather than leaving it permanently unsized.
          setPhotoAspectRatios((prev) => ({ ...prev, [i]: 1 }));
        }
      );
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listing?.image_urls, listing?.image_url]);

  async function fetchMe() {
    const { data: { user } } = await supabase.auth.getUser();
    if (user) setMyId(user.id);
  }

  async function fetchListing() {
    setLoading(true);
    const { data } = await supabase
      .from('listings')
      .select('*')
      .eq('id', id)
      .maybeSingle();
    setListing(data);

    if (data?.user_id) {
      const { data: seller } = await supabase
        .from('profiles')
        .select('is_verified, verified_expires_at')
        .eq('id', data.user_id)
        .maybeSingle();
      setSellerVerified(!!(
        seller?.is_verified &&
        seller?.verified_expires_at &&
        new Date(seller.verified_expires_at).getTime() > Date.now()
      ));
    }

    setLoading(false);
  }

  async function handleMarkAsSold() {
    const message = 'Mark this listing as sold? It will be hidden from buyers. You can reactivate it later.';

    const proceed = await new Promise<boolean>((resolve) => {
      if (Platform.OS === 'web') {
        resolve(window.confirm(message));
      } else {
        Alert.alert(
          'Mark as sold?',
          message,
          [
            { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
            { text: 'Mark as sold', style: 'destructive', onPress: () => resolve(true) },
          ]
        );
      }
    });

    if (!proceed) return;

    setStatusError('');
    setMarkingAsSold(true);
    // FIX: added .eq('user_id', myId) — see top-of-file comment.
    const { error } = await supabase
      .from('listings')
      .update({ status: 'sold' })
      .eq('id', listing.id)
      .eq('user_id', myId);
    setMarkingAsSold(false);
    if (!error) {
      setListing({ ...listing, status: 'sold' });
    } else {
      setStatusError('Couldn\'t mark as sold: ' + error.message);
    }
  }

  async function handleReactivate() {
    setStatusError('');
    setMarkingAsSold(true);
    // FIX: added .eq('user_id', myId) — see top-of-file comment.
    const { error } = await supabase
      .from('listings')
      .update({ status: 'active' })
      .eq('id', listing.id)
      .eq('user_id', myId);
    setMarkingAsSold(false);
    if (!error) {
      setListing({ ...listing, status: 'active' });
    } else {
      setStatusError('Couldn\'t reactivate: ' + error.message);
    }
  }

  function onScroll(e: NativeSyntheticEvent<NativeScrollEvent>) {
    const index = Math.round(e.nativeEvent.contentOffset.x / carouselWidth);
    if (index !== activeIndex) {
      LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
      setActiveIndex(index);
    }
  }

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={GOLD} />
      </View>
    );
  }

  if (!listing) {
    return (
      <View style={styles.center}>
        <Text style={{ color: GREY }}>Listing not found.</Text>
        <TouchableOpacity onPress={() => router.back()} style={{ marginTop: 16 }}>
          <Text style={{ color: GOLD }}>← Back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const photos: string[] =
    listing.image_urls && listing.image_urls.length > 0
      ? listing.image_urls
      : listing.image_url
        ? [listing.image_url]
        : [];

  const isOwner = myId === listing.user_id;
  const isSold = listing.status === 'sold';

  // Ratio for whichever photo is currently active/centered — 1 (square)
  // until its real dimensions arrive from Image.getSize(), so there's
  // never a moment with no box at all.
  const activeRatio = photoAspectRatios[activeIndex] ?? 1;
  const carouselMinHeight = carouselWidth * 0.6;
  const carouselMaxHeight = carouselWidth * 1.5;
  const carouselHeight = Math.min(
    carouselMaxHeight,
    Math.max(carouselMinHeight, carouselWidth / activeRatio)
  );

  return (
    <View style={styles.container}>
      {/* FIX (real bug — "the back arrow hides when you scroll all the
          way down"): this button used to live inside carouselWrap,
          which is itself inside the page's ScrollView below — so it
          scrolled away with the photos instead of staying put. Moved
          out here as a sibling of the ScrollView instead: it's now
          absolutely positioned against `container` (the whole screen),
          not against the carousel, so it stays pinned in the same
          spot regardless of scroll position, the way a floating back
          button normally behaves. */}
      {/* FIX (real bug, reported: "back arrow not centered and feels
          unresponsive"): two separate issues. (1) the ← glyph sits
          visibly high within its own line box in this font — nudged
          down slightly so it optically centers in the circle. (2) the
          circle itself is only 36x36, below the ~44x44 minimum touch
          target both Apple's and Google's own guidelines recommend —
          over a busy photo background that made it genuinely easy to
          miss-tap, which reads as "unresponsive" even though the
          handler itself fires instantly. hitSlop expands the tappable
          area without changing the visual size of the button, and
          activeOpacity gives clear, deliberate press feedback instead
          of relying on TouchableOpacity's default. */}
      <TouchableOpacity
        style={styles.backFloat}
        onPress={() => router.back()}
        activeOpacity={0.7}
        hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
      >
        <Text style={styles.backFloatText}>←</Text>
      </TouchableOpacity>

      <ScrollView>

        {/* Photo carousel — width comes from flex/stretch (no fixed
            SCREEN_WIDTH here), and onLayout measures whatever that
            actually resolves to so the paging math and photo sizing
            below stay correct on both phone and website. */}
        <View
          style={[styles.carouselWrap, { height: carouselHeight }]}
          onLayout={(e) => setCarouselWidth(e.nativeEvent.layout.width)}
        >
          {photos.length > 0 ? (
            <>
              <ScrollView
                ref={scrollRef}
                horizontal
                pagingEnabled
                showsHorizontalScrollIndicator={false}
                onScroll={onScroll}
                scrollEventThrottle={16}
              >
                {photos.map((url, i) => (
                  // FIX (real bug, reported: "does not show a full
                  // picture unless you double tap"): this was a
                  // TouchableOpacity nested inside a horizontal paging
                  // ScrollView, which is itself nested inside the
                  // page's own vertical ScrollView — a well-known React
                  // Native gesture-arbitration case where the first tap
                  // on a Touchable can get consumed while the responder
                  // system is still negotiating between the two
                  // surrounding scroll views, so nothing visibly
                  // happens until a second tap. Pressable uses the
                  // newer Pressability API, which resolves this
                  // negotiation more reliably in nested-scroll layouts
                  // than the legacy Touchable* components.
                  <Pressable
                    key={i}
                    onPress={() => { setActiveIndex(i); setZoomVisible(true); }}
                  >
                    {/* FIX: switched from resizeMode="cover" (crops to
                        fill a fixed square) to "contain" (shows the
                        whole photo, uncropped) now that the wrapping
                        box itself resizes to roughly match the active
                        photo's real shape — the two changes only make
                        sense together; contain alone would just add
                        letterboxing to the old fixed square. */}
                    <Image
                      source={{ uri: url }}
                      style={[styles.carouselImage, { width: carouselWidth, height: carouselHeight }]}
                      resizeMode="contain"
                    />
                  </Pressable>
                ))}
              </ScrollView>

              {photos.length > 1 && (
                <View style={styles.dotsRow}>
                  {photos.map((_, i) => (
                    <View key={i} style={[styles.dot, i === activeIndex && styles.dotActive]} />
                  ))}
                </View>
              )}

              {photos.length > 1 && (
                <View style={styles.photoCounter}>
                  <Text style={styles.photoCounterText}>{activeIndex + 1}/{photos.length}</Text>
                </View>
              )}
            </>
          ) : (
            <View style={styles.noPhoto}>
              <Text style={{ fontSize: 48 }}>📦</Text>
              <Text style={{ color: GREY, marginTop: 8, fontSize: 12 }}>No photos yet</Text>
            </View>
          )}

          {isSold && (
            <View style={styles.soldOverlay}>
              <Text style={styles.soldOverlayText}>SOLD</Text>
            </View>
          )}
        </View>

        {/* Details */}
        <View style={styles.details}>
          <View style={styles.titleRow}>
            <Text style={styles.title}>{listing.title}</Text>
            {isSold ? (
              <View style={styles.soldBadge}>
                <Text style={styles.soldBadgeText}>SOLD</Text>
              </View>
            ) : sellerVerified ? (
              <View style={styles.badgeVerified}>
                <Text style={styles.badgeVerifiedText}>Verified</Text>
              </View>
            ) : listing.badge && listing.badge !== 'Verified' ? (
              <View style={styles.badgeNew}>
                <Text style={styles.badgeNewText}>{listing.badge}</Text>
              </View>
            ) : null}
          </View>

          <Text style={[styles.price, isSold && { color: GREY }]}>${listing.price}</Text>
          <Text style={styles.location}>📍 {listing.location}</Text>

          {listing.description ? (
            <>
              <Text style={styles.sectionTitle}>Description</Text>
              <Text style={styles.description}>{listing.description}</Text>
            </>
          ) : null}

          <Text style={styles.sectionTitle}>Category</Text>
          <View style={styles.categoryChip}>
            <Text style={styles.categoryChipText}>{listing.category}</Text>
          </View>

          {statusError ? (
            <View style={styles.statusErrorBox}>
              <Text style={styles.statusErrorText}>⚠️ {statusError}</Text>
            </View>
          ) : null}

          {isOwner && !isSold && (
            <View style={styles.promoRow}>
              {!listing.featured_until || new Date(listing.featured_until).getTime() < Date.now() ? (
                <TouchableOpacity
                  style={styles.promoBtn}
                  onPress={() => router.push(`/feature-listing-pay?listing_id=${listing.id}`)}
                >
                  <Text style={[styles.promoBtnText, isPromoActive() && { color: GREEN }]}>
                    ⭐ Feature this listing — {isPromoActive() ? 'FREE (launch promo)' : '$5'}
                  </Text>
                </TouchableOpacity>
              ) : (
                <View style={styles.promoActiveBox}>
                  <Text style={styles.promoActiveText}>
                    ⭐ Featured until {new Date(listing.featured_until).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
                  </Text>
                </View>
              )}
              {!sellerVerified && (
                <TouchableOpacity
                  style={styles.promoBtnSecondary}
                  onPress={() => router.push('/verified-seller-pay')}
                >
                  <Text style={styles.promoBtnSecondaryText}>✅ Get Verified Seller status</Text>
                </TouchableOpacity>
              )}
            </View>
          )}

          {isOwner && (
            <TouchableOpacity
              style={[styles.soldToggleBtn, isSold && styles.reactivateBtn]}
              onPress={isSold ? handleReactivate : handleMarkAsSold}
              disabled={markingAsSold}
            >
              {markingAsSold
                ? <ActivityIndicator color={isSold ? GOLD : '#ff8a8a'} />
                : <Text style={[styles.soldToggleBtnText, isSold && styles.reactivateBtnText]}>
                    {isSold ? '🔄 Reactivate listing' : '✅ Mark as sold'}
                  </Text>
              }
            </TouchableOpacity>
          )}

          {!isOwner && (
            <TouchableOpacity
              style={styles.reportLink}
              onPress={() => router.push(
                `/report-user?user_id=${listing.user_id}&context=listing&context_id=${listing.id}`
              )}
            >
              <Text style={styles.reportLinkText}>⚑ Report this seller</Text>
            </TouchableOpacity>
          )}
        </View>

        <View style={{ height: 100 + insets.bottom }} />
      </ScrollView>

      {/* Bottom action bar */}
      {isOwner ? (
        <View style={[styles.actionBar, { paddingBottom: 16 + insets.bottom }]}>
          <TouchableOpacity
            style={styles.chatBtn}
            onPress={() => router.push(`/messages?listing_id=${listing.id}`)}
          >
            <Text style={styles.chatBtnText}>💬 Message buyers</Text>
          </TouchableOpacity>
        </View>
      ) : isSold ? (
        <View style={[styles.actionBar, { paddingBottom: 16 + insets.bottom }]}>
          <View style={[styles.chatBtn, { backgroundColor: DARK }]}>
            <Text style={[styles.chatBtnText, { color: GREY }]}>This item has been sold</Text>
          </View>
        </View>
      ) : (
        <View style={[styles.actionBar, { paddingBottom: 16 + insets.bottom }]}>
          <TouchableOpacity
            style={styles.chatBtn}
            onPress={() => {
              router.push(`/chat?listing_id=${listing.id}&receiver_id=${listing.user_id}`);
            }}
          >
            <Text style={styles.chatBtnText}>💬 Message seller</Text>
          </TouchableOpacity>
        </View>
      )}

      <PhotoZoomViewer
        photos={photos}
        imageIndex={activeIndex}
        visible={zoomVisible}
        onRequestClose={() => setZoomVisible(false)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#111111' },
  center: { flex: 1, backgroundColor: '#111', alignItems: 'center', justifyContent: 'center' },

  // height is set inline per-render (see carouselHeight), and width now
  // comes from flex/stretch by default (no fixed SCREEN_WIDTH) so this
  // fills whatever space its actual parent has — correct on both the
  // phone app and the website's narrower centered layout. Individual
  // photos still need an explicit pixel width for horizontal-scroll
  // paging to work, which is set inline from the measured carouselWidth.
  carouselWrap: { backgroundColor: DARK, position: 'relative' },
  carouselImage: {},
  noPhoto: { width: '100%', height: '100%', alignItems: 'center', justifyContent: 'center' },

  soldOverlay: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.55)', alignItems: 'center', justifyContent: 'center',
  },
  soldOverlayText: { color: '#fff', fontSize: 48, fontWeight: '900', letterSpacing: 8, opacity: 0.9 },

  dotsRow: { position: 'absolute', bottom: 16, left: 0, right: 0, flexDirection: 'row', justifyContent: 'center', gap: 6 },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.4)' },
  dotActive: { backgroundColor: GOLD, width: 18 },

  photoCounter: { position: 'absolute', top: 50, right: 16, backgroundColor: 'rgba(0,0,0,0.6)', borderRadius: 12, paddingHorizontal: 10, paddingVertical: 4 },
  photoCounterText: { color: '#fff', fontSize: 11, fontWeight: '600' },

  // zIndex added: now a sibling of the ScrollView instead of nested
  // inside it (see the FIX comment above where this button is
  // rendered) — without it, the ScrollView (rendered second) could
  // paint over this button in some cases since sibling render order
  // alone no longer guarantees it stays on top.
  backFloat: { position: 'absolute', top: 50, left: 16, width: 36, height: 36, borderRadius: 18, backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center', zIndex: 10 },
  // FIX (real bug, reported again: "the arrow in the back circle is not
  // centered" — the previous `top: 1` nudge here wasn't enough): a
  // magic-number position offset only compensates for one font's
  // specific baseline metrics, and even then only approximately — it's
  // a guess, not a fix. The actual, reliable cause on Android is
  // `includeFontPadding` defaulting to true, which adds extra
  // (asymmetric) padding above/below the glyph that the parent's
  // alignItems/justifyContent centering has no way to see or account
  // for. Setting it false removes that padding so the text's own box
  // is just the glyph itself; giving that box an explicit lineHeight
  // equal to the circle's own 36px size, plus textAlign/
  // textAlignVertical: 'center', then centers it deterministically
  // against the circle's real dimensions instead of eyeballing a
  // pixel offset.
  backFloatText: {
    color: '#fff',
    fontSize: 20,
    lineHeight: 36,
    textAlign: 'center',
    textAlignVertical: 'center',
    includeFontPadding: false,
  },

  details: { padding: 20 },
  titleRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 },
  title: { fontSize: 20, fontWeight: '800', color: '#fff', flex: 1 },

  soldBadge: { backgroundColor: '#3a1a1a', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 4 },
  soldBadgeText: { color: '#ff8a8a', fontSize: 11, fontWeight: '700' },
  badgeVerified: { backgroundColor: '#1a3a1a', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 4 },
  badgeVerifiedText: { color: '#4A90D9', fontSize: 11, fontWeight: '700' },
  badgeNew: { backgroundColor: '#3a2800', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 4 },
  badgeNewText: { color: GOLD, fontSize: 11, fontWeight: '700' },

  price: { fontSize: 28, fontWeight: '800', color: GOLD, marginTop: 8 },
  location: { fontSize: 13, color: GREY, marginTop: 6 },

  sectionTitle: { fontSize: 13, fontWeight: '700', color: '#fff', marginTop: 24, marginBottom: 8 },
  description: { fontSize: 14, color: '#ccc', lineHeight: 22 },

  categoryChip: { alignSelf: 'flex-start', backgroundColor: DARK, borderRadius: 20, paddingHorizontal: 14, paddingVertical: 8, borderWidth: 0.5, borderColor: '#333' },
  categoryChipText: { color: GREY, fontSize: 12 },

  statusErrorBox: { backgroundColor: '#3a1a1a', borderRadius: 10, padding: 12, marginTop: 20 },
  promoRow: { marginTop: 16, gap: 10 },
  promoBtn: { backgroundColor: DARK, borderRadius: 12, paddingVertical: 13, alignItems: 'center', borderWidth: 1, borderColor: GOLD },
  promoBtnText: { color: GOLD, fontSize: 13, fontWeight: '700' },
  promoActiveBox: { backgroundColor: '#2a2200', borderRadius: 12, paddingVertical: 13, alignItems: 'center' },
  promoActiveText: { color: GOLD, fontSize: 13, fontWeight: '700' },
  promoBtnSecondary: { backgroundColor: DARK, borderRadius: 12, paddingVertical: 13, alignItems: 'center', borderWidth: 0.5, borderColor: '#333' },
  promoBtnSecondaryText: { color: '#4A90D9', fontSize: 13, fontWeight: '700' },
  reportLink: { alignItems: 'center', paddingVertical: 16, marginTop: 8 },
  reportLinkText: { color: '#888', fontSize: 12 },
  statusErrorText: { color: '#ff8a8a', fontSize: 13 },

  soldToggleBtn: {
    marginTop: 24, borderRadius: 14, paddingVertical: 14, alignItems: 'center',
    borderWidth: 1, borderColor: '#ff8a8a', backgroundColor: 'transparent',
  },
  soldToggleBtnText: { color: '#ff8a8a', fontSize: 14, fontWeight: '700' },
  reactivateBtn: { borderColor: GOLD },
  reactivateBtnText: { color: GOLD },

  actionBar: { position: 'absolute', bottom: 0, left: 0, right: 0, backgroundColor: BLACK, padding: 16, borderTopWidth: 0.5, borderTopColor: DARK },
  chatBtn: { backgroundColor: GOLD, borderRadius: 14, paddingVertical: 16, alignItems: 'center' },
  chatBtnText: { color: BLACK, fontSize: 15, fontWeight: '800' },
});
