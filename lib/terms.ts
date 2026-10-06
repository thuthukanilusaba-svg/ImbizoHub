// lib/terms.ts
//
// One place that records Terms of Service acceptance.
//
// WHY THIS IS AN RPC AND NOT AN UPDATE:
// profiles carries column-level UPDATE grants — 16 columns for
// authenticated — and terms_accepted_at is deliberately not one of
// them. Adding it would let any signed-in user set or clear their own
// consent timestamp with a single request, and a record the subject can
// forge is not a record. record_terms_acceptance() is SECURITY DEFINER
// and takes no arguments: it stamps the caller, once, or does nothing.
//
// WHAT THE SERVER DECIDES, NOT THIS FILE:
//   - only an account created within the last hour is stamped, so a
//     legacy user signing in is never recorded as having accepted terms
//     they were never shown;
//   - only if the column is still null, so the FIRST acceptance is kept
//     and a second device cannot move the date;
//   - never for an anonymous session.
// Those rules live in the migration because the web OAuth return trip
// genuinely cannot tell a signup from a sign-in — register.tsx and
// login.tsx share signInWithProvider() and land on the same callback.
//
// BEST EFFORT, ALWAYS. This must never block anyone getting into the
// app. A failure here costs a row in an audit column; a throw here
// costs someone their signup.
import { supabase } from './supabase';

export async function recordTermsAcceptance(): Promise<void> {
  try {
    const { error } = await supabase.rpc('record_terms_acceptance');
    if (error) {
      // Logged, not surfaced. Nothing the person can do about it and
      // nothing about their account is wrong.
      console.log('terms acceptance not recorded:', error.message);
    }
  } catch (e) {
    console.log('terms acceptance not recorded:', (e as Error)?.message ?? 'unknown');
  }
}
