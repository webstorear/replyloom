import { describe, expect, it } from "vitest";
import { consumeLocalRateLimit } from "./local-rate-limit";

describe("local rate limiter fallback", () => {
  it("limits requests within a window", () => {
    const key = `web-test-${crypto.randomUUID()}`;
    expect(consumeLocalRateLimit(key, 2, 60_000, 1_000)).toBe(true);
    expect(consumeLocalRateLimit(key, 2, 60_000, 1_001)).toBe(true);
    expect(consumeLocalRateLimit(key, 2, 60_000, 1_002)).toBe(false);
  });

  it("resets the counter when the window expires", () => {
    const key = `web-test-${crypto.randomUUID()}`;
    expect(consumeLocalRateLimit(key, 1, 100, 1_000)).toBe(true);
    expect(consumeLocalRateLimit(key, 1, 100, 1_099)).toBe(false);
    expect(consumeLocalRateLimit(key, 1, 100, 1_100)).toBe(true);
  });
});
