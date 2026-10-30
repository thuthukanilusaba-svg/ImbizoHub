// lib/appleAuth.ts
//
// Sign in with Apple. Required by App Store Review Guideline 4.8: an app
// that uses a third-party login to establish the user's primary account
// "must also offer as an equivalent option another login service" that
// limits collection to name and email, lets the user hide their email,
// and does not collect app interactions for advertising. We offer
// Continue with Google, so without this the iOS build is rejected.
//
// The alternative was removing Google sign-in, which qualifies for the
// "exclusively uses your company's own account setup" exemption. That
// was rejected on the data: eight accounts have a Google identity and
// NO password at all (auth.users.encrypted_password empty), including
// the two sellers holding 13 of the app's active listings. Removing the
// button would have locked them out with no route back — "forgot
// password" on an account that never had one.
//
// ── THE NATIVE-MODULE TRAP, WHICH IS WHY THIS FILE EXISTS AT ALL ──
//
// expo-apple-authentication is a NATIVE module. It is compiled into the
// iOS binary and is simply absent from the Android one. A static import
// of it anywhere in the app would be evaluated on Android too, the
// moment that screen's bundle is loaded — and the Android binary in the
// Play Store today was built before this package existed.
//
// So a plain `import * as AppleAuthentication from ...` shipped over
// `eas update` would reach every existing Android install as JavaScript
// referencing a module their app does not contain. This is exactly the
// hazard lib/notifications.ts documents for expo-notifications, and the
// same remedy applies: never import it statically, load it behind a
// platform check, and cache the result.
//
// The button is iOS-only anyway — Apple's own Human Interface Guidelines
// say not to show it where it cannot work — so the platform check is not
// a workaround, it is the correct behaviour.

import { Platform } from 'react-native';
import { supabase } from './supabase';
import { mergeAnonymousSession } from './oauth';
import { recordTermsAcceptance } from './terms';

type AppleModule = typeof import('expo-apple-authentication');

let cachedModule: AppleModule | null | undefined;

async function getAppleModule(): Promise<AppleModule | null> {
  if (cachedModule !== undefined) return cachedModule;
  if (Platform.OS !== 'ios') {
    cachedModule = null;
    return cachedModule;
  }
  try {
    cachedModule = await import('expo-apple-authentication');
  } catch (error) {
    // An older iOS binary that predates the package will land here
    // rather than crashing, for the same reason as above.
    console.log('expo-apple-authentication unavailable in this build:', error);
    cachedModule = null;
  }
  return cachedModule;
}

/**
 * True only where the button should actually be drawn: an iOS build that
 * contains the native module, on a device whose iOS version supports it
 * (Apple's own isAvailableAsync, which is false on iOS below 13).
 */
export async function isAppleSignInAvailable(): Promise<boolean> {
  const Apple = await getAppleModule();
  if (!Apple) return false;
  try {
    return await Apple.isAvailableAsync();
  } catch {
    return false;
  }
}

export type AppleSignInResult =
  | { status: 'success' }
  | { status: 'cancelled' }
  | { status: 'error'; message: string };

export async function signInWithApple(): Promise<AppleSignInResult> {
  const Apple = await getAppleModule();
  if (!Apple) return { status: 'error', message: 'Sign in with Apple is not available on this device.' };

  // Captured BEFORE the sign-in, exactly as signInWithProvider does: the
  // moment Supabase issues the new session the anonymous id is gone, and
  // with it the link to anything that session posted.
  const { data: { user: previousUser } } = await supabase.auth.getUser();
  const previousAnonymousId = previousUser?.is_anonymous ? previousUser.id : null;

  let credential: Awaited<ReturnType<AppleModule['signInAsync']>>;
  try {
    credential = await Apple.signInAsync({
      requestedScopes: [
        Apple.AppleAuthenticationScope.FULL_NAME,
        Apple.AppleAuthenticationScope.EMAIL,
      ],
    });
  } catch (err: any) {
    // Apple reports a user-cancelled sheet as a thrown error with this
    // code. It is not a failure and must not be shown as one.
    if (err?.code === 'ERR_REQUEST_CANCELED' || err?.code === 'ERR_CANCELED') {
      return { status: 'cancelled' };
    }
    return { status: 'error', message: err?.message ?? 'Could not sign in with Apple.' };
  }

  if (!credential.identityToken) {
    return { status: 'error', message: 'Apple did not return a sign-in token. Please try again.' };
  }

  const { data, error } = await supabase.auth.signInWithIdToken({
    provider: 'apple',
    token: credential.identityToken,
  });

  if (error) return { status: 'error', message: error.message };

  // APPLE SENDS THE NAME EXACTLY ONCE, ON THE FIRST EVER SIGN-IN.
  //
  // Every later sign-in returns fullName as null — not because anything
  // failed, but because Apple considers it already delivered. If it is
  // not written down here it cannot be recovered from Apple at all, and
  // the person shows up forever as 'Seller' on wanted-responses.tsx and
  // as a bare initial in the avatar circle.
  //
  // Only written when the profile has no name yet, so a returning user
  // who has since set a proper name is never overwritten by whatever
  // Apple happened to send years ago.
  const name = [credential.fullName?.givenName, credential.fullName?.familyName]
    .filter(Boolean)
    .join(' ')
    .trim();

  if (name && data.user) {
    const { data: existing } = await supabase
      .from('profiles')
      .select('full_name')
      .eq('id', data.user.id)
      .maybeSingle();

    if (!existing?.full_name) {
      const { error: nameError } = await supabase
        .from('profiles')
        .update({ full_name: name })
        .eq('id', data.user.id);
      // Checked rather than discarded — this is the only chance to
      // store it, so a silent failure here is permanent.
      if (nameError) {
        console.log('Could not save the name Apple provided:', nameError.message);
      }
    }
  }

  // Best effort, both of them, and in this order — matching
  // signInWithProvider. Neither is allowed to block a successful
  // sign-in: the merge failing leaves anonymous activity orphaned under
  // its old id, which is where it already was.
  await mergeAnonymousSession(previousAnonymousId);
  await recordTermsAcceptance();

  return { status: 'success' };
}
