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
