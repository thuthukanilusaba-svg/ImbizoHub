// app/_layout.tsx
// Root layout — registers push notifications on startup
//
// FIX: wrapped the app in SafeAreaProvider from react-native-safe-area-context.
// Without this, every useSafeAreaInsets() call anywhere in the app
// (index.tsx, explore.tsx, messages.tsx, profile.tsx, dealer.tsx — the
// bottom-nav safe-area fix) silently returns all zeros instead of the
// device's real inset values, since there's no provider anywhere up the
// tree supplying real measurements. This is why the bottom nav still
// overlapped the system navigation bar even after those five screens
// were updated — the hook was correctly wired, but had nothing real to
// read from.

import { Inter_400Regular, Inter_600SemiBold, Inter_700Bold, Inter_800ExtraBold, useFonts } from '@expo-google-fonts/inter';
import { Stack, useRouter } from 'expo-router';
import * as ScreenOrientation from 'expo-screen-orientation';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect, useRef } from 'react';
import { Platform, StyleSheet, useWindowDimensions, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { useIsDesktopWeb } from '../../lib/responsive';
import { supabase } from '../../lib/supabase';
import { theme } from '../../lib/theme';
import { registerForPushNotifications, registerNotificationListeners, savePushToken } from '../../lib/notifications';

SplashScreen.preventAutoHideAsync();

// FIX (website UI looking "not proportional", most visibly the bottom
// nav bar spreading across the full browser width with icons bunched on
// the left): this whole app was built phone-first, with every screen's
// own layout assuming a phone-width viewport. On a wide desktop browser
// there was nothing capping that width, so screens (and anything
// position:'absolute' inside them, like BottomNav) stretched to fill
// the entire window instead of staying phone-proportioned. This caps
// the app to a phone-like width and centers it on web only — native
// (phone) behavior is completely unchanged, since maxWidth/centering
// below only applies when Platform.OS === 'web'.
//
// UPDATED (desktop redesign): a fixed 480px cap made sense as a first
// fix, but on an actual desktop monitor it just reads as a phone app
// floating in a sea of black — not a real website. Above
// DESKTOP_BREAKPOINT (lib/responsive.ts) the frame now widens to
// DESKTOP_MAX_WIDTH instead, giving screens like Home/Browse room to
// lay out a proper multi-column grid (see their own files for the grid
// changes) rather than staying stuck at phone-width. Below the
// breakpoint — including a phone's own browser — it's still the
// original narrow, centered phone-style column.
//
// NOTE: this fixes anything laid out with flexbox (which is most of the
// app, including the bottom nav), but a few screens measure
// Dimensions.get('window').width directly (e.g. listing.tsx's photo
// carousel) — those read the real browser window width regardless of
// this wrapper, so they may still need their own follow-up fix.

const MOBILE_WEB_MAX_WIDTH = 480;
// REVERTED back to 1200 — 1400 read as trying to fill the screen
// rather than as a deliberately centered layout. Paired with the
// background/border treatment below, a clearly centered card is the
// actual goal here, not maximum width.
const DESKTOP_MAX_WIDTH = 1200;

// FIX (real, confirmed bug — screenshotted on a 1920px-wide monitor):
// this used to be styled with `width: '92%', maxWidth: DESKTOP_MAX_WIDTH`
// on the same object, relying on the browser to resolve the percentage
// against the fixed cap. In practice the frame rendered at ~92% of the
// full window on a wide monitor instead of clamping at 1200px — nearly
// edge-to-edge, with only a sliver of margin on each side, which read
// as "not centered" even though the margins were technically equal.
// Rather than keep debugging why percentage+maxWidth wasn't resolving
// the way plain CSS normally would, this now computes an explicit
// pixel width in JS via useWindowDimensions() and Math.min() — no
// ambiguity, no reliance on how any particular style engine resolves
// two competing width rules, just one guaranteed number.
const DESKTOP_FRAME_WIDTH_RATIO = 0.92;

// REPLACED (web redesign, take two — off-white/coffee, website only,
// native unchanged): the dark bronze/black margin is gone in favor of
// lib/theme.ts's muted off-white. Sourced from theme instead of
// hardcoded here so the margin and the frame itself share the exact
// same two-tone cream family, with theme.border giving the boundary
// between them actual definition (previously a near-invisible white-
// on-near-black 1px line).
const WEB_MARGIN_COLOR = theme.card;
const WEB_MARGIN_BORDER = theme.border;

// FIX (part of letting the full-screen photo viewer rotate to
// landscape): app.json's top-level "orientation" is "default" so the
// native app itself is no longer forbidden from rotating at all — but
// that alone would let EVERY screen rotate freely, not just the photo
// viewer, which isn't what was asked for and isn't how the rest of the
// app (forms, lists, buttons) is laid out. This establishes portrait as
// the real, enforced default for every screen; PhotoZoomViewer.native.tsx
// is the one place that explicitly opts out of this while it's open,
// then restores it on close — see that file for the other half of this.
//
// IMPORTANT: this requires expo-screen-orientation to actually be
// installed (`npx expo install expo-screen-orientation`) AND a new
// `eas build` + `eas submit` — this is a native-level change, an
// `eas update` alone cannot ship it to already-installed app binaries.

export default function RootLayout() {
  const router = useRouter();
  const unsubscribeRef = useRef<() => void>(() => {});
  const isDesktopWeb = useIsDesktopWeb();
  // See DESKTOP_FRAME_WIDTH_RATIO's comment above — a plain computed
  // pixel number, not a percentage/maxWidth pair, so there's no room
  // for the frame to silently render wider than intended again.
  const { width: windowWidth } = useWindowDimensions();
  const desktopFrameWidth = Math.min(windowWidth * DESKTOP_FRAME_WIDTH_RATIO, DESKTOP_MAX_WIDTH);

  const [fontsLoaded] = useFonts({
    Inter_400Regular,
    Inter_600SemiBold,
    Inter_700Bold,
    Inter_800ExtraBold,
  });

  useEffect(() => {
    if (fontsLoaded) {
      SplashScreen.hideAsync();
    }
  }, [fontsLoaded]);

  useEffect(() => {
    // Best-effort — some web browsers reject orientation locks entirely
    // (no user gesture, unsupported API, etc.), which isn't worth
    // surfacing as an error anywhere; the app just won't lock there,
    // which is normal/expected browser behavior anyway.
    ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP).catch(() => {});
  }, []);

  useEffect(() => {
    // FIX (real, confirmed bug — found while investigating "delivery
    // did not receive the message"): every profile in the DB had
    // push_token = null, with zero exceptions. Root cause: this used to
    // run registration exactly once, on this effect's very first mount,
    // completely independent of auth state. savePushToken() itself
    // silently no-ops if supabase.auth.getUser() returns no user (see
    // its own early `if (!user) return`) — and on a cold app launch the
    // persisted session is restored from storage ASYNCHRONOUSLY, so this
    // effect's registerForPushNotifications() call frequently resolves
    // and calls savePushToken() BEFORE the session exists yet. The
    // permission prompt still fires and a token still gets generated —
    // it just never reaches the database, silently, every time.
    //
    // Fixed by re-running registration whenever Supabase actually
    // confirms a session (onAuthStateChange fires with a non-null
    // session both for a fresh sign-in AND once the persisted session
    // finishes restoring on launch), instead of relying on this effect's
    // one-shot mount timing.
    const registerPush = () => {
      registerForPushNotifications().then((token) => {
        if (token) savePushToken(token);
      });
    };

    registerPush();
    const { data: authListener } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session) registerPush();
    });

    // Listen for notifications received while app is open, and handle taps.
    // This is fully async-safe: on platforms/clients where notifications
    // are unsupported (e.g. Android + Expo Go), this resolves to a no-op
    // unsubscribe function instead of throwing.
    registerNotificationListeners(
      (notification) => {
        console.log('Notification received:', notification);
      },
      (response) => {
        // FIX (real gap, found during a thorough review): this only
        // ever handled 'message' and 'meetpay' — every other
        // notification type actually built and sent today (unlock,
        // wanted_match, trip_deposit, quote_declined,
        // registration_expiring) fell through doing nothing at all.
        // Someone getting a real, specific push like "Your quote was
        // accepted!" and tapping it would just land wherever the app
        // already was, with no navigation to the actual context.
        // Routes below use only destinations already confirmed real
        // and working elsewhere in the app today — not guessed at.
        //
        // NOT fixed here, and can't be from this file alone:
        // 'delivery', 'delivery_booked', and 'confirmed' notifications
        // (see notifications.ts's showLocalNotification helpers) never
        // included an id in their own data payload to begin with — so
        // even with correct routing logic here, there's nothing to
        // deep-link TO for those three. That needs a payload fix in
        // notifications.ts itself, a separate change from this file.
        const data = response.notification.request.content.data;

        if (data?.type === 'message' && data?.listing_id) {
          router.push(`/chat?listing_id=${data.listing_id}`);
        } else if (data?.type === 'trip_half_confirmed' && data?.session_id) {
          // Van-hire mutual confirmation. notify-meetpay-event fires this
          // at the OTHER party the moment one side confirms, but there was
          // no case for it here — so the notification telling a driver
          // 'your customer confirmed' went nowhere when tapped, and the
          // customer sat on 'Waiting for your driver to confirm too...'
          // indefinitely. The payload carries only the session id, which
          // is why meetpay.tsx now accepts session_id and resolves it to a
          // reference_id itself.
          router.push(`/meetpay?session_id=${data.session_id}`);
        } else if (data?.type === 'meetpay') {
          router.push('/chat');
        } else if (data?.type === 'unlock' && data?.listing_id) {
          router.push(`/chat?listing_id=${data.listing_id}`);
        } else if (data?.type === 'wanted_match' && data?.item_request_id) {
          router.push(`/chat?item_request_id=${data.item_request_id}`);
        } else if (data?.type === 'trip_deposit' && data?.request_id) {
          router.push(`/chat?request_id=${data.request_id}`);
        } else if (data?.type === 'quote_declined') {
          router.push('/operator-requests');
        } else if (data?.type === 'response_declined') {
          // NEW: same treatment as quote_declined above, for the
          // Wanted-tab equivalent — routes back to the browse screen so
          // they can look for other wants to respond to, rather than
          // deep-linking to a specific request that's already matched
          // to someone else.
          router.push('/browse-wanted');
        } else if (data?.type === 'registration_expiring') {
          router.push(
            data?.operator_type === 'delivery'
              ? '/delivery-operator-register-pay'
              : '/operator-register-pay'
          );
        } else if (data?.type === 'delivery' && data?.booking_id) {
          // FIX: closes the gap flagged two turns ago — now that
          // delivery-track.tsx is confirmed real (and its own missing
          // ownership check has been fixed), this routes correctly.
          router.push(`/delivery-track?booking_id=${data.booking_id}`);
        } else if (data?.type === 'confirmed' && data?.session_id) {
          // FIX: closes the second gap — routes to the real /rating
          // screen, confirmed via delivery-track.tsx's own "Rate this
          // delivery" button. Falls through silently if any of the
          // required fields are missing (matches this file's existing
          // pattern of never navigating with an incomplete URL).
          if (data?.reviewee_id && data?.role) {
            router.push(
              `/rating?session_id=${data.session_id}&reviewee_id=${data.reviewee_id}&role=${data.role}&listing_id=${data?.listing_id ?? ''}`
            );
          }
        } else if (data?.type === 'delivery_booked') {
          // FIX: closes the last remaining gap — seller-deliveries.tsx
          // confirmed as the real destination, and confirmed to need
          // no query param at all (it loads every booking by the
          // authenticated seller's own id directly), so this is a
          // plain route, no id required.
          router.push('/seller-deliveries');
        } else if (data?.type === 'delivery_request' && data?.booking_id) {
          // NEW: sent to the DRIVER when a booking is freshly assigned
          // to them (or reassigned after a previous driver declined) —
          // see notify-delivery-status/index.ts's 'new_request' event.
          // Routes to dealer.tsx, which now shows exactly the jobs
          // assigned to this operator awaiting accept/decline.
          router.push('/dealer');
        } else if (data?.type === 'delivery_declined' && data?.booking_id) {
          // NEW: sent to the BUYER when their assigned driver declines
          // — see notify-delivery-status/index.ts's 'declined' event.
          // delivery-track.tsx now renders a dedicated "Driver
          // unavailable" state with a "Choose another driver" CTA for
          // bookings in this status.
          router.push(`/delivery-track?booking_id=${data.booking_id}`);
        }
        // All eleven notification types built today are now handled.
      }
    ).then((unsubscribe) => {
      unsubscribeRef.current = unsubscribe;
    });

    return () => {
      unsubscribeRef.current();
      authListener?.subscription?.unsubscribe();
    };
  }, []);

  if (!fontsLoaded) return null;

  return (
    <SafeAreaProvider>
      <View style={styles.webOuter}>
        {/* FIX (real bug, not just cosmetic — confirmed by the actual
            numbers): this used to be `position: absolute, top: 24,
            right: 24` against webOuter, the raw browser window —
            completely unaware of how much margin actually exists. On a
            ~950px-wide laptop window the margin is only ~38px per
            side, but the button needs ~110px — so `right: 24` didn't
            just look "less clean," it placed the button ~90px INSIDE
            the frame, overlapping real app content. On a huge monitor
            the margin is hundreds of px, so the same fixed offset
            happened to land cleanly by pure coincidence. Fixed for
            real this time: webColumn carries the same responsive width
            as the frame, and webSideActionRow below is a normal
            (non-absolute) row inside it, right-aligned — so it's
            physically impossible for the button to sit anywhere but
            flush with the frame's own right edge, in normal layout
            flow, regardless of window width. No pixel math, nothing to
            overlap, works identically on any screen size. */}
        <View
          style={[
            styles.webColumn,
            Platform.OS === 'web' && (
              isDesktopWeb
                // Explicit computed pixel width — see
                // DESKTOP_FRAME_WIDTH_RATIO's comment above for why
                // this replaced a percentage+maxWidth pair.
                ? { width: desktopFrameWidth }
                : { maxWidth: MOBILE_WEB_MAX_WIDTH }
            ),
          ]}
        >
          <View
            style={[
              styles.webFrame,
              // NEW: on web there's a real, visible margin (screen width
              // minus the frame's own width) between this frame and
              // webOuter's background below — previously both were near-
              // identical shades of black with nothing marking where one
              // ends and the other begins, which read as an accident
              // rather than a deliberate centered layout. A thin border
              // makes the boundary unmistakably intentional without
              // introducing a jarring color change.
              //
              // FIX (rounded corners went missing after the 480px
              // revert): this used to also require `isDesktopWeb`, back
              // when the bordered/rounded treatment was desktop-only.
              // Now that the wide desktop layout is switched off (see
              // lib/responsive.ts) and narrow is the only web layout,
              // gating this on isDesktopWeb meant it never applied at
              // all — the frame silently lost its rounded corners as a
              // side effect of that revert, not a deliberate change.
              // This should apply any time we're centering a narrower
              // frame inside a visible margin, i.e. on web, full stop.
              Platform.OS === 'web' && styles.webFrameBordered,
            ]}
          >
            <Stack
              screenOptions={{
                headerShown: false,
                // theme.background: off-white on web, unchanged dark
                // on native. This is just the gap-filler shown briefly
                // between screens — each screen's own container still
                // sets its own background too (not migrated yet).
                contentStyle: { backgroundColor: theme.background },
              }}
            />
          </View>
        </View>
      </View>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  webOuter: {
    flex: 1,
    backgroundColor: Platform.OS === 'web' ? WEB_MARGIN_COLOR : undefined,
    alignItems: Platform.OS === 'web' ? 'center' : undefined,
  },
  // Carries the actual responsive width (set inline above, since it
  // depends on isDesktopWeb) — webFrame and webSideActionRow are both
  // children of this, so they always share the exact same width and
  // right edge, on any screen size.
  webColumn: {
    flex: 1,
    width: '100%',
  },
  webFrame: {
    flex: 1,
    width: '100%',
  },
  webFrameBordered: {
    borderLeftWidth: 1,
    borderRightWidth: 1,
    borderColor: WEB_MARGIN_BORDER,
    // NEW: rounded edges — makes the frame read as a deliberately
    // placed card against the margin rather than a rectangle with a
    // line drawn around it. overflow: 'hidden' clips the Stack's own
    // content (which is otherwise a plain rectangle) to match, so the
    // corners actually look rounded instead of the border curving
    // while square content pokes past it.
    borderRadius: 16,
    overflow: 'hidden',
  },
});
