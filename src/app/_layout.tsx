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
import { Platform, StyleSheet, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { useIsDesktopWeb } from '../../lib/responsive';
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

// Reuses the app's own established near-black brand color (same value
// as BLACK in index.tsx/explore.tsx/hirevan.tsx, already visible today
// in every screen's header bar) for the margin around the centered
// frame — rather than pure '#000' (too harsh/cold, no relation to the
// app's palette) or matching the frame's own '#111111' content
// background exactly (blended so well the centered layout stopped
// reading as intentional — the whole point of "centered" is that the
// boundary is visible). This sits between the two: distinct enough to
// see the frame clearly, but drawn from the app's own palette rather
// than an arbitrary new color, so it still feels like part of the app.
const WEB_MARGIN_COLOR = '#1A1A18';

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
    // Register for push notifications and save token to profile
    registerForPushNotifications().then((token) => {
      if (token) savePushToken(token);
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
        }
        // All nine notification types built today are now handled.
      }
    ).then((unsubscribe) => {
      unsubscribeRef.current = unsubscribe;
    });

    return () => {
      unsubscribeRef.current();
    };
  }, []);

  if (!fontsLoaded) return null;

  return (
    <SafeAreaProvider>
      <View style={styles.webOuter}>
        <View
          style={[
            styles.webFrame,
            Platform.OS === 'web' && {
              maxWidth: isDesktopWeb ? DESKTOP_MAX_WIDTH : MOBILE_WEB_MAX_WIDTH,
            },
            // NEW: on desktop web there's now a real, visible margin
            // (screen width minus DESKTOP_MAX_WIDTH) between this frame
            // and webOuter's black background below — previously both
            // were near-identical shades of black with nothing marking
            // where one ends and the other begins, which read as an
            // accident rather than a deliberate centered layout. A thin,
            // low-opacity border makes the boundary unmistakably
            // intentional without introducing a jarring color change.
            Platform.OS === 'web' && isDesktopWeb && styles.webFrameBordered,
          ]}
        >
          <Stack
            screenOptions={{
              headerShown: false,
              contentStyle: { backgroundColor: '#111111' }
            }}
          />
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
  webFrame: {
    flex: 1,
    width: '100%',
  },
  webFrameBordered: {
    borderLeftWidth: 1,
    borderRightWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
});
