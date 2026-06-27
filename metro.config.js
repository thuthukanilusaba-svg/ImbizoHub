const { getDefaultConfig } = require('expo/metro-config');
const config = getDefaultConfig(__dirname);

const originalResolver = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (platform === 'web' && moduleName === 'ws') {
    return { type: 'empty' };
  }
  return (originalResolver || context.resolveRequest)(context, moduleName, platform);
};

module.exports = config;