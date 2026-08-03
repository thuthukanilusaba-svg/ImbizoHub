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
import * as SplashScreen from 'expo-splash-screen';
import { useEffect, useRef } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { registerForPushNotifications, registerNotificationListeners, savePushToken } from '../../lib/notifications';

SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const router = useRouter();
  const unsubscribeRef = useRef<() => void>(() => {});

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
        const data = response.notification.request.content.data;
        if (data?.type === 'message' && data?.listing_id) {
          router.push(`/chat?listing_id=${data.listing_id}`);
        } else if (data?.type === 'meetpay') {
          router.push('/chat');
        }
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
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: '#111111' }
        }}
      />
    </SafeAreaProvider>
  );
}
