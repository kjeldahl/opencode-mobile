// Web shim for expo-secure-store (its real web build is an empty object, so
// app/_layout.tsx's settings load crashes). localStorage-backed. Copied over
// node_modules/expo-secure-store/build/ExpoSecureStore.web.js by setup.sh;
// teardown.sh restores the original. Never commit node_modules changes.
const store = () => globalThis.localStorage
export default {
  getValueWithKeyAsync: async (key) => store()?.getItem(key) ?? null,
  getValueWithKeySync: (key) => store()?.getItem(key) ?? null,
  setValueWithKeyAsync: async (value, key) => store()?.setItem(key, value),
  setValueWithKeySync: (value, key) => store()?.setItem(key, value),
  deleteValueWithKeyAsync: async (key) => store()?.removeItem(key),
  canUseBiometricAuthentication: () => false,
}
