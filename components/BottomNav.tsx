// components/BottomNav.tsx
// Shared bottom navigation bar used by index.tsx, explore.tsx, dealer.tsx,
// profile.tsx, and messages.tsx — previously each of those screens carried
// its own copy-pasted version of this row, with the "active" tab hardcoded
// per-screen.
//
// UPDATED (product request): tabs now live inside a horizontal ScrollView
// instead of a fixed space-around row, and tapping one plays a quick
// scale-up "highlight" animation on the icon while the row scrolls so the
// tapped tab slides toward the center of the bar — the same happens when a
// screen first loads, so the active tab animates into a centered position
// rather than just appearing there. Real navigation (router.push) is
// deliberately delayed ~110ms after a tap so the animation actually gets a
// moment to be visible before the screen changes underneath it — a
// negligible amount of added latency, but without it the whole effect
// would be cut off almost before it started, since navigation would fire
// on the very next frame.
//
// Each item is given a generous minWidth so the row is intentionally wider
// than most phone screens even with only 4-5 tabs — this is what makes the
// scroll actually have somewhere to go, rather than the ScrollView clamping
// every scrollTo() call back to 0 because nothing overflows.
//
// UPDATED AGAIN (product request, later reverted): "Profile" briefly
// showed a "⋯" icon instead of a person glyph — tried a version where
// "⋯" popped up a small menu you then had to tap "Profile" inside of,
// but that made getting to Profile a two-step process for the one
// thing it led to, so it was changed to go straight to Profile on tap,
// same one-tap behavior as every other tab, just with a different
// icon. Reverted back to a normal profile icon (👤) per a later product
// request — same glyph this app already uses elsewhere as the
// person/avatar fallback (messages.tsx, index.tsx, chat.tsx), so this
// keeps that vocabulary consistent instead of introducing a new one
// just for this tab.
//
// UPDATED AGAIN (website review): the horizontal-scroll row is genuinely
// the right call on a phone — swiping to reveal more tabs is a completely
// normal, discoverable gesture there. On the website it isn't: there's no
// visible scrollbar (showsHorizontalScrollIndicator is off, on purpose,
// for the native look) and dragging a nav bar sideways with a mouse isn't
// something people think to try, so the last tab was just silently cut
// off at the frame's edge, reading as a bug rather than "scroll for
// more." On web only, tabs now render in a plain flexed row that shares
// the available width evenly instead — every tab fits, nothing to
// discover, nothing cut off. Native keeps the original scrollable
// version untouched.

import { useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Animated, LayoutChangeEvent, Platform, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { refreshUnreadCount, subscribeToUnreadCount } from '../lib/unreadMessages';

// FIX: useNativeDriver: true does not reliably animate Animated.Text on
// the web target (react-native-web either warns and no-ops, or silently
// skips the transform depending on version) — confirmed by real testing:
// the highlight animation played on native but never appeared on web.
// Native driver isn't needed for a single small scale transform anyway,
// so just disable it on web and keep it on native where it's cheap.
const USE_NATIVE_DRIVER = Platform.OS !== 'web';
const IS_WEB = Platform.OS === 'web';

const GOLD = '#B8860B';
const BLACK = '#1A1A18';
const DARK = '#2a2a2a';

export type NavKey = 'home' | 'browse' | 'messages' | 'dealer' | 'admin' | 'profile';

type TabEntry = { type: 'tab'; key: NavKey; icon: string; label: string; route: string };
type PostEntry = { type: 'post'; route: string };
type Entry = TabEntry | PostEntry;

const HOME: TabEntry = { type: 'tab', key: 'home', icon: '🏠', label: 'Home', route: '/' };
const BROWSE: TabEntry = { type: 'tab', key: 'browse', icon: '🔍', label: 'Browse', route: '/explore' };
const POST: PostEntry = { type: 'post', route: '/post' };
const MESSAGES: TabEntry = { type: 'tab', key: 'messages', icon: '💬', label: 'Messages', route: '/messages' };
const DASHBOARD: TabEntry = { type: 'tab', key: 'dealer', icon: '🏪', label: 'Dashboard', route: '/dealer' };
const ADMIN: TabEntry = { type: 'tab', key: 'admin', icon: '🛡️', label: 'Admin', route: '/admin-verification-review' };
const PROFILE: TabEntry = { type: 'tab', key: 'profile', icon: '👤', label: 'Profile', route: '/profile' };

interface BottomNavProps {
  active: NavKey;
  showDashboardTab?: boolean;
  isAdmin?: boolean;
}

export default function BottomNav({ active, showDashboardTab, isAdmin }: BottomNavProps) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const scrollRef = useRef<ScrollView>(null);
  const containerWidthRef = useRef(0);
  const layoutsRef = useRef<Record<string, { x: number; width: number }>>({});
  const [pressedKey, setPressedKey] = useState<NavKey | null>(null);
  const scaleAnim = useRef(new Animated.Value(1)).current;

  const entries: Entry[] = [
    HOME,
    BROWSE,
    POST,
    MESSAGES,
    ...(showDashboardTab ? [DASHBOARD] : []),
    ...(isAdmin ? [ADMIN] : []),
    PROFILE,
  ];

  function scrollToKey(key: string, animated: boolean) {
    const layout = layoutsRef.current[key];
    const containerWidth = containerWidthRef.current;
    if (!layout || !containerWidth || !scrollRef.current) return;
    const targetX = layout.x + layout.width / 2 - containerWidth / 2;
    scrollRef.current.scrollTo({ x: Math.max(0, targetX), animated });
  }

  useEffect(() => {
    // Give onLayout a moment to populate layoutsRef before centering —
    // without this delay, the very first render has no measurements yet
    // and the scroll silently no-ops.
    const t = setTimeout(() => scrollToKey(active, true), 60);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  function playPopAnimation() {
    scaleAnim.setValue(1);
    // FIX: previously a single Animated.spring straight to 1.22 with no
    // way back down — combined with only a 110ms delay before navigating,
    // the spring rarely got far enough to actually read as a visible
    // "pop" before the screen changed out from under it. Now an explicit
    // quick pop-up followed by a settle-back, and the navigation delay
    // below is long enough for both halves to actually be seen.
    Animated.sequence([
      Animated.timing(scaleAnim, { toValue: 1.28, duration: 90, useNativeDriver: USE_NATIVE_DRIVER }),
      Animated.spring(scaleAnim, { toValue: 1, useNativeDriver: USE_NATIVE_DRIVER, speed: 20, bounciness: 8 }),
    ]).start();
  }

  function handlePress(entry: TabEntry) {
    setPressedKey(entry.key);
    playPopAnimation();
    scrollToKey(entry.key, true);

    setTimeout(() => {
      router.push(entry.route as any);
    }, 200);
  }

  // The badge number. Owned by lib/unreadMessages, not by this component:
  // BottomNav mounts and unmounts on every navigation, and a realtime
  // channel with that lifecycle is what broke chat on 27 Aug. Here we only
  // listen to a plain callback, which has nothing to get wrong.
  const [unreadCount, setUnreadCount] = useState(0);

  useEffect(() => {
    const unsubscribe = subscribeToUnreadCount(setUnreadCount);
    // Re-read on mount as well as listening: covers a message that arrived
    // while this screen was not on top.
    refreshUnreadCount();
    return unsubscribe;
  }, []);

  function renderEntry(entry: Entry) {
    if (entry.type === 'post') {
      return (
        <TouchableOpacity
          key="post"
          style={styles.navPost}
          onPress={() => router.push(entry.route as any)}
        >
          {/* FIX: the "+" kept reading as off-center even after the
              earlier lineHeight fix — text-glyph centering for a "+"
              character depends on font baseline metrics that vary by
              platform/font and were never fully reliable. Building it
              from two plain bars instead is immune to all of that: it's
              centered by exact pixel math (margin: 'auto' against all
              four 0 offsets), not by how a font happens to draw a
              glyph, so it can't drift off-center again. */}
          <View style={styles.plusBarHorizontal} />
          <View style={styles.plusBarVertical} />
        </TouchableOpacity>
      );
    }

    const isActive = entry.key === active;
    const isPressed = entry.key === pressedKey;

    return (
      <TouchableOpacity
        key={entry.key}
        style={[styles.navItem, IS_WEB && styles.navItemWeb]}
        onLayout={(e: LayoutChangeEvent) => {
          layoutsRef.current[entry.key] = {
            x: e.nativeEvent.layout.x,
            width: e.nativeEvent.layout.width,
          };
        }}
        onPress={() => handlePress(entry)}
      >
        <View>
          <Animated.Text
            style={[
              styles.navIcon,
              (isActive || isPressed) && styles.navIconActive,
              isPressed && { transform: [{ scale: scaleAnim }] },
            ]}
          >
            {entry.icon}
          </Animated.Text>
          {/* Conversations waiting, not messages: twelve messages from one
              person is one thing to answer. Capped at 9+ so the pill never
              grows wide enough to unbalance the row. */}
          {entry.key === 'messages' && unreadCount > 0 && (
            <View style={styles.navBadge} pointerEvents="none">
              <Text style={styles.navBadgeText} allowFontScaling={false}>
                {unreadCount > 9 ? '9+' : String(unreadCount)}
              </Text>
            </View>
          )}
        </View>
        <Text
          style={[styles.navLabel, (isActive || isPressed) && styles.navLabelActive]}
          numberOfLines={1}
          allowFontScaling={false}
        >
          {entry.label}
        </Text>
      </TouchableOpacity>
    );
  }

  return (
    <View style={[styles.wrap, { paddingBottom: 24 + insets.bottom }]}>
      {IS_WEB ? (
        // No scrolling on web — see the comment near IS_WEB above for why.
        // Tabs share the available width evenly instead of a fixed
        // minWidth, so everything fits with nothing cut off.
        <View style={styles.webRow}>
          {entries.map((entry) => renderEntry(entry))}
        </View>
      ) : (
        <ScrollView
          ref={scrollRef}
          horizontal
          showsHorizontalScrollIndicator={false}
          onLayout={(e: LayoutChangeEvent) => {
            containerWidthRef.current = e.nativeEvent.layout.width;
          }}
          contentContainerStyle={styles.scrollContent}
        >
          {entries.map((entry) => renderEntry(entry))}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    backgroundColor: BLACK, borderTopWidth: 0.5, borderTopColor: DARK, paddingVertical: 10,
  },
  scrollContent: { alignItems: 'center', paddingHorizontal: 16 },
  webRow: { flexDirection: 'row', alignItems: 'center', width: '100%', paddingHorizontal: 16 },
  navItem: { alignItems: 'center', minWidth: 84, paddingHorizontal: 6 },
  // Web-only override: share the row evenly instead of each tab claiming
  // a fixed minWidth — see the comment near IS_WEB at the top of the file.
  navItemWeb: { flex: 1, minWidth: 0 },
  // Anchored to the icon rather than the whole tab, so it sits on the
  // glyph the way people expect and does not drift when the label wraps.
  navBadge: {
    position: 'absolute', top: -4, right: -10, minWidth: 18, height: 18,
    borderRadius: 9, backgroundColor: '#c0392b', alignItems: 'center',
    justifyContent: 'center', paddingHorizontal: 4,
  },
  navBadgeText: { color: '#fff', fontSize: 11, fontWeight: '800' },
  navIcon: { fontSize: 22, color: '#555' },
  navIconActive: { color: GOLD },
  navLabel: { fontSize: 9, color: '#555', marginTop: 2 },
  navLabelActive: { color: GOLD },
  navPost: {
    width: 44, height: 44, backgroundColor: GOLD, borderRadius: 22,
    alignItems: 'center', justifyContent: 'center', marginHorizontal: 20,
  },
  // Two plain bars instead of a "+" text glyph — see the comment above
  // where these are used for why.
  //
  // FIX (real bug, reported: "the + sign is not showing... it only
  // show a circle without anything"): the previous version centered
  // these via `top:0, left:0, right:0, bottom:0, margin:'auto'` — a
  // real CSS centering trick, but one that assumes a real browser CSS
  // engine. React Native's own layout engine (Yoga) does NOT reliably
  // resolve that exact combination the same way on iOS/Android — margin:
  // 'auto' support in Yoga is limited and inconsistent, especially
  // stacked with all four offsets at once, so on-device this could
  // resolve to zero size or an unpositioned box instead of a centered
  // bar, i.e. nothing visible at all, leaving just the plain gold
  // circle behind it. Replaced with explicit numeric offsets computed
  // against navPost's known 44x44 size — (44-width)/2 and (44-height)/2
  // — which every layout engine (Yoga included) resolves identically,
  // so this can't silently fail to render on native the way the CSS
  // trick could.
  plusBarHorizontal: {
    position: 'absolute', top: 20.5, left: 14,
    width: 16, height: 3, borderRadius: 1.5, backgroundColor: BLACK,
  },
  plusBarVertical: {
    position: 'absolute', top: 14, left: 20.5,
    width: 3, height: 16, borderRadius: 1.5, backgroundColor: BLACK,
  },
});
