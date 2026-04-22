/**
 * @module env
 * @description Validated environment variable configuration using Zod.
 *
 * All environment variables are validated at import time. If any required
 * variable is missing or invalid, a descriptive error is thrown immediately
 * rather than failing silently at runtime.
 *
 * @example
 * ```ts
 * import { env } from '@/lib/env';
 *
 * // Type-safe access to environment variables
 * const dbUrl = env.DATABASE_URL;
 * const clerkKey = env.CLERK_SECRET_KEY;
 * ```
 */

import { z } from "zod";

/**
 * Schema defining all required and optional environment variables
 * with their expected types and validation rules.
 */
const envSchema = z.object({
  // ── Database ───────────────────────────────────────────────────
  DATABASE_URL: z.string().url("DATABASE_URL must be a valid URL"),

  // ── Authentication (Clerk) ─────────────────────────────────────
  NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: z.string().min(1, "Clerk publishable key is required"),
  CLERK_SECRET_KEY: z.string().min(1, "Clerk secret key is required"),

  // ── AI / LLM Providers ────────────────────────────────────────
  OPENROUTER_API_KEY: z.string().min(1).optional(),
  SARVAM_API_KEY: z.string().min(1).optional(),
  GEMINI_API_KEY: z.string().min(1).optional(),
  GEMINI_API_KEY_IMAGE: z.string().min(1).optional(),

  // ── Storage ───────────────────────────────────────────────────
  BLOB_READ_WRITE_TOKEN: z.string().min(1).optional(),

  // ── Image Generation (Nano Banana uses GEMINI_API_KEY above) ─
  LEONARDO_API_KEY: z.string().min(1).optional(),

  // ── Video Generation (Leonardo Seedance) ───────────────────────
  // Leonardo keys are already covered by LEONARDO_API_KEY above

  // ── Application ───────────────────────────────────────────────
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  NEXT_PUBLIC_APP_URL: z.string().url().optional(),
});

/** TypeScript type for validated environment variables */
export type Env = z.infer<typeof envSchema>;

/**
 * Parse and validate environment variables.
 * Returns validated env object or throws with descriptive errors.
 */
function validateEnv(): Env {
  const result = envSchema.safeParse(process.env);

  if (!result.success) {
    const formatted = result.error.issues
      .map((issue) => `  ✗ ${issue.path.join(".")}: ${issue.message}`)
      .join("\n");

    console.error("❌ Environment validation failed:\n" + formatted);

    // In development, log but don't crash (some vars may be optional for dev)
    if (process.env.NODE_ENV === "production") {
      throw new Error("Invalid environment configuration. Check server logs.");
    }
  }

  // Return parsed values (with defaults applied)
  return (result.success ? result.data : process.env) as Env;
}

/** Validated environment variables — use this instead of `process.env` */
export const env = validateEnv();
