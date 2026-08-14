// lib/responsive.ts
//
// Shared breakpoint for the website's desktop layout. The app is built
// phone-first everywhere; on the website specifically, screens above
// DESKTOP_BREAKPOINT get a wider frame and multi-column grids instead of
// the phone-style narrow/single-column layout. Native apps never hit
// this — Platform.OS is never 'web' there, so useIsDesktopWeb() always
// returns false regardless of screen size.
//
// Kept as one shared constant/hook (rather than each screen picking its
// own number) so the root frame width (_layout.tsx) and each screen's
// grid column count switch over at exactly the same width — otherwise
// a screen's content could end up wider or narrower than the frame
// around it right at the breakpoint.

import { Platform, useWindowDimensions } from 'react-native';

export const DESKTOP_BREAKPOINT = 900;

export function useIsDesktopWeb(): boolean {
  const { width } = useWindowDimensions();
  return Platform.OS === 'web' && width >= DESKTOP_BREAKPOINT;
}
