// lib/appUrl.ts
//
// Builds absolute deep-link URLs that point back INTO this app.
//
// WHY THIS EXISTS — a real bug, not a tidiness exercise:
//
// The obvious call is Linking.createURL('auth-callback'). On native that
// is correct and this file just forwards to it. On web it is wrong, and
// silently so. expo-linking's web implementation is, verbatim:
//
//     const url = new URL(path, window.location.origin);
//
// (node_modules/expo-linking/build/createURL.web.js)
//
// `window.location.origin` is scheme + host only. It deliberately drops
// the path — so it has no idea that app.json sets
// experiments.baseUrl = "/app" and that the whole app is now served from
// https://imbizohub.com/app/... rather than the domain root.
//
// The result was that Google sign-in asked Supabase to send the user
// back to https://imbizohub.com/auth-callback — a path that stopped
// existing the day the marketing site took over the root and the app
// moved to /app. Supabase's own logs recorded exactly that:
//
//     /authorize  redirect_to: https://imbizohub.com/auth-callback
//
// and the browser then landed on either a Vercel 404 or, when that URL
// was not on the allowlist, Supabase's Site URL fallback — which on this
// project is the password-reset page. Hence the "signing in with Google
// takes me to reset password" report. Password reset had the identical
// bug for the identical reason (forgot-password.tsx).
//
// process.env.EXPO_BASE_URL is inlined at build time by Expo's Metro
// config from experiments.baseUrl, so it stays correct automatically if
// the app is ever moved again or served from the root. It is empty on
// native and in dev without a baseUrl, which is why the trailing-slash
// normalisation below has to tolerate an empty string.

import * as Linking from 'expo-linking';
import { Platform } from 'react-native';

export function createAppURL(path: string): string {
  const clean = path.replace(/^\/+/, '');

  if (Platform.OS !== 'web') {
    // Native: the custom scheme (imbizohub://) has no base path and
    // createURL handles it correctly.
    return Linking.createURL(clean);
  }

  // Static export prerenders routes in Node, where there is no window.
  // Nothing calls this during render — it only runs from a button press —
  // but a build-time crash here would be a very confusing one, so fall
  // back rather than throw.
  if (typeof window === 'undefined') {
    return Linking.createURL(clean);
  }

  const base = String(process.env.EXPO_BASE_URL || '').replace(/\/+$/, '');
  return `${window.location.origin}${base}/${clean}`;
}
