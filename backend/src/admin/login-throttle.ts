/**
 * Brute-force guard for the shared master password: after `maxFailures` wrong attempts from one
 * address, that address is locked out until the window ends. In memory on purpose: a restart
 * resets it, which is acceptable for a single-instance deployment.
 */
export class LoginThrottle {
  readonly #attempts = new Map<string, { failures: number; resetAt: number }>();
  readonly #maxFailures: number;
  readonly #windowMs: number;
  readonly #now: () => number;

  constructor(options: { maxFailures?: number; windowMs?: number; now?: () => number } = {}) {
    this.#maxFailures = options.maxFailures ?? 5;
    this.#windowMs = options.windowMs ?? 15 * 60_000;
    this.#now = options.now ?? Date.now;
  }

  isLocked(key: string): boolean {
    const entry = this.#current(key);
    return entry !== undefined && entry.failures >= this.#maxFailures;
  }

  recordFailure(key: string): void {
    const entry = this.#current(key) ?? { failures: 0, resetAt: this.#now() + this.#windowMs };
    entry.failures += 1;
    this.#attempts.set(key, entry);
  }

  recordSuccess(key: string): void {
    this.#attempts.delete(key);
  }

  #current(key: string) {
    const entry = this.#attempts.get(key);
    if (entry && entry.resetAt <= this.#now()) {
      this.#attempts.delete(key);
      return undefined;
    }
    return entry;
  }
}
