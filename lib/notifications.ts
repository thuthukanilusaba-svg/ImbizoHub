// lib/notifications.ts
// Push notification utility for ImbizoHub
// Handles: token registration, permission requests, and sending local notifications
//
// IMPORTANT: Since Expo SDK 53, Expo Go on Android throws when the
// expo-notifications native module is even IMPORTED — not just when its
// functions are called. This is a hard platform restriction (Google Play
// policy), not a bug: https://docs.expo.dev/develop/development-builds/introduction/
// Real notification testing (local or remote) requires a development build,
// not Expo Go, on Android.
//
// Because the crash happens at import time, wrapping function calls in
// try/catch is not enough — the module must never be statically imported.
// Instead we lazy-load it with a dynamic import(), guarded by a platform
// check, so the risky code path only runs where it's actually safe.

import Constants from 'expo-constants';
import { Platform } from 'react-native';
import { supabase } from './supabase';

// Detect: are we running inside Expo Go on Android? If so, the
// expo-notifications native module is entirely unavailable.
const isExpoGoAndroid =
  Platform.OS === 'android' && Constants.appOwnership === 'expo';

// Lazily and safely load the expo-notifications module.
// Returns null if unavailable (web, or Expo Go on Android).
let cachedModule: typeof import('expo-notifications') | null | undefined;
async function getNotificationsModule() {
  if (cachedModule !== undefined) return cachedModule;

  if (Platform.OS === 'web' || isExpoGoAndroid) {
    cachedModule = null;
    return cachedModule;
  }

  try {
    cachedModule = await import('expo-notifications');
    cachedModule.setNotificationHandler({
      handleNotification: async () => ({
        shouldShowAlert: true,
        shouldShowBanner: true,
        shouldShowList: true,
        shouldPlaySound: true,
        shouldSetBadge: true,
      }),
    });
  } catch (error) {
    console.log('expo-notifications unavailable on this platform/client:', error);
    cachedModule = null;
  }

  return cachedModule;
}

// Request permission and get the Expo push token
// Returns the token string, or null if permission denied, on web, or if
// notifications are unsupported on this platform/client (e.g. Android + Expo Go).
export async function registerForPushNotifications(): Promise<string | null> {
  const Notifications = await getNotificationsModule();
  if (!Notifications) return null;

  try {
    const { status: existingStatus } = await Notifications.getPermissionsAsync();
    let finalStatus = existingStatus;

    if (existingStatus !== 'granted') {
      const { status } = await Notifications.requestPermissionsAsync();
      finalStatus = status;
    }

    if (finalStatus !== 'granted') {
      console.log('Push notification permission denied');
      return null;
    }

    const tokenData = await Notifications.getExpoPushTokenAsync();
    const token = tokenData.data;
    console.log('Push token:', token);
    return token;
  } catch (error) {
    console.log('Push notification registration skipped (unsupported on this platform/client):', error);
    return null;
  }
}

// Save the push token to the user's profile so we can send them notifications
export async function savePushToken(token: string) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return;

  // FIX: push_token_updated_at added — needed by the data retention
  // policy's stale-token cleanup job (cleanup-expired-data), which
  // clears any token that hasn't refreshed in 6 months. Without this
  // timestamp, that job has no way to tell a genuinely stale token
  // apart from one set yesterday. Set every time this function runs,
  // which happens on every app launch — so an actively-used token's
  // clock keeps resetting naturally, and only truly abandoned ones
  // (app uninstalled, account inactive) ever reach the 6-month mark.
  await supabase
    .from('profiles')
    .update({ push_token: token, push_token_updated_at: new Date().toISOString() })
    .eq('id', user.id);
}

// Clear the launcher badge and remove already-delivered notifications.
//
// WHY: nothing in this app ever cleared either one, and no push payload we
// send carries a `badge` value — so the number on the icon was Android's
// own count of notifications still sitting in the tray. Reading every
// message in the app did nothing to it; it only went away by swiping the
// notifications off the shade. A badge that survives doing everything it
// asked is a badge people learn to ignore, and then it stops working for
// the ones that matter — an operator being told their quote was accepted.
//
// Same lazy-load guard as everything else here: a no-op on web and on
// Expo Go for Android, where the native module cannot be loaded at all.
export async function clearNotificationBadge() {
  const Notifications = await getNotificationsModule();
  if (!Notifications) return;

  try {
    // Both, deliberately. setBadgeCountAsync covers the iOS-style numeric
    // badge; dismissAllNotificationsAsync clears the tray entries that are
    // what Android actually counts. Neither alone covers both platforms.
    await Notifications.setBadgeCountAsync(0);
    await Notifications.dismissAllNotificationsAsync();
  } catch (error) {
    // Never fatal — housekeeping should not affect anything the person is
    // actually trying to do.
    console.log('clearNotificationBadge failed:', error);
  }
}

// Show a local notification immediately (for foreground alerts)
export async function showLocalNotification(title: string, body: string, data?: Record<string, any>) {
  const Notifications = await getNotificationsModule();
  if (!Notifications) return;

  try {
    await Notifications.scheduleNotificationAsync({
      content: {
        title,
        body,
        data: data ?? {},
        sound: true,
      },
      trigger: null, // show immediately
    });
  } catch (error) {
    console.log('Local notification skipped (unsupported on this platform/client):', error);
  }
}

