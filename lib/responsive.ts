// lib/responsive.ts
//
// Shared breakpoint for the website's desktop layout. The app is built
// phone-first everywhere; on the website specifically, screens above
// DESKTOP_BREAKPOINT USED TO get a wider frame and multi-column grids
// instead of the phone-style narrow/single-column layout — see the
// REVERTED note below. Native apps never hit this — Platform.OS is
// never 'web' there, so useIsDesktopWeb() always returns false
// regardless of screen size.
//
// Kept as one shared constant/hook (rather than each screen picking its
// own number) so the root frame width (_layout.tsx) and each screen's
// grid column count switch over at exactly the same width — otherwise
// a screen's content could end up wider or narrower than the frame
// around it right at the breakpoint. That property is exactly what
// makes the revert below a single-line change instead of a per-screen
// hunt: every consumer branches on this one hook.
//
// REVERTED (explicit product decision: "go back to 480px i dont want it
// to be wide"): the desktop-breakpoint experiment — a wider frame in
// _layout.tsx plus 4-column grids in index.tsx/explore.tsx above
// DESKTOP_BREAKPOINT — is switched off. The whole website now stays at
// the original narrow, centered, phone-proportioned ~480px column at
// every width, the same as it already did below the breakpoint.
// DESKTOP_LAYOUT_ENABLED is the single flag controlling that; flipping
// it back to true (with no other changes) restores the wide desktop
// layout exactly as it was, since none of that code was removed, only
// gated off here.
import { Platform, useWindowDimensions } from 'react-native';

const DESKTOP_LAYOUT_ENABLED = false;

export const DESKTOP_BREAKPOINT = 900;

export function useIsDesktopWeb(): boolean {
  const { width } = useWindowDimensions();
  return DESKTOP_LAYOUT_ENABLED && Platform.OS === 'web' && width >= DESKTOP_BREAKPOINT;
}
