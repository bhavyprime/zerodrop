import { config } from '../config.js';

/**
 * Fixed-window counter of failed attempts per key (an IP address).
 * In memory, so limits are per server process; use a shared store (e.g. Redis)
 * if you run several instances.
 */
export class AttemptGuard {
  constructor({ max, windowMs }) {
    this.max = max;
    this.windowMs = windowMs;
    this.entries = new Map();
  }

  /** Returns { blocked, retryAfterMs, left }. */
  status(key, now = Date.now()) {
    const entry = this.entries.get(key);
    if (!entry || now - entry.first >= this.windowMs) {
      this.entries.delete(key);
      return { blocked: false, left: this.max };
    }
    if (entry.count >= this.max) {
      return { blocked: true, retryAfterMs: this.windowMs - (now - entry.first), left: 0 };
    }
    return { blocked: false, left: this.max - entry.count };
  }

  fail(key, now = Date.now()) {
    const entry = this.entries.get(key);
    if (!entry || now - entry.first >= this.windowMs) {
      this.entries.set(key, { count: 1, first: now });
    } else {
      entry.count += 1;
    }
  }

  sweep(now = Date.now()) {
    for (const [key, entry] of this.entries) {
      if (now - entry.first >= this.windowMs) this.entries.delete(key);
    }
  }

  reset() {
    this.entries.clear();
  }
}

export const ipAttempts = new AttemptGuard({
  max: config.maxFailedAttempts,
  windowMs: config.attemptWindowMs,
});

setInterval(() => ipAttempts.sweep(), 5 * 60 * 1000).unref();
