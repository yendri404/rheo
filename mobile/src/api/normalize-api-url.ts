// Kept free of Expo and React imports so it runs under `node --test`.

/**
 * Turns what a tester typed into an API base URL, or null when it is not one.
 * A bare host such as `192.168.1.20:3000` gets `http://`, the usual case on a local network.
 */
export function normalizeApiUrl(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  const candidate = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    return null;
  }
  if ((url.protocol !== 'http:' && url.protocol !== 'https:') || !url.hostname) return null;
  if (url.search || url.hash || url.username || url.password) return null;
  return `${url.origin}${url.pathname}`.replace(/\/+$/, '');
}
