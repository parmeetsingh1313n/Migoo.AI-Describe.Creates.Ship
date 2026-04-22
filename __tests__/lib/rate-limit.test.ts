import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock next/server since it's not available outside Next.js runtime
vi.mock('next/server', () => ({
  NextRequest: class MockNextRequest {
    nextUrl = { pathname: '/', searchParams: new URLSearchParams() };
    headers = new Map();
    method = 'GET';
  },
}));

import { rateLimit, resetRateLimitStore } from '../../lib/rate-limit';

describe('rateLimit', () => {
  beforeEach(() => {
    resetRateLimitStore();
  });

  it('should allow requests within the limit', () => {
    const result = rateLimit('test-ip', { maxRequests: 5, windowMs: 60000 });
    expect(result.success).toBe(true);
    expect(result.remaining).toBe(4);
  });

  it('should track remaining requests accurately', () => {
    const options = { maxRequests: 3, windowMs: 60000 };
    const r1 = rateLimit('ip-1', options);
    const r2 = rateLimit('ip-1', options);
    const r3 = rateLimit('ip-1', options);

    expect(r1.remaining).toBe(2);
    expect(r2.remaining).toBe(1);
    expect(r3.remaining).toBe(0);
  });

  it('should block requests exceeding the limit', () => {
    const options = { maxRequests: 2, windowMs: 60000 };
    rateLimit('ip-2', options);
    rateLimit('ip-2', options);
    const blocked = rateLimit('ip-2', options);

    expect(blocked.success).toBe(false);
    expect(blocked.remaining).toBe(0);
  });

  it('should track different IPs independently', () => {
    const options = { maxRequests: 1, windowMs: 60000 };
    const r1 = rateLimit('ip-a', options);
    const r2 = rateLimit('ip-b', options);

    expect(r1.success).toBe(true);
    expect(r2.success).toBe(true);
  });

  it('should reset after the window expires', async () => {
    const options = { maxRequests: 1, windowMs: 50 }; // 50ms window
    rateLimit('ip-expire', options);
    const blocked = rateLimit('ip-expire', options);
    expect(blocked.success).toBe(false);

    // Wait for window to expire
    await new Promise((r) => setTimeout(r, 60));

    const allowed = rateLimit('ip-expire', options);
    expect(allowed.success).toBe(true);
  });

  it('should return a valid reset timestamp', () => {
    const before = Date.now();
    const result = rateLimit('ip-time', { maxRequests: 10, windowMs: 60000 });
    expect(result.reset).toBeGreaterThanOrEqual(before + 60000);
  });

  it('should use default options when none provided', () => {
    const result = rateLimit('ip-default');
    expect(result.success).toBe(true);
    expect(result.remaining).toBe(29); // default maxRequests = 30
  });
});
