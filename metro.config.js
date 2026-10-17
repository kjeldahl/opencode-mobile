// Metro bundler config: Expo's defaults.
const { getDefaultConfig } = require("expo/metro-config")

/** @type {import('expo/metro-config').MetroConfig} */
const config = getDefaultConfig(__dirname)

// CI points METRO_CACHE_DIR at a directory it caches between runs. Unset locally: Expo's default.
if (process.env.METRO_CACHE_DIR) {
  const { FileStore } = require("metro-cache")
  config.cacheStores = [new FileStore({ root: process.env.METRO_CACHE_DIR })]
}

module.exports = config
