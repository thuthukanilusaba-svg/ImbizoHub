// lib/unreadMessages.ts
//
// How many CONVERSATIONS have unread messages waiting for you — the number
// on the 💬 tab.
//
// Conversations, not messages. Twelve messages from one person is one thing
// to deal with, not twelve, and it is what every messaging app people
// already use does. The grouping happens in the database
// (my_unread_conversation_count) because counting distinct pairs is not
// expressible through PostgREST.
//
// WHY THIS IS A MODULE SINGLETON RATHER THAN A HOOK OR CONTEXT:
// BottomNav renders on nearly every screen, so it mounts and unmounts
// constantly as you navigate. A realtime channel owned by a component that
// remounts is exactly what caused the bug found on 27 Aug —
// supabase.channel(name) returns the EXISTING channel when one of that name
// is already registered, and calling .on() on an already-subscribed channel
// throws "cannot add postgres_changes callbacks after subscribe()". The
// listener then never attaches and the screen silently stops updating.
//
// So the channel is created once, here, for the life of the signed-in
// session. Components subscribe to a plain callback instead — no channels,
// no lifecycle, nothing to get wrong when a screen unmounts mid-navigation.

import { supabase } from './supabase';

let currentCount = 0;
let channel: any = null;
let watchingUserId: string | null = null;

const listeners = new Set<(count: number) => void>();

function emit() {
  listeners.forEach((fn) => {
    try {
      fn(currentCount);
    } catch {
      // One misbehaving listener must not stop the others being told.
    }
  });
}

/**
 * Listen for changes to the badge number. Fires immediately with the value
 * known right now, so a freshly mounted component never flashes empty
 * before the first refresh lands. Returns an unsubscribe function.
 */
export function subscribeToUnreadCount(fn: (count: number) => void) {
  listeners.add(fn);
  fn(currentCount);
  return () => {
    listeners.delete(fn);
  };
}

/** The value without subscribing — useful for a first render. */
export function getUnreadCount() {
  return currentCount;
}

/**
 * Re-read the count from the database. Safe to call often; it is one small
 * aggregate query. Call it after marking a conversation read so the badge
 * drops immediately rather than waiting for anything.
 */
export async function refreshUnreadCount() {
  try {
    const { data, error } = await supabase.rpc('my_unread_conversation_count');
    if (error) {
      // Not fatal and not worth interrupting anyone over — a stale badge is
      // a much smaller problem than an error in their face.
      console.log('unread count refresh failed:', error.message);
      return;
    }
    const next = typeof data === 'number' ? data : 0;
    if (next !== currentCount) {
      currentCount = next;
      emit();
    }
  } catch (err) {
    console.log('unread count refresh threw:', err);
  }
}

/**
 * Start watching for this user. Called once when a session is confirmed.
 * Idempotent: calling it again for the same user just refreshes.
 */
export async function startUnreadWatcher(userId: string) {
  if (!userId) return;

  if (watchingUserId === userId && channel) {
    await refreshUnreadCount();
    return;
  }

  // Different user (or a stale channel) — tear the old one down first, and
  // AWAIT it. removeChannel returns a promise, and not awaiting it is the
  // other half of the 27 Aug bug: the new .channel() call can still find
  // the old one registered and hand it back already-subscribed.
  await stopUnreadWatcher();

  watchingUserId = userId;
  await refreshUnreadCount();

  try {
    channel = supabase
      .channel(`unread-messages-${userId}`)
      // postgres_changes filters compare a single column, which is exactly
      // what is needed here: messages addressed to me.
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'messages',
          filter: `receiver_id=eq.${userId}`,
        },
        () => {
          // Re-count rather than incrementing. A second message in a
          // conversation you already have unread must NOT raise the number,
          // and only the database knows how the grouping falls.
          refreshUnreadCount();
        }
      )
      .subscribe();
  } catch (err) {
    // Without realtime the badge still works, it just updates when a screen
    // regains focus instead of instantly. Degraded, not broken.
    console.log('unread watcher subscribe failed:', err);
    channel = null;
  }
}

/** Stop watching and clear the badge. Call on sign-out. */
export async function stopUnreadWatcher() {
  if (channel) {
    try {
      await supabase.removeChannel(channel);
    } catch {
      // Already gone — nothing to do.
    }
    channel = null;
  }
  watchingUserId = null;
  if (currentCount !== 0) {
    currentCount = 0;
    emit();
  }
}

/**
 * Mark one conversation as read. Pass whichever context identifies it —
 * exactly one of listing / request / item_request, matching how the chat
 * screen was opened.
 *
 * messages has no UPDATE policy on purpose, so this goes through a
 * SECURITY DEFINER function that can only ever stamp read_at on mail where
 * you are the receiver.
 */
export async function markConversationRead(opts: {
  otherUserId: string;
  listingId?: string | number | null;
  requestId?: string | number | null;
  itemRequestId?: string | null;
}) {
  const { otherUserId, listingId, requestId, itemRequestId } = opts;
  if (!otherUserId) return;

  try {
    const { error } = await supabase.rpc('mark_conversation_read', {
      p_other_user_id: otherUserId,
      p_listing_id: listingId != null ? Number(listingId) : null,
      p_request_id: requestId != null ? Number(requestId) : null,
      p_item_request_id: itemRequestId ?? null,
    });
    if (error) {
      console.log('mark conversation read failed:', error.message);
      return;
    }
    await refreshUnreadCount();
  } catch (err) {
    console.log('mark conversation read threw:', err);
  }
}
