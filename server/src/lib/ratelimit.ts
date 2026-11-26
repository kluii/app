// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Failed-attempt buckets for the credential paths (docs/api.md §1).
 *
 * The session buckets are enforced by `@fastify/rate-limit` in settings/
 * ratelimit.ts; these exist because a login bucket has to count *failures* and
 * be cleared by a success, which a request-counting plugin cannot express, and
 * because a lockout must not reveal whether the account exists: the key is the
 * submitted identifier, hashed, and the answer is the same 429 either way.
 *
 * In memory, per process, like the reset throttle: a restart forgives. That is
 * the documented behaviour, not an oversight.
 */
export type BucketOptions = { max: number; windowMs: number };

export type Bucket = BucketOptions & { hits: number[]; blockedUntil: number };

export class RateLimiter {
  private readonly buckets = new Map<string, Bucket>();
  private readonly now: () => number;

  constructor(now: () => number = () => Date.now()) {
    this.now = now;
  }

  private prune(key: string, windowMs: number): Bucket {
    const at = this.now();
    const existing = this.buckets.get(key);
    const hits = (existing?.hits ?? []).filter((hit) => at - hit < windowMs);
    const bucket: Bucket = {
      max: existing?.max ?? 0,
      windowMs,
      hits,
      blockedUntil: existing?.blockedUntil ?? 0,
    };
    this.buckets.set(key, bucket);
    return bucket;
  }

  /** Records one attempt. Returns the seconds to wait when the bucket is full. */
  take(
    key: string,
    options: BucketOptions,
  ): { allowed: true } | { allowed: false; retryAfter: number } {
    const bucket = this.prune(key, options.windowMs);
    bucket.max = options.max;
    if (bucket.hits.length >= options.max) {
      const oldest = bucket.hits[0] ?? this.now();
      return {
        allowed: false,
        retryAfter: Math.max(1, Math.ceil((options.windowMs - (this.now() - oldest)) / 1000)),
      };
    }
    bucket.hits.push(this.now());
    return { allowed: true };
  }

  /**
   * Checks without spending. A full account bucket must not also burn an IP
   * slot, or a single locked account would lock the whole office.
   */
  peek(
    key: string,
    options: BucketOptions,
  ): { allowed: true } | { allowed: false; retryAfter: number } {
    const bucket = this.prune(key, options.windowMs);
    if (bucket.hits.length < options.max) return { allowed: true };
    const oldest = bucket.hits[0] ?? this.now();
    return {
      allowed: false,
      retryAfter: Math.max(1, Math.ceil((options.windowMs - (this.now() - oldest)) / 1000)),
    };
  }

  /** A success clears the account bucket: four typos then the right password is not a lockout. */
  reset(key: string): void {
    this.buckets.delete(key);
  }

  /** Exposed for tests: how many attempts a key has spent. */
  count(key: string): number {
    return this.buckets.get(key)?.hits.length ?? 0;
  }

  clear(): void {
    this.buckets.clear();
  }
}

/** One limiter per process, shared by the credential routes. */
export const credentialLimiter = new RateLimiter();

export const LOGIN_ACCOUNT: BucketOptions = { max: 5, windowMs: 15 * 60 * 1000 };
export const LOGIN_IP: BucketOptions = { max: 20, windowMs: 60 * 60 * 1000 };
export const SIGNUP_IP: BucketOptions = { max: 5, windowMs: 60 * 60 * 1000 };

export function loginAccountKey(identifier: string): string {
  return `login:account:${identifier.trim().toLowerCase()}`;
}

export function loginIpKey(ip: string): string {
  return `login:ip:${ip}`;
}

/**
 * The identifier a login attempt was submitted for, or null when the body is
 * not a login body. Read before validation so a malformed attempt still spends
 * the IP bucket: that is what a credential-stuffing script sends.
 */
export function submittedIdentifier(body: unknown): string | null {
  if (typeof body !== 'object' || body === null) return null;
  const value = (body as { email_or_username?: unknown }).email_or_username;
  if (typeof value !== 'string') return null;
  const trimmed = value.trim().toLowerCase();
  return trimmed.length > 0 && trimmed.length <= 254 ? trimmed : null;
}

export function signupIpKey(ip: string): string {
  return `signup:ip:${ip}`;
}
