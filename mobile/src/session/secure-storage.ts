import * as SecureStore from 'expo-secure-store';

/**
 * Readable after the first unlock since boot (default is only while unlocked): the background
 * location task reads the session while the phone is locked. Not migrated to other devices.
 */
const OPTIONS: SecureStore.SecureStoreOptions = { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY };

/** Native: Keychain (iOS) / Keystore (Android). The web build uses secure-storage.web.ts instead. */
export const secureStorage = {
  get: (key: string) => SecureStore.getItemAsync(key, OPTIONS),
  // Rewriting an existing item also updates its accessibility, which migrates older sessions.
  set: (key: string, value: string) => SecureStore.setItemAsync(key, value, OPTIONS),
  remove: (key: string) => SecureStore.deleteItemAsync(key, OPTIONS),
};
