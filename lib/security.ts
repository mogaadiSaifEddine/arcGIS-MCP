import { createHash, timingSafeEqual } from "node:crypto";

const sha256 = (s: string) => createHash("sha256").update(s).digest();

/** Constant-time bearer token check against MCP_AUTH_TOKEN. */
export function checkBearer(req: Request, expected: string | undefined): "ok" | "missing-config" | "unauthorized" {
  if (!expected) return "missing-config";
  const header = req.headers.get("authorization") ?? "";
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  if (!match) return "unauthorized";
  // Hash both sides so lengths match for timingSafeEqual.
  return timingSafeEqual(sha256(match[1]), sha256(expected)) ? "ok" : "unauthorized";
}

/**
 * Fixed-window, in-memory rate limiter. Per serverless instance, so it is a
 * guard against runaway loops rather than a precise global quota; swap in a
 * shared store (e.g. Upstash/Redis) for strict limits.
 */
export function createRateLimiter(limitPerMinute: number, windowMs = 60_000) {
  const hits = new Map<string, { start: number; count: number }>();
  return function take(key: string, now = Date.now()): { allowed: boolean; retryAfterSec: number } {
    if (hits.size > 10_000) {
      for (const [k, v] of hits) if (now - v.start >= windowMs) hits.delete(k);
    }
    const entry = hits.get(key);
    if (!entry || now - entry.start >= windowMs) {
      hits.set(key, { start: now, count: 1 });
      return { allowed: true, retryAfterSec: 0 };
    }
    entry.count++;
    const allowed = entry.count <= limitPerMinute;
    return { allowed, retryAfterSec: allowed ? 0 : Math.ceil((entry.start + windowMs - now) / 1000) };
  };
}

export function clientKey(req: Request): string {
  const auth = req.headers.get("authorization");
  if (auth) return "tok:" + sha256(auth).toString("hex").slice(0, 16);
  return "ip:" + (req.headers.get("x-forwarded-for")?.split(",")[0].trim() || "unknown");
}
