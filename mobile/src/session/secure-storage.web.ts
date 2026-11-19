/**
 * Browsers have no secure enclave: localStorage is readable by any script on the page.
 * Fine for testing; a production web client should move the session to an httpOnly cookie.
 */
export const secureStorage = {
  get: async (key: string) => window.localStorage.getItem(key),
  set: async (key: string, value: string) => window.localStorage.setItem(key, value),
  remove: async (key: string) => window.localStorage.removeItem(key),
};
