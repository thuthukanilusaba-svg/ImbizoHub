// lib/oauth.ts
//
// Shared Google sign-in helper for login.tsx and register.tsx.
// Mirrors app/reset-password.tsx's PKCE code-exchange pattern — this
// app has detectSessionInUrl: false set in lib/supabase.ts
// (deliberately, see that file's comment), so nothing auto-detects a
// code/token from an incoming URL; every OAuth redirect has to be
// parsed and exchanged manually, exactly like reset-password.tsx
// already does for the password-reset link.
//
// Facebook sign-in was built alongside this but has been pulled back
// out: Meta's console requires Business Verification to publish a
// Facebook Login app for public use, and that's currently blocked on
// the developer account. lib/oauth.ts and auth-callback.tsx were
// written provider-agnostically on purpose, so re-adding Facebook
// later (once verification is possible) is just: widen OAuthProvider
// back to 'google' | 'facebook', re-add the button in login.tsx /
// register.tsx, and re-enable the provider in Supabase — no changes
// needed here.
//
// IMPORTANT — this file only builds the app-side half of the flow.
// Sign-in will not actually work until Google is turned on as a
// provider in the Supabase dashboard (Authentication > Providers),
// with a real Client ID + Secret from Google Cloud Console pasted in
// there. No code change here can substitute for that setup.
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
import { createAppURL } from './appUrl';
import { recordTermsAcceptance } from './terms';

export type OAuthProvider = 'google';

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

/**
 * The id of the anonymous session currently signed in, or null.
 *
 * READS THE LOCAL SESSION, NOT THE SERVER. This used to call
 * supabase.auth.getUser(), which makes a network round trip to
 * /auth/v1/user. When that call is slow, offline, or errors, it returns
 * user: null — and the caller then has nothing to merge, skips silently,
 * and the person loses everything they posted anonymously with no error
 * anywhere. Confirmed on a real device 31 Oct 2026: a wanted post made
 * anonymously stayed on the anonymous id after an Apple sign-in, the
 * merge RPC itself proved to work when called directly, and nothing was
 * logged to say why.
 *
 * getSession() reads the persisted session from storage. is_anonymous is
 * a claim inside the JWT that is already on the device, so there is no
 * request to fail. The id is needed in the two seconds before the
 * session is replaced; a network call in that window is the one thing
 * that should not be there.
 */
export async function captureAnonymousId(): Promise<string | null> {
  const { data: { session } } = await supabase.auth.getSession();
  const user = session?.user;
  if (!user) {
    console.log('[anon-merge] no session to capture — nothing will be merged');
    return null;
  }
  if (!user.is_anonymous) return null;
  console.log('[anon-merge] captured anonymous id', user.id);
  return user.id;
}

// Best-effort, same as login.tsx's existing email/password merge: if
// this fails, sign-in still succeeds — the anonymous activity just
// stays orphaned under its old id, same as before this feature
// existed, rather than blocking someone from signing in.
export async function mergeAnonymousSession(previousAnonymousId: string | null) {
  // Logged rather than returned silently. A no-op here means somebody's
  // wanted posts and messages stay stranded on an id nothing can reach
  // again, and until 31 Oct 2026 this function could do exactly that
  // without leaving a trace — which is how an Apple sign-in dropped a
  // post on a real device and the only evidence was the missing row.
  if (!previousAnonymousId) {
    console.log('[anon-merge] skipped: no anonymous id was captured');
    return;
  }
  const { error } = await supabase.rpc('merge_anonymous_session', {
    p_anonymous_id: previousAnonymousId,
  });
  if (error) {
    console.log('[anon-merge] FAILED (non-fatal):', error.message);
    return;
  }
  console.log('[anon-merge] merged', previousAnonymousId);
}

export async function signInWithProvider(provider: OAuthProvider): Promise<OAuthResult> {
  // NOT Linking.createURL() — on web that ignores experiments.baseUrl and
  // returns a root-path URL, which is what broke Google sign-in. See
  // lib/appUrl.ts for the full explanation.
  const redirectTo = createAppURL('auth-callback');
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

  // NATIVE path. Called unconditionally, including when this is a plain
  // sign-in from login.tsx: the RPC stamps only accounts created within
  // the last hour, so a returning user is never recorded as having
  // accepted terms they were never shown. Putting that test here instead
  // would mean duplicating it in auth-callback.tsx, where the web return
  // trip genuinely cannot tell the two apart.
  //
  // Best effort — see lib/terms.ts. Never blocks sign-in.
  await recordTermsAcceptance();

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
