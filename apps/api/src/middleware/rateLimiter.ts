import type { NextFunction, Request, Response } from "express";

/**
 * Minimal in-memory token bucket, keyed by client id, to keep expensive
 * processing-job creation from being spammed. Adequate for a single-node
 * MVP deployment; a multi-node deployment should replace this with a
 * Redis-backed limiter (same interface: `consume(key)` returning boolean).
 */
class TokenBucket {
  private buckets = new Map<string, { tokens: number; lastRefill: number }>();

  constructor(private readonly capacity: number, private readonly refillPerMs: number) {}

  consume(key: string): boolean {
    const now = Date.now();
    const bucket = this.buckets.get(key) ?? { tokens: this.capacity, lastRefill: now };
    const elapsed = now - bucket.lastRefill;
    bucket.tokens = Math.min(this.capacity, bucket.tokens + elapsed * this.refillPerMs);
    bucket.lastRefill = now;
    if (bucket.tokens < 1) {
      this.buckets.set(key, bucket);
      return false;
    }
    bucket.tokens -= 1;
    this.buckets.set(key, bucket);
    return true;
  }
}

// 5 processing jobs per hour per client, refilling continuously.
const processingJobBucket = new TokenBucket(5, 5 / (60 * 60 * 1000));

export function rateLimitProcessingJobs(req: Request, res: Response, next: NextFunction): void {
  const clientId = (req.headers["x-client-id"] as string) || req.ip || "unknown";
  if (!processingJobBucket.consume(clientId)) {
    res.status(429).json({ error: "Rate limit exceeded. Please wait before starting another song." });
    return;
  }
  next();
}
