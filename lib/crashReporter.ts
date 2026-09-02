// lib/crashReporter.ts
//
// Catches JavaScript errors happening inside the app and records them, so
// they stop being invisible.
//
// WHY THIS EXISTS:
// three things watch ImbizoHub, and none of them could see this.
// UptimeRobot checks the server answers from outside. health_check() checks
// the data and the scheduled jobs from inside the database. Play Console's
// Android vitals catches NATIVE crashes — the process actually dying.
//
// A JavaScript error in React Native kills none of those. The native
// process survives, the server is untouched, and the person just gets a
// blank or frozen screen and leaves. Every dashboard stays green. That is
// the exact failure shape this app has had before: something quietly not
// working while everything reports fine.
//
// Reports go to the report_crash() database function, NOT to an email per
// crash. One bad render on one phone can throw hundreds of times a minute;
// the hourly health check picks these up grouped by fingerprint and reports
// them through the alerting that already exists.
//
// HONEST LIMITATION: on a genuinely fatal error the app may be torn down
// before the network request leaves the device, so fatal reports are
// best-effort. Non-fatal errors — which is most of what actually goes wrong
// in React Native — report reliably. Sentry solves the fatal case properly
// with a native handler; this is the version that ships over the air
// without a rebuild.

import Constants from 'expo-constants';
import { Platform } from 'react-native';
import { supabase } from './supabase';

// The screen the person was on when it broke. Kept at module level because
// the error handler runs outside React and cannot use hooks. _layout.tsx
// keeps this current via setCrashRoute().
let currentRoute = '';

export function setCrashRoute(route: string) {
  currentRoute = route || '';
}

// Client-side throttle, on top of the server's own per-fingerprint cap.
// A render loop can throw faster than the network can carry it, and there
// is no value in the 400th copy of the same error.
const recentlySent = new Map<string, number>();
const DEDUP_WINDOW_MS = 30_000;

let installed = false;

async function send(message: string, stack: string | null, isFatal: boolean) {
  try {
    const key = `${message}|${(stack ?? '').slice(0, 120)}`;
    const now = Date.now();
    const last = recentlySent.get(key);
    if (last && now - last < DEDUP_WINDOW_MS) return;
    recentlySent.set(key, now);
    // Bounded so a long session with many distinct errors cannot grow this
    // without limit.
    if (recentlySent.size > 50) recentlySent.clear();

    await supabase.rpc('report_crash', {
      p_message: String(message).slice(0, 500),
      p_stack: stack ? String(stack).slice(0, 4000) : null,
      p_route: currentRoute || null,
      p_platform: Platform.OS,
      p_app_version: (Constants.expoConfig as any)?.version ?? null,
      p_is_fatal: !!isFatal,
    });
  } catch {
    // Swallowed on purpose, and this is the one place that is right.
    // A crash reporter that throws while reporting a crash turns one bug
    // into two, and the second one is unreportable.
  }
}

/**
 * Report a failure the app CAUGHT and showed to the person.
 *
 * WHY THIS EXISTS. installCrashReporter() below hooks ErrorUtils, which
 * only ever fires on an UNHANDLED error — and this app handles almost
 * everything. Nearly every Supabase call ends in some version of
 *
 *     if (error) setError('Something went wrong. Please try again.');
 *
 * which is correct defensive code and also completely invisible. As of
 * 2 September 2026 there were four crash reports in this project's entire
 * history: all from the web build, none newer than 31 August — while
 * seven real people used the app on 1 and 2 September and not one of them
 * came back. Any of them could have hit a wall, read a red banner and
 * closed the app, and these instruments would look exactly as clean as
 * they do now. The failures most likely to lose someone are precisely the
 * ones the crash handler is designed not to see.
 *
 * WHERE TO CALL IT. Anywhere the app tells a person something failed —
 * especially where losing them is expensive: signing up, posting, paying,
 * confirming a handover, uploading a photo. NOT on validation they can
 * simply fix ("passwords don't match" is not an incident), and not when
 * someone cancels.
 *
 *     const { error } = await supabase.from('listings').insert(row);
 *     if (error) {
 *       reportHandledError('post-listing', error);
 *       setError('Could not post your listing. Please try again.');
 *     }
 *
 * Stored as an ordinary non-fatal crash_reports row, message prefixed
 * "[handled]" so these are distinguishable at a glance:
 *
 *     select * from crash_reports where message like '[handled]%';
 *
 * Fire-and-forget by design — never awaited, never throws, and never
 * delays the message the person is waiting to read.
 */
export function reportHandledError(
  where: string,
  error: unknown,
  context?: Record<string, string | number | boolean | null | undefined>
) {
  try {
    const message =
      (error as any)?.message ??
      (typeof error === 'string' ? error : null) ??
      String(error ?? 'Unknown error');

    // Supabase errors carry code/details/hint, which are usually the whole
    // diagnosis — a constraint name says more than the message ever does.
    const e = error as any;
    const parts = [
      e?.code ? `code=${e.code}` : null,
      e?.details ? `details=${e.details}` : null,
      e?.hint ? `hint=${e.hint}` : null,
      ...Object.entries(context ?? {})
        .filter(([, v]) => v !== undefined && v !== null)
        .map(([k, v]) => `${k}=${v}`),
    ].filter(Boolean);

    void send(
      `[handled] ${where}: ${message}`,
      parts.length ? parts.join('\n') : ((error as any)?.stack ?? null),
      false
    );
  } catch {
    // Same rule as send(): reporting must never become the failure.
  }
}

export function installCrashReporter() {
  if (installed) return;
  installed = true;

  try {
    if (Platform.OS === 'web') {
      if (typeof window === 'undefined') return;

      window.addEventListener('error', (event: any) => {
        send(
          event?.message ?? 'Unknown window error',
          event?.error?.stack ?? null,
          false
        );
      });

      window.addEventListener('unhandledrejection', (event: any) => {
        const reason = event?.reason;
        send(
          reason?.message ?? String(reason ?? 'Unhandled promise rejection'),
          reason?.stack ?? null,
          false
        );
      });
      return;
    }

    // Native. ErrorUtils is React Native's own global error hook.
    const globalAny: any = global;
    const errorUtils = globalAny?.ErrorUtils;
    if (!errorUtils?.setGlobalHandler) return;

    // The existing handler is kept and still called. It is what produces
    // the red screen in development and the normal crash behaviour in
    // production — replacing it rather than wrapping it would hide the
    // very errors this is meant to surface.
    const previousHandler = errorUtils.getGlobalHandler?.();

    errorUtils.setGlobalHandler((error: any, isFatal?: boolean) => {
      send(
        error?.message ?? String(error ?? 'Unknown error'),
        error?.stack ?? null,
        !!isFatal
      );
      if (typeof previousHandler === 'function') {
        previousHandler(error, isFatal);
      }
    });
  } catch {
    // Installing the reporter must never be the thing that breaks startup.
  }
}
