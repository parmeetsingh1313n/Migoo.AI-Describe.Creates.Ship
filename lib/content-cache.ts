/**
 * @deprecated REMOVED — do not use.
 *
 * This file previously stored LLM-generated slide content (HTML, narration, revealData)
 * as JSON blobs in Appwrite Storage. This was the wrong approach because:
 *
 *   1. Appwrite has a 50 MB per-file limit (plans differ).
 *   2. Text content belongs in the database, not object storage.
 *   3. The registry was in-memory, so it never survived across Inngest retries.
 *
 * All slide text content (HTML, narration, revealData, captions) now goes directly
 * into the `chapter_content_slides` Drizzle/Postgres table.
 *
 * Only binary assets (audio .mp3, images, thumbnails) are stored in Appwrite.
 *
 * See: inngest/course-functions.ts → generateCourseVideoContentFn
 */

export {}; // keep file as valid TS module
