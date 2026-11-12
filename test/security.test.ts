import { test } from "node:test";
import assert from "node:assert/strict";
import { checkBearer, createRateLimiter } from "../lib/security.ts";
import { resolveFields } from "../lib/fields.ts";

const req = (auth?: string) => new Request("http://x/api/mcp", { headers: auth ? { authorization: auth } : {} });

test("bearer token check", () => {
  assert.equal(checkBearer(req("Bearer secret"), "secret"), "ok");
  assert.equal(checkBearer(req("Bearer wrong"), "secret"), "unauthorized");
  assert.equal(checkBearer(req(), "secret"), "unauthorized");
  assert.equal(checkBearer(req("Bearer secret"), undefined), "missing-config");
});

test("rate limiter resets after window", () => {
  const take = createRateLimiter(2, 1000);
  assert.equal(take("k", 0).allowed, true);
  assert.equal(take("k", 10).allowed, true);
  const third = take("k", 20);
  assert.equal(third.allowed, false);
  assert.equal(third.retryAfterSec, 1);
  assert.equal(take("k", 1001).allowed, true);
});

test("resolveFields is case-insensitive and reports unknowns", () => {
  assert.deepEqual(resolveFields(["zoning", "Nope"], ["OBJECTID", "ZONING"]), {
    resolved: ["ZONING"],
    unknown: ["Nope"],
  });
});
