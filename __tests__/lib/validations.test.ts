import { describe, it, expect } from 'vitest';
import {
  generateCourseLayoutSchema,
  generateVideoContentSchema,
  getCourseQuerySchema,
  createShortSeriesSchema,
  validateInput,
} from '../../lib/validations';

// ═══════════════════════════════════════════════════════════════════════════════
// generateCourseLayoutSchema
// ═══════════════════════════════════════════════════════════════════════════════

describe('generateCourseLayoutSchema', () => {
  it('should accept valid input', () => {
    const input = {
      userInput: 'Learn React fundamentals',
      courseId: 'course-abc-123',
      type: 'video',
    };
    const result = generateCourseLayoutSchema.safeParse(input);
    expect(result.success).toBe(true);
  });

  it('should reject empty userInput', () => {
    const input = { userInput: '', courseId: 'course-123', type: 'video' };
    const result = generateCourseLayoutSchema.safeParse(input);
    expect(result.success).toBe(false);
  });

  it('should reject missing courseId', () => {
    const input = { userInput: 'Learn React', type: 'video' };
    const result = generateCourseLayoutSchema.safeParse(input);
    expect(result.success).toBe(false);
  });

  it('should reject invalid type', () => {
    const input = { userInput: 'Learn React', courseId: 'c-1', type: 'podcast' };
    const result = generateCourseLayoutSchema.safeParse(input);
    expect(result.success).toBe(false);
  });

  it('should reject courseId with special characters', () => {
    const input = { userInput: 'Learn React', courseId: 'course<script>', type: 'video' };
    const result = generateCourseLayoutSchema.safeParse(input);
    expect(result.success).toBe(false);
  });

  it('should reject XSS in userInput', () => {
    const input = { userInput: '<script>alert("xss")</script>', courseId: 'c-1', type: 'video' };
    const result = generateCourseLayoutSchema.safeParse(input);
    expect(result.success).toBe(false);
  });

  it('should trim whitespace from userInput', () => {
    const input = { userInput: '  Learn React  ', courseId: 'c-1', type: 'video' };
    const result = generateCourseLayoutSchema.safeParse(input);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.userInput).toBe('Learn React');
    }
  });

  it('should accept all valid types', () => {
    const types = ['video', 'article', 'tutorial', 'course'];
    for (const type of types) {
      const input = { userInput: 'Learn React', courseId: 'c-1', type };
      const result = generateCourseLayoutSchema.safeParse(input);
      expect(result.success).toBe(true);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// generateVideoContentSchema
// ═══════════════════════════════════════════════════════════════════════════════

describe('generateVideoContentSchema', () => {
  const validInput = {
    chapter: {
      chapterId: 'ch-001',
      chapterTitle: 'Introduction to React',
      subContent: ['JSX', 'Components'],
    },
    courseId: 'course-123',
    courseName: 'React Masterclass',
    chapterIndex: 0,
  };

  it('should accept valid input', () => {
    const result = generateVideoContentSchema.safeParse(validInput);
    expect(result.success).toBe(true);
  });

  it('should reject negative chapterIndex', () => {
    const result = generateVideoContentSchema.safeParse({ ...validInput, chapterIndex: -1 });
    expect(result.success).toBe(false);
  });

  it('should reject chapterIndex over 100', () => {
    const result = generateVideoContentSchema.safeParse({ ...validInput, chapterIndex: 101 });
    expect(result.success).toBe(false);
  });

  it('should reject missing chapter', () => {
    const { chapter, ...rest } = validInput;
    const result = generateVideoContentSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });

  it('should reject missing chapterId in chapter', () => {
    const input = { ...validInput, chapter: { chapterTitle: 'Test' } };
    const result = generateVideoContentSchema.safeParse(input);
    expect(result.success).toBe(false);
  });

  it('should allow additional fields in chapter (passthrough)', () => {
    const input = {
      ...validInput,
      chapter: { ...validInput.chapter, extraField: 'allowed' },
    };
    const result = generateVideoContentSchema.safeParse(input);
    expect(result.success).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// getCourseQuerySchema
// ═══════════════════════════════════════════════════════════════════════════════

describe('getCourseQuerySchema', () => {
  it('should accept valid courseId', () => {
    const result = getCourseQuerySchema.safeParse({ courseId: 'course-123' });
    expect(result.success).toBe(true);
  });

  it('should accept missing courseId (optional)', () => {
    const result = getCourseQuerySchema.safeParse({});
    expect(result.success).toBe(true);
  });

  it('should reject courseId with special characters', () => {
    const result = getCourseQuerySchema.safeParse({ courseId: 'course<hack>' });
    expect(result.success).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// createShortSeriesSchema
// ═══════════════════════════════════════════════════════════════════════════════

describe('createShortSeriesSchema', () => {
  const validInput = {
    niche: 'Technology',
    language: 'en-IN',
    voice: 'kabir',
    music: 'epic',
    videoStyle: 'cinematic',
    captionStyle: 'bold',
    title: 'Amazing Tech Facts',
    duration: '30-50',
    platform: 'youtube' as const,
    publishTime: '2026-03-20T10:00:00Z',
  };

  it('should accept valid input', () => {
    const result = createShortSeriesSchema.safeParse(validInput);
    expect(result.success).toBe(true);
  });

  it('should reject invalid duration format', () => {
    const result = createShortSeriesSchema.safeParse({ ...validInput, duration: 'short' });
    expect(result.success).toBe(false);
  });

  it('should reject invalid platform', () => {
    const result = createShortSeriesSchema.safeParse({ ...validInput, platform: 'tiktok' });
    expect(result.success).toBe(false);
  });

  it('should reject invalid publishTime (not ISO datetime)', () => {
    const result = createShortSeriesSchema.safeParse({ ...validInput, publishTime: 'tomorrow' });
    expect(result.success).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// validateInput helper
// ═══════════════════════════════════════════════════════════════════════════════

describe('validateInput', () => {
  it('should return success with parsed data for valid input', () => {
    const result = validateInput(generateCourseLayoutSchema, {
      userInput: 'Learn Python',
      courseId: 'py-101',
      type: 'course',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.courseId).toBe('py-101');
    }
  });

  it('should return errors array for invalid input', () => {
    const result = validateInput(generateCourseLayoutSchema, {});
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errors.length).toBeGreaterThan(0);
    }
  });
});
