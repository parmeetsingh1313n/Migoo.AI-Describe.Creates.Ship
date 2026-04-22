/**
 * Image utilities for Krea AI generated images
 */

import { db } from "@/config/db";
import { courseImages } from "@/config/schema";
import { eq } from "drizzle-orm";

/**
 * Fetch pre-generated Krea AI image URLs for a course
 */
export async function getCourseImageUrls(courseId: string): Promise<string[]> {
  const images = await db
    .select()
    .from(courseImages)
    .where(eq(courseImages.courseId, courseId));

  // Sort by imageIndex and return URLs
  return images
    .sort((a, b) => a.imageIndex - b.imageIndex)
    .map(img => img.imageUrl);
}

/**
 * Get a specific image URL for a slide, cycling through available images
 */
export function getImageForSlide(imageUrls: string[], slideIndex: number): string | null {
  if (imageUrls.length === 0) return null;
  return imageUrls[slideIndex % imageUrls.length];
}

/**
 * Generate a gradient SVG fallback if no AI images are available
 */
export function getGradientDataUri(colors: string[]): string {
  const svg = `
    <svg width="1200" height="400" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="grad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" style="stop-color:${colors[0]};stop-opacity:1" />
          <stop offset="100%" style="stop-color:${colors[1]};stop-opacity:1" />
        </linearGradient>
      </defs>
      <rect width="1200" height="400" fill="url(#grad)" />
    </svg>
  `;

  const base64 = Buffer.from(svg).toString('base64');
  return `data:image/svg+xml;base64,${base64}`;
}