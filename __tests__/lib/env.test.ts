import { describe, it, expect } from 'vitest';
import { z } from 'zod';

describe('Environment Variable Schema Validation', () => {
  // Test the schema patterns used in lib/env.ts without importing
  // the module (which would trigger actual env validation)

  const envSchema = z.object({
    DATABASE_URL: z.string().url('DATABASE_URL must be a valid URL'),
    NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: z.string().min(1),
    CLERK_SECRET_KEY: z.string().min(1),
    OPENROUTER_API_KEY: z.string().min(1).optional(),
    SARVAM_API_KEY: z.string().min(1).optional(),
    NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  });

  it('should accept valid environment variables', () => {
    const result = envSchema.safeParse({
      DATABASE_URL: 'postgresql://user:pass@host:5432/db',
      NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: 'pk_test_abc123',
      CLERK_SECRET_KEY: 'sk_test_abc123',
      NODE_ENV: 'production',
    });
    expect(result.success).toBe(true);
  });

  it('should reject invalid DATABASE_URL', () => {
    const result = envSchema.safeParse({
      DATABASE_URL: 'not-a-url',
      NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: 'pk_test_abc',
      CLERK_SECRET_KEY: 'sk_test_abc',
    });
    expect(result.success).toBe(false);
  });

  it('should reject missing CLERK_SECRET_KEY', () => {
    const result = envSchema.safeParse({
      DATABASE_URL: 'postgresql://user:pass@host/db',
      NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: 'pk_test_abc',
    });
    expect(result.success).toBe(false);
  });

  it('should allow optional API keys to be missing', () => {
    const result = envSchema.safeParse({
      DATABASE_URL: 'postgresql://user:pass@host:5432/db',
      NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: 'pk_test_abc123',
      CLERK_SECRET_KEY: 'sk_test_abc123',
      // OPENROUTER_API_KEY, SARVAM_API_KEY left undefined
    });
    expect(result.success).toBe(true);
  });

  it('should default NODE_ENV to development', () => {
    const result = envSchema.safeParse({
      DATABASE_URL: 'postgresql://user:pass@host:5432/db',
      NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: 'pk_test_abc',
      CLERK_SECRET_KEY: 'sk_test_abc',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.NODE_ENV).toBe('development');
    }
  });

  it('should reject invalid NODE_ENV value', () => {
    const result = envSchema.safeParse({
      DATABASE_URL: 'postgresql://user:pass@host:5432/db',
      NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: 'pk_test_abc',
      CLERK_SECRET_KEY: 'sk_test_abc',
      NODE_ENV: 'staging',
    });
    expect(result.success).toBe(false);
  });
});
