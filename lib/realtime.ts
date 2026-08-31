// lib/realtime.ts
//
// One safe way to open a realtime channel.
//
// WHY THIS EXISTS:
// "cannot add `postgres_changes` callbacks for realtime:… after
// `subscribe()`" has now been reported by the crash reporter three
// separate times — 27 August, and twice more on 31 August at 14:02 from
// the live web build. Each round of fixes patched the call sites and
// left the mechanism alone, so it kept coming back.
//
// The mechanism has two halves and BOTH have to be closed:
//
//  1. supabase.channel(name) does not always create a channel. If one
//     with that exact name is already registered on the client, it hands
//     back the EXISTING one — already subscribed — and .on() after
//     .subscribe() throws. A channel stays registered until
//     removeChannel() finishes, and removeChannel() is asynchronous, so
//     an un-awaited teardown (a React unmount cleanup cannot await
//     anything) routinely loses the race with the next mount.
//
//  2. Guarding with a "am I already subscribed?" ref does not help if
//     the ref is written AFTER an await. Two concurrent callers both
//     read the old value, both pass the guard, and both go on to build
//     the same channel. chat.tsx had exactly this: three call sites
//     (loadExisting, the INSERT handler, openMeetPay) landing on the
//     same session id is the normal case, not an edge case.
//
// So the fix cannot live at the call sites. It lives here:
//
//   * openChannel() SERIALISES every channel setup in the app through
//     one promise queue, so two callers can never be inside setup at the
//     same time — regardless of how many places call it or how they
//     race.
//   * Before creating anything it removes any channel already registered
//     under that name and AWAITS the removal, so a stale registration
//     left behind by an un-awaited unmount cleanup is cleaned up by the
//     next creation rather than poisoning it. That makes the whole thing
//     self-healing: teardown no longer has to be perfect.
//   * The build is wrapped, so if this ever fails anyway the screen
//     degrades (no live updates until the next refresh) instead of
//     throwing. A silent listener is bad; a thrown error mid-render is
//     worse.
//
// WHAT IT LOOKS LIKE WHEN IT BREAKS, which is why it kept being
// misdiagnosed: the listener never attaches, so the screen stops
// reacting to the other person confirming. It presents as a dead
// button. That is what "Confirm sale not reacting" actually was.

import { supabase } from './supabase';

// One queue for the whole app. Opening a channel is rare and cheap, so a
// global serialisation is far easier to reason about than a lock per
// name — and it removes the entire class of "two callers, same name"
// rather than the instances we happen to have thought of.
let setupQueue: Promise<unknown> = Promise.resolve();

function serialise<T>(fn: () => Promise<T>): Promise<T> {
  // .then(fn, fn) on purpose: a previous setup failing must not stall
  // every later one behind a rejected promise.
  const run = setupQueue.then(fn, fn);
  setupQueue = run.then(
    () => undefined,
    () => undefined
  );
  return run;
}

/**
 * supabase-js stores a channel's topic as `realtime:<name>`, but that
 * prefix is an implementation detail. Stripping it if present — rather
 * than matching the prefixed string — means a change in that format
 * cannot silently turn this comparison into a no-op and hand us the
 * original bug back.
 */
function nameOf(channel: any): string {
  return String(channel?.topic ?? '').replace(/^realtime:/, '');
}

/** Remove every channel currently registered under this name, and wait. */
export async function removeChannelByName(name: string) {
  const existing = supabase.getChannels().filter((ch) => nameOf(ch) === name);
  for (const ch of existing) {
    try {
      await supabase.removeChannel(ch);
    } catch {
      // Already gone, or the socket is down. Either way there is nothing
      // left to collide with, which is all we needed.
    }
  }
}

/**
 * Open a realtime channel safely.
 *
 * `attach` receives a genuinely new channel and must do the whole
 * `.on(...).subscribe(...)` chain on it. Everything that used to be
 * unsafe about that chain — an already-subscribed channel, a concurrent
 * caller, a half-finished teardown — is handled before `attach` runs.
 *
 * Returns the channel, or null if setup failed. A null return means the
 * screen has no live updates; it does not mean anything is broken enough
 * to interrupt the person over.
 */
export function openChannel(
  name: string,
  attach: (channel: any) => void
): Promise<any | null> {
  return serialise(async () => {
    await removeChannelByName(name);
    try {
      const channel = supabase.channel(name);
      attach(channel);
      return channel;
    } catch (err) {
      console.log(`realtime: could not open channel ${name}:`, err);
      return null;
    }
  });
}
