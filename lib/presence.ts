// lib/presence.ts
//
// Last seen, on the reciprocal model people already know from WhatsApp:
// you see other people's only while you are showing your own.
//
// WHY THE RULE IS NOT IN THIS FILE. Reciprocity is enforced in Postgres,
// by last_seen_for() — see the last_seen_reciprocal migration.
// profiles.last_seen_at is granted to nobody, so it cannot be read
// through PostgREST at all; the function is the only door, and it checks
// the caller's own show_last_seen before returning anything. If the rule
// lived here, anyone could query the column directly and ignore it.
//
// WHAT REPLACED WHAT. Until 9 Nov 2026 chat.tsx rendered a blue dot and
// the words "Online now" under every person's name, unconditionally,
// with nothing behind them. A tester reported it as a broken lookup;
// there was no lookup. That was removed first, and this is what takes
// its place.
//
// NULL MEANS SHOW NOTHING. Not "Online", not "Offline", not "Unknown" —
// nothing. lastSeenFor() returns null when either side has hidden
// theirs, when either is anonymous, or when the person has genuinely
// never been seen, and the caller must render an empty space for all of
// them. Inventing a fallback is how the old bug happened.

import { supabase } from './supabase';

/**
 * Records that the current user is here, now.
 *
 * Safe to call often: the database throttles writes to one every two
 * minutes, and anonymous sessions are ignored server-side — a browsing
 * session is not a person to be "last seen".
 *
 * Never throws. A heartbeat is not worth interrupting anything for, and
 * this runs on app foreground where there is no one to show an error to.
 */
export async function touchLastSeen(): Promise<void> {
  try {
    const { error } = await supabase.rpc('touch_last_seen');
    if (error) console.log('[presence] touch failed (ignored):', error.message);
  } catch (err) {
    console.log('[presence] touch threw (ignored):', err);
  }
}

/**
 * When this person was last seen, or null if it must not be shown.
 *
 * Null is a normal answer, not an error. Render nothing for it.
 */
export async function lastSeenFor(userId: string | null | undefined): Promise<Date | null> {
  if (!userId) return null;
  try {
    const { data, error } = await supabase.rpc('last_seen_for', { p_user_id: userId });
    if (error) {
      console.log('[presence] read failed (ignored):', error.message);
      return null;
    }
    return data ? new Date(data as string) : null;
  } catch (err) {
    console.log('[presence] read threw (ignored):', err);
    return null;
  }
}

/** Is the current user showing their own last seen? Defaults to true. */
export async function getShowLastSeen(): Promise<boolean> {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return true;
    const { data, error } = await supabase
      .from('profiles')
      .select('show_last_seen')
      .eq('id', user.id)
      .maybeSingle();
    if (error) return true;
    return data?.show_last_seen !== false;
  } catch {
    return true;
  }
}

/** Turn it on or off. Returns true if the change was saved. */
export async function setShowLastSeen(show: boolean): Promise<boolean> {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return false;
    const { error } = await supabase
      .from('profiles')
      .update({ show_last_seen: show })
      .eq('id', user.id);
    if (error) {
      console.log('[presence] setShowLastSeen failed:', error.message);
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * "last seen today at 14:32" — the wording people already read without
 * thinking about it.
 *
 * Under a minute reads as "last seen just now" rather than a time: a
 * clock reading identical to the current one looks like a bug.
 *
 * Deliberately no "Online now" state. Knowing somebody opened the app
 * forty seconds ago is not the same as knowing they are looking at it,
 * and claiming otherwise is the thing that was just removed.
 */
export function formatLastSeen(when: Date | null): string | null {
  if (!when) return null;

  const now = new Date();
  const ms = now.getTime() - when.getTime();
  if (ms < 0) return null;
  if (ms < 60_000) return 'last seen just now';

  const time = when.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });

  const sameDay = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate();

  if (sameDay(when, now)) return `last seen today at ${time}`;

  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (sameDay(when, yesterday)) return `last seen yesterday at ${time}`;

  const date = when.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
  return `last seen ${date} at ${time}`;
}
