// How often one person may ask.
//
// A sliding window held in memory. On a serverless host that memory is one
// instance's, so this is a brake on a stuck loop or an over-eager tab rather
// than a hard quota — the hard ceiling is the spend limit set on the provider's
// console. It is still worth having: the failure it stops is a page that
// re-sends on every render, and that comes from one instance at a time.

export type Taken = { ok: true } | { ok: false; retryAfterSec: number };

export interface RateLimiter {
  take(key: string): Taken;
}

export function createRateLimiter(opts: {
  limit: number;
  windowMs: number;
  now?: () => number;
}): RateLimiter {
  const { limit, windowMs } = opts;
  const now = opts.now ?? Date.now;
  const seen = new Map<string, number[]>();
  /** Past this many people, forget the ones with nothing left in the window. */
  const PRUNE_AT = 5_000;

  return {
    take(key) {
      const t = now();
      if (seen.size > PRUNE_AT) {
        for (const [k, times] of seen) if (times.every((at) => t - at >= windowMs)) seen.delete(k);
      }
      const recent = (seen.get(key) ?? []).filter((at) => t - at < windowMs);
      if (recent.length >= limit) {
        seen.set(key, recent);
        return { ok: false, retryAfterSec: Math.ceil((recent[0] + windowMs - t) / 1000) };
      }
      seen.set(key, [...recent, t]);
      return { ok: true };
    },
  };
}
