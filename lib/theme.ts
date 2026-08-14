// lib/theme.ts
//
// Central color palette. WEB ONLY gets the new cream/coffee look —
// native mobile keeps the original dark theme completely unchanged,
// per explicit instruction (this is a website-only redesign, not an
// app-wide rebrand). Every value below resolves differently depending
// on Platform.OS, so a screen that imports `theme` and uses
// `theme.background` etc. automatically gets cream on web and the
// existing dark colors on native, with no per-screen Platform checks
// needed.
//
// Previously, ~44 route files each defined their own local BLACK /
// DARK / GREY / GOLD constants with no shared source of truth. This
// file replaces that pattern going forward — screens being migrated
// should import `theme` from here instead of redefining their own
// color constants, so a future palette tweak (on either platform) is
// a one-line change here instead of a hunt through every screen.

import { Platform } from 'react-native';

const dark = {
  background: '#1A1A18',   // was every screen's local BLACK
  card: '#2a2a2a',         // was every screen's local DARK
  text: '#FFFFFF',
  textMuted: '#AAAAAA',    // was every screen's local GREY
  border: '#333333',
  accent: '#B8860B',       // GOLD — unchanged on both platforms
  buttonBg: '#B8860B',
  buttonText: '#1A1A18',
};

const cream = {
  background: '#FAF3E7',
  card: '#F1E7D5',
  text: '#3B2A1E',         // coffee — replaces white text
  textMuted: '#8A7562',    // muted coffee — replaces GREY
  border: '#E3D5BC',
  accent: '#B8860B',       // GOLD — unchanged, reads fine on cream
  buttonBg: '#B8860B',
  buttonText: '#3B2A1E',   // coffee text on gold buttons (was black)
};

export const theme = Platform.OS === 'web' ? cream : dark;
