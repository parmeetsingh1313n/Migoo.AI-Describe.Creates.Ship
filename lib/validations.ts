/**
 * @module validations
 * @description Zod validation schemas for all API request/response bodies.
 *
 * Provides type-safe input validation to prevent injection attacks,
 * malformed data, and runtime errors. Used across all API route handlers.
 *
 * @example
 * ```ts
 * import { generateCourseLayoutSchema } from '@/lib/validations';
 *
 * const result = generateCourseLayoutSchema.safeParse(body);
 * if (!result.success) {
 *   return apiError('Invalid input', 400, 'VALIDATION_ERROR', result.error.flatten());
 * }
 * const { userInput, courseId, type } = result.data;
 * ```
 */

import { z } from "zod";

// ═══════════════════════════════════════════════════════════════════════════════
// Shared / Reusable Schemas
// ═══════════════════════════════════════════════════════════════════════════════

/** Validates a non-empty string with max length, trimmed and XSS-safe */
const safeString = (maxLength: number = 255) =>
  z
    .string()
    .trim()
    .min(1, "Field cannot be empty")
    .max(maxLength, `Field must be at most ${maxLength} characters`)
    .refine((val) => !/<script/i.test(val), "Invalid characters detected");

/** UUID-like / alphanumeric ID field */
const idField = z
  .string()
  .trim()
  .min(1, "ID is required")
  .max(255, "ID too long")
  .regex(/^[a-zA-Z0-9_-]+$/, "ID contains invalid characters");

/** Email validation */
const emailField = z.string().email("Invalid email address").max(255);

// ═══════════════════════════════════════════════════════════════════════════════
// API Endpoint Schemas
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Schema for POST /api/generate-course-layout
 * Validates course generation request parameters.
 */
export const generateCourseLayoutSchema = z.object({
  userInput: safeString(2000),
  courseId: idField,
  type: z.enum(["video", "article", "tutorial", "course"], {
    errorMap: () => ({ message: "Type must be one of: video, article, tutorial, course" }),
  }),
});

/** TypeScript type inferred from generateCourseLayoutSchema */
export type GenerateCourseLayoutInput = z.infer<typeof generateCourseLayoutSchema>;

/**
 * Schema for POST /api/generate-video-content
 * Validates video content generation request.
 */
export const generateVideoContentSchema = z.object({
  chapter: z.object({
    chapterId: safeString(255),
    chapterTitle: safeString(500),
    subContent: z.array(z.string()).optional(),
  }).passthrough(), // Allow additional chapter fields
  courseId: idField,
  courseName: safeString(500),
  chapterIndex: z.number().int().min(0).max(100),
});

/** TypeScript type inferred from generateVideoContentSchema */
export type GenerateVideoContentInput = z.infer<typeof generateVideoContentSchema>;

/**
 * Schema for GET /api/course query parameters
 * Validates course retrieval request.
 */
export const getCourseQuerySchema = z.object({
  courseId: idField.optional(),
});

/** TypeScript type inferred from getCourseQuerySchema */
export type GetCourseQuery = z.infer<typeof getCourseQuerySchema>;

/**
 * Schema for POST /api/user
 * Validates user upsert request (data comes from Clerk, but we validate anyway).
 */
export const userUpsertSchema = z.object({
  email: emailField,
  name: safeString(255),
});

/** TypeScript type inferred from userUpsertSchema */
export type UserUpsertInput = z.infer<typeof userUpsertSchema>;

/**
 * Schema for POST /api/create-short-series
 * Validates short video series creation.
 */
export const createShortSeriesSchema = z.object({
  niche: safeString(500),
  language: z.string().min(2).max(20),
  voice: safeString(100),
  music: safeString(100),
  videoStyle: safeString(100),
  captionStyle: safeString(100),
  title: safeString(500),
  duration: z.string().regex(/^\d+-\d+$/, "Duration format must be like '30-50'"),
  platform: z.enum(["youtube", "instagram", "email"]),
  publishTime: z.string().datetime(),
});

/** TypeScript type inferred from createShortSeriesSchema */
export type CreateShortSeriesInput = z.infer<typeof createShortSeriesSchema>;

// ═══════════════════════════════════════════════════════════════════════════════
// Validation Helper
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Validate data against a Zod schema with user-friendly error formatting.
 *
 * @param schema - Zod schema to validate against
 * @param data - Data to validate
 * @returns  Object with `success`, validated `data`, and `errors` array
 */
export function validateInput<T extends z.ZodSchema>(
  schema: T,
  data: unknown
): { success: true; data: z.infer<T> } | { success: false; errors: z.ZodIssue[] } {
  const result = schema.safeParse(data);
  if (result.success) {
    return { success: true, data: result.data };
  }
  return { success: false, errors: result.error.issues };
}
