import { describe, expect, it } from "vitest";
import { createRateLimiter } from "./rateLimit";

describe("createRateLimiter", () => {
  it("lets the limit through, refuses the next, and says how long to wait", () => {
    let now = 0;
    const limiter = createRateLimiter({ limit: 2, windowMs: 60_000, now: () => now });
    expect(limiter.take("u1")).toEqual({ ok: true });
    now = 10_000;
    expect(limiter.take("u1")).toEqual({ ok: true });
    now = 20_000;
    expect(limiter.take("u1")).toEqual({ ok: false, retryAfterSec: 40 });
  });

  it("frees a slot once the oldest request leaves the window", () => {
    let now = 0;
    const limiter = createRateLimiter({ limit: 1, windowMs: 60_000, now: () => now });
    limiter.take("u1");
    now = 60_001;
    expect(limiter.take("u1")).toEqual({ ok: true });
  });

  it("counts each person separately", () => {
    const limiter = createRateLimiter({ limit: 1, windowMs: 60_000, now: () => 0 });
    expect(limiter.take("u1").ok).toBe(true);
    expect(limiter.take("u2").ok).toBe(true);
    expect(limiter.take("u1").ok).toBe(false);
  });
});
