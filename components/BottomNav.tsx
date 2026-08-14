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
// UPDATED AGAIN (product request): "Profile" now shows a "⋯" icon instead
// of the person glyph — tried a version where "⋯" popped up a small menu
// you then had to tap "Profile" inside of, but that made getting to
// Profile a two-step process for the one thing it led to. Tapping "⋯" now
// goes straight to Profile, same one-tap behavior as every other tab, just
// with a different icon.
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
const PROFILE: TabEntry = { type: 'tab', key: 'profile', icon: '⋯', label: 'Profile', route: '/profile' };

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

  function renderEntry(entry: Entry) {
    if (entry.type === 'post') {
      return (
        <TouchableOpacity
          key="post"
          style={styles.navPost}
          onPress={() => router.push(entry.route as any)}
        >
          <Text style={styles.navPostText}>+</Text>
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
        <Animated.Text
          style={[
            styles.navIcon,
            entry.key === 'profile' && styles.navIconMore,
            (isActive || isPressed) && styles.navIconActive,
            isPressed && { transform: [{ scale: scaleAnim }] },
          ]}
        >
          {entry.icon}
        </Animated.Text>
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
  navIcon: { fontSize: 22, color: '#555' },
  navIconActive: { color: GOLD },
  navLabel: { fontSize: 9, color: '#555', marginTop: 2 },
  navLabelActive: { color: GOLD },
  navPost: {
    width: 44, height: 44, backgroundColor: GOLD, borderRadius: 22,
    alignItems: 'center', justifyContent: 'center', marginHorizontal: 20,
  },
  // FIX: an explicit lineHeight taller than the glyph itself (28 vs a 24pt
  // font) pushed the "+" visibly above center inside the circle — a common
  // RN text-centering quirk. Dropping lineHeight and disabling Android's
  // extra font padding lets the surrounding flex centering (alignItems/
  // justifyContent: 'center' on navPost) actually center it.
  navPostText: {
    color: BLACK, fontSize: 24, fontWeight: '700',
    includeFontPadding: false, textAlign: 'center', textAlignVertical: 'center',
  },
  // The ellipsis glyph sits visually smaller/higher than the emoji icons
  // next to it at the same fontSize, so it gets a small bump + nudge to
  // read as the same weight/position in the row.
  navIconMore: { fontSize: 26, marginTop: -4 },
});
