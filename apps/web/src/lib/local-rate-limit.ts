/**
 * Best-effort per-isolate rate limiting for Cloudflare Workers Free.
 * Counters are not distributed and can reset on isolate restart; this is a
 * lightweight abuse brake, not a substitute for account-level protections.
 * The map is capped to bound memory usage.
 */
type Bucket = { count: number; resetAt: number };
const buckets = new Map<string, Bucket>();
const MAX_BUCKETS = 5_000;

export function consumeLocalRateLimit(key: string, limit: number, windowMs: number, now = Date.now()): boolean {
  let bucket = buckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    if (buckets.size >= MAX_BUCKETS) {
      for (const [existingKey, existing] of buckets) {
        if (existing.resetAt <= now) buckets.delete(existingKey);
      }
      if (buckets.size >= MAX_BUCKETS) return false;
    }
    bucket = { count: 0, resetAt: now + windowMs };
    buckets.set(key, bucket);
  }
  if (bucket.count >= limit) return false;
  bucket.count += 1;
  return true;
}
