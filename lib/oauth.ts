// lib/oauth.ts
//
// Shared Google / Facebook sign-in helper for login.tsx and
// register.tsx. Mirrors app/reset-password.tsx's PKCE code-exchange
// pattern — this app has detectSessionInUrl: false set in
// lib/supabase.ts (deliberately, see that file's comment), so nothing
// auto-detects a code/token from an incoming URL; every OAuth
// redirect has to be parsed and exchanged manually, exactly like
// reset-password.tsx already does for the password-reset link.
//
// IMPORTANT — this file only builds the app-side half of the flow.
// Sign-in will not actually work until Google and Facebook are turned
// on as providers in the Supabase dashboard (Authentication >
// Providers), each with a real Client ID + Secret from Google Cloud
// Console / Facebook for Developers pasted in there. No code change
// here can substitute for that setup.
//
// Native vs web, and why they're handled so differently:
//  - Native: there's no "page" to navigate away from and back to, so
//    the provider's login page opens in an in-app browser tab via
//    expo-web-browser's openAuthSessionAsync(), which resolves with
//    the redirect URL directly once the user finishes (or cancels).
//    app/auth-callback.tsx is never actually visited on native.
//  - Web: signInWithOAuth() does a real full-page redirect (the
//    browser navigates away entirely and this JS context is torn
//    down), so there's nothing left to do here after kicking it off —
//    app/auth-callback.tsx is the screen that receives the trip back
//    and does the actual code exchange.

import * as Linking from 'expo-linking';
import { Platform } from 'react-native';
import * as WebBrowser from 'expo-web-browser';
import { supabase } from './supabase';

export type OAuthProvider = 'google' | 'facebook';

export type OAuthResult =
  | { status: 'success' }
  | { status: 'cancelled' }
  | { status: 'redirecting' }
  | { status: 'error'; message: string };

// Web only: a full-page OAuth redirect tears down this JS context, so
// there's no in-memory way to carry "was this session anonymous
// before sign-in" across the round trip — auth-callback.tsx needs to
// read it back out after the browser returns. Native doesn't need
// this at all since openAuthSessionAsync() never leaves the app.
const PENDING_ANON_MERGE_KEY = 'imbizohub_pending_anon_merge';

async function captureAnonymousId(): Promise<string | null> {
  const { data: { user } } = await supabase.auth.getUser();
  return user?.is_anonymous ? user.id : null;
}

// Best-effort, same as login.tsx's existing email/password merge: if
// this fails, sign-in still succeeds — the anonymous activity just
// stays orphaned under its old id, same as before this feature
// existed, rather than blocking someone from signing in.
export async function mergeAnonymousSession(previousAnonymousId: string | null) {
  if (!previousAnonymousId) return;
  const { error } = await supabase.rpc('merge_anonymous_session', {
    p_anonymous_id: previousAnonymousId,
  });
  if (error) {
    console.log('Anonymous session merge failed (non-fatal):', error.message);
  }
}

export async function signInWithProvider(provider: OAuthProvider): Promise<OAuthResult> {
  const redirectTo = Linking.createURL('auth-callback');
  const previousAnonymousId = await captureAnonymousId();

  if (Platform.OS === 'web') {
    if (previousAnonymousId && typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.setItem(PENDING_ANON_MERGE_KEY, previousAnonymousId);
    }

    const { error } = await supabase.auth.signInWithOAuth({
      provider,
      options: { redirectTo },
    });

    if (error) return { status: 'error', message: error.message };
    // Browser is navigating away right now — nothing more to do here.
    return { status: 'redirecting' };
  }

  const { data, error } = await supabase.auth.signInWithOAuth({
    provider,
    options: { redirectTo, skipBrowserRedirect: true },
  });

  if (error || !data?.url) {
    return { status: 'error', message: error?.message ?? 'Could not start sign-in.' };
  }

  const result = await WebBrowser.openAuthSessionAsync(data.url, redirectTo);

  if (result.type !== 'success' || !('url' in result) || !result.url) {
    // User closed the browser / backed out — not a real error.
    return { status: 'cancelled' };
  }

  const parsed = Linking.parse(result.url);
  const code = parsed.queryParams?.code as string | undefined;

  if (!code) {
    return { status: 'error', message: 'Sign-in link was missing its code. Please try again.' };
  }

  const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);
  if (exchangeError) {
    return { status: 'error', message: exchangeError.message };
  }

  await mergeAnonymousSession(previousAnonymousId);

  return { status: 'success' };
}

// Called only from app/auth-callback.tsx (web's return trip). Reads
// back whatever signInWithProvider() stashed before the redirect,
// then clears it either way so a later, unrelated sign-in never
// accidentally reuses a stale id.
export async function consumePendingAnonymousMerge() {
  if (Platform.OS !== 'web' || typeof window === 'undefined' || !window.localStorage) return;
  const previousAnonymousId = window.localStorage.getItem(PENDING_ANON_MERGE_KEY);
  window.localStorage.removeItem(PENDING_ANON_MERGE_KEY);
  await mergeAnonymousSession(previousAnonymousId);
}
