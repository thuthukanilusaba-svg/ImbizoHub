const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');
const config = getDefaultConfig(__dirname);

const originalResolver = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  // Previously this only applied on platform === 'web', so native builds
  // (Android/iOS via Expo Go) fell through to the real 'ws' package, which
  // needs Node's 'stream' module and isn't available in React Native —
  // that's what was crashing the native bundle. The shim now applies on
  // every platform, since Supabase's realtime client asks for 'ws'
  // regardless of whether it's running on web or native.
  if (moduleName === 'ws') {
    return {
      type: 'sourceFile',
      filePath: path.resolve(__dirname, 'shims/ws-shim.js'),
    };
  }
  return (originalResolver || context.resolveRequest)(context, moduleName, platform);
};

module.exports = config;