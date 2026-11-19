import * as SecureStore from 'expo-secure-store';

/** Native: Keychain (iOS) / Keystore (Android). The web build uses secure-storage.web.ts instead. */
export const secureStorage = {
  get: (key: string) => SecureStore.getItemAsync(key),
  set: (key: string, value: string) => SecureStore.setItemAsync(key, value),
  remove: (key: string) => SecureStore.deleteItemAsync(key),
};
