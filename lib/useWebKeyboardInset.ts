// lib/useWebKeyboardInset.ts
//
// How many pixels of the page the on-screen keyboard is currently
// covering, on the website. Always 0 in the native apps.
//
// WHY THIS EXISTS:
// KeyboardAvoidingView does nothing on react-native-web. It works by
// listening for the keyboard events React Native emits on iOS and
// Android, and the browser emits none — so on the website it renders as
// a plain View and the layout keeps its full height while the keyboard
// is up. The result on a phone browser is the message input sitting
// underneath the keyboard, with the browser's own form bar visible where
// the input should be.
//
// The browser does report this, just through a different API. The visual
// viewport is the part of the page actually visible; the layout viewport
// is the full page. The difference between them is the keyboard.
//
// visualViewport is absent on some older browsers, in which case this
// returns 0 and the behaviour is exactly what it is today — no worse.

import { useEffect, useState } from 'react';
import { Platform } from 'react-native';

export function useWebKeyboardInset(): number {
  const [inset, setInset] = useState(0);

  useEffect(() => {
    if (Platform.OS !== 'web') return;
    if (typeof window === 'undefined') return;

    const vv: VisualViewport | undefined = (window as any).visualViewport;
    if (!vv) return;

    const update = () => {
      // offsetTop matters: iOS scrolls the visual viewport up to keep the
      // focused field visible, and without it the inset reads too large
      // and the layout jumps.
      const covered = window.innerHeight - vv.height - vv.offsetTop;
      // Small non-zero values come from browser chrome appearing and
      // disappearing while scrolling, not from a keyboard. Ignoring them
      // stops the layout twitching on every scroll.
      setInset(covered > 80 ? Math.round(covered) : 0);
    };

    update();
    vv.addEventListener('resize', update);
    vv.addEventListener('scroll', update);
    return () => {
      vv.removeEventListener('resize', update);
      vv.removeEventListener('scroll', update);
    };
  }, []);

  return inset;
}