// Register listeners for notifications received / tapped while app is running.
// Returns an unsubscribe function you can call in a useEffect cleanup.
// If notifications are unsupported here, returns a no-op unsubscribe.
export async function registerNotificationListeners(
  onReceived: (notification: any) => void,
  onResponse: (response: any) => void
): Promise<() => void> {
  const Notifications = await getNotificationsModule();
  if (!Notifications) {
    return () => {};
  }

  try {
    const receivedSub = Notifications.addNotificationReceivedListener(onReceived);
    const responseSub = Notifications.addNotificationResponseReceivedListener(onResponse);

    return () => {
      try {
        receivedSub?.remove?.();
        responseSub?.remove?.();
      } catch (error) {
        // no-op — cleanup unavailable in this environment
      }
    };
  } catch (error) {
    console.log('Notification listeners skipped (unsupported on this platform/client):', error);
    return () => {};
  }
}

// ── Notification helpers for specific ImbizoHub events ──

export function notifyNewMessage(senderName: string, messageText: string, listingId: string) {
  return showLocalNotification(
    `New message from ${senderName}`,
    messageText.length > 80 ? messageText.slice(0, 80) + '...' : messageText,
    { type: 'message', listing_id: listingId }
  );
}

// NEW (seller_agreed step): fires on the seller's own device the
// moment they tap "Agree to meet" — same local-only self-reminder
// pattern as notifyMeetPayPinGenerated below. Deliberately NOT paired
// with a cross-device push to the buyer (trimmed as a simplification,
// meetpay_seller_agreed_trim_push migration) — the buyer instead picks
// this up live through chat.tsx's existing realtime subscription on
// the session row, which is free once a session exists and covers the
// common case of the buyer having the chat open.
export function notifyAgreedToMeet(listingTitle: string) {
  return showLocalNotification(
    'You agreed to meet',
    `You confirmed you're ready to meet the buyer for "${listingTitle}". Coordinate a time in chat, then generate a PIN once you're together.`,
    { type: 'meetpay' }
  );
}

// CHANGED (PIN-role reversal): the SELLER now generates the PIN, after
// meeting the buyer in person and both being happy — the buyer then
// enters it to confirm they received the goods. This fires only on the
// generating device (see showLocalNotification's own local-only
// limitation), so it reads as a self-reminder to the seller rather than
// something the buyer will see.
export function notifyMeetPayPinGenerated(listingTitle: string) {
  return showLocalNotification(
    'Meet & Pay PIN ready',
    `You generated a PIN for "${listingTitle}". Show it to the buyer to complete the deal.`,
    { type: 'meetpay' }
  );
}

// FIX: same class of gap as notifyUnlockFeeReceived above — no
// reference id at all, meaning even if _layout.tsx had routing logic
// for 'confirmed', there'd be nothing to link it to. Added an optional
// reference id (listing/booking/whatever makes sense for the specific
// deal being confirmed) for the same backward-compatible reason.
// FIX: expanded now that the real destination is confirmed —
// delivery-track.tsx's "Rate this delivery" button shows the actual
// route: /rating?session_id=X&reviewee_id=X&role=X&listing_id=X. A
// bare reference_id alone (the earlier fix) wasn't enough to construct
// that URL; needed the full set of fields.
export function notifyTransactionConfirmed(
  listingTitle: string,
  sessionId?: string,
  revieweeId?: string,
  role?: 'buyer' | 'seller',
  listingId?: string
) {
  return showLocalNotification(
    'Transaction confirmed! ✅',
    `The deal for "${listingTitle}" has been confirmed. Please leave a rating.`,
    {
      type: 'confirmed',
      ...(sessionId ? { session_id: sessionId } : {}),
      ...(revieweeId ? { reviewee_id: revieweeId } : {}),
      ...(role ? { role } : {}),
      ...(listingId ? { listing_id: listingId } : {}),
    }
  );
}

// FIX: same gap — no delivery_bookings id, so even correct routing
// logic in _layout.tsx would have nothing to deep-link to (which
// specific delivery would it open?). Added optional bookingId.
export function notifyDeliveryUpdate(status: string, listingTitle: string, bookingId?: string) {
  const messages: Record<string, string> = {
    accepted: `A driver has accepted your delivery request for "${listingTitle}".`,
    dispatched: `"${listingTitle}" has been dispatched and is on its way.`,
    delivered: `"${listingTitle}" has been delivered. Please confirm receipt.`,
  };
  return showLocalNotification(
    'Delivery update 🚚',
    messages[status] ?? `Delivery status updated for "${listingTitle}".`,
    { type: 'delivery', status, ...(bookingId ? { booking_id: bookingId } : {}) }
  );
}

// FIX: same gap — no id to deep-link a seller to the specific booking
// that was just made. Added optional bookingId.
export function notifySellerDeliveryBooked(listingTitle: string, bookingId?: string) {
  return showLocalNotification(
    'Delivery booked 📦',
    `A buyer booked delivery for "${listingTitle}". Prepare the parcel for pickup.`,
    { type: 'delivery_booked', ...(bookingId ? { booking_id: bookingId } : {}) }
  );
}

// FIX (real bug, found during a thorough review): this local version
// sent { type: 'unlock' } with no listing_id at all — but the real,
// server-side push notification for the exact same event
// (confirm-payment.ts's notifyUnlockFeeReceived, a different function
// with the same name in a different file) correctly includes it, and
// _layout.tsx's tap handler specifically requires data.listing_id to
// route the 'unlock' type anywhere. Without this, tapping THIS local
// version's notification would silently fail to navigate, even though
// the real server-pushed one works correctly. Added as an optional
// parameter so existing call sites still compile without changes;
// only calls updated to pass it actually get correct routing.
export function notifyUnlockFeeReceived(listingTitle: string, listingId?: string) {
  return showLocalNotification(
    'New buyer unlocked your chat 🔓',
    `Someone paid to message you about "${listingTitle}". Reply now.`,
    { type: 'unlock', ...(listingId ? { listing_id: listingId } : {}) }
  );
}