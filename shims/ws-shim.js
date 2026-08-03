// shims/ws-shim.js
// Provides the WebSocket implementation Supabase's realtime client asks for
// via the 'ws' package name, without pulling in the real Node 'ws' package
// (which needs Node's 'stream' module — not available in React Native and
// crashes the native bundle build).
//
// Checks global.WebSocket first (how React Native exposes it), then
// window.WebSocket (browser), then a bare WebSocket global as a last resort.

const RNWebSocket =
  (typeof global !== 'undefined' && global.WebSocket) ||
  (typeof window !== 'undefined' && window.WebSocket) ||
  (typeof WebSocket !== 'undefined' && WebSocket);

module.exports = RNWebSocket || function () {
  throw new Error('WebSocket not available on this platform');
};