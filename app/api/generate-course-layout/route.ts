/**
 * @module api/generate-course-layout
 * @description API route for generating AI-powered course layouts.
 *
 * POST /api/generate-course-layout
 * Takes user input and generates a comprehensive course structure
 * using OpenRouter AI, then saves it to the database.
 *
 * @requires Authentication via Clerk
 * @requires OpenRouter API key
 */

import { db } from "@/config/db";
import { openrouter } from "@/config/openrouter";
import { coursesTable } from "@/config/schema";
import { COURSE_CONFIG_PROMPT } from "@/data/Prompt";
import { apiError, apiSuccess, apiOptions } from "@/lib/api-helpers";
import { validateInput, generateCourseLayoutSchema } from "@/lib/validations";
import { currentUser } from "@clerk/nextjs/server";
import { NextRequest } from "next/server";

export async function POST(req: NextRequest) {
    const user = await currentUser();

    console.log('\n' + '═'.repeat(80));
    console.log('🚀 Course Layout Generation API Called');
    console.log('═'.repeat(80));
    console.log('📅 Timestamp:', new Date().toISOString());

    try {
        // Auth guard
        if (!user?.primaryEmailAddress?.emailAddress) {
            return apiError('Authentication required', 401, 'UNAUTHORIZED');
        }

        // Parse and validate request body with Zod
        const body = await req.json();
        const validation = validateInput(generateCourseLayoutSchema, body);

        if (!validation.success) {
            console.error('❌ Validation Error:', validation.errors);
            return apiError('Invalid request input', 400, 'VALIDATION_ERROR', validation.errors);
        }

        const { userInput, courseId, type } = validation.data;

        console.log('📥 Request Body:', {
            userInputLength: userInput.length,
            courseId,
            type,
        });

        // ═══════════════════════════════════════════════════════════════════
        // Test API connection
        // ═══════════════════════════════════════════════════════════════════
        console.log('🔗 Testing OpenRouter API connection...');
        try {
            await openrouter.test();
            console.log('✅ OpenRouter API connection successful');
        } catch (error: any) {
            console.error('❌ OpenRouter API Connection Test Failed:', error.message);
            return apiError(
                'OpenRouter API connection failed',
                500,
                'API_CONNECTION_ERROR',
                error.message
            );
        }

        // ═══════════════════════════════════════════════════════════════════
        // Generate comprehensive course layout
        // ═══════════════════════════════════════════════════════════════════
        console.log('🤖 Generating comprehensive course layout with OpenRouter AI...');
        console.log('Model: z-ai/glm-4.5-air:free');
        console.log('Temperature: 0.7 (balanced creativity)');
        console.log('Max Tokens: 8000 (increased for detailed courses)');

        const result = await openrouter.json(
            COURSE_CONFIG_PROMPT,
            userInput,
            {
                model: 'z-ai/glm-4.5-air:free',
                temperature: 0.7,
                maxTokens: 8000,
            }
        );

        console.log('✅ OpenRouter API Response Received');
        console.log('📊 Course Layout Statistics:', {
            courseName: result.courseName,
            courseId: result.courseId,
            level: result.level,
            totalChapters: result.totalChapters,
            chaptersGenerated: result.chapters?.length,
            firstChapterTitle: result.chapters?.[0]?.chapterTitle,
            firstChapterSubContentCount: result.chapters?.[0]?.subContent?.length
        });

        // Validate course structure
        if (!result.chapters || result.chapters.length === 0) {
            throw new Error('AI generated course with no chapters');
        }

        if (result.chapters.length < 5) {
            console.warn(`⚠️ WARNING: Course only has ${result.chapters.length} chapters. Expected 8-15 for comprehensive course.`);
        }

        // Validate each chapter has sufficient subcontent
        const insufficientChapters = result.chapters.filter((ch: any) =>
            !ch.subContent || ch.subContent.length < 5
        );

        if (insufficientChapters.length > 0) {
            console.warn(`⚠️ WARNING: ${insufficientChapters.length} chapters have fewer than 5 subContent items`);
            insufficientChapters.forEach((ch: any) => {
                console.warn(`  - ${ch.chapterTitle}: ${ch.subContent?.length || 0} items`);
            });
        }

        // Log detailed chapter breakdown
        console.log('\n📚 Generated Course Structure:');
        console.log('═'.repeat(80));
        result.chapters.forEach((chapter: any, index: number) => {
            console.log(`Chapter ${index + 1}: ${chapter.chapterTitle}`);
            console.log(`  - ID: ${chapter.chapterId}`);
            console.log(`  - SubContent Items: ${chapter.subContent?.length}`);
            chapter.subContent?.forEach((item: string, idx: number) => {
                console.log(`    ${idx + 1}. ${item.substring(0, 60)}${item.length > 60 ? '...' : ''}`);
            });
            console.log('─'.repeat(80));
        });
        console.log('═'.repeat(80) + '\n');

        // ═══════════════════════════════════════════════════════════════════
        // Save to database
        // ═══════════════════════════════════════════════════════════════════
        console.log('💾 Saving course layout to database...');

        const courseResult = await db.insert(coursesTable).values({
            courseId: courseId,
            courseName: result.courseName,
            userInput: userInput,
            type: type,
            courseLayout: result,
            userId: user?.primaryEmailAddress?.emailAddress
        }).returning();

        console.log('✅ Course saved to database successfully');
        console.log('Database ID:', courseResult[0].id);

        // Fire thumbnail generation in background (non-blocking)
        console.log('🖼️  Triggering thumbnail generation in background...');
        const baseUrl = req.nextUrl.origin;
        fetch(`${baseUrl}/api/generate-thumbnail`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ courseId, courseName: result.courseName })
        }).then(() => {
            console.log('✅ Thumbnail generation request sent successfully');
        }).catch(err => {
            console.error('⚠️ Thumbnail generation request failed:', err.message);
        });

        // ═══════════════════════════════════════════════════════════════════
        // Return success response
        // ═══════════════════════════════════════════════════════════════════
        console.log('\n' + '═'.repeat(80));
        console.log('🎉 Course Layout Generation Complete!');
        console.log('═'.repeat(80));
        console.log(`Course: ${result.courseName}`);
        console.log(`Chapters: ${result.totalChapters}`);
        console.log(`Level: ${result.level}`);
        console.log(`Course ID: ${courseId}`);
        console.log('═'.repeat(80) + '\n');

        return apiSuccess({
            course: courseResult[0],
            metadata: {
                generatedAt: new Date().toISOString(),
                model: 'z-ai/glm-4.5-air:free',
                courseId,
                type,
                courseName: result.courseName,
                totalChapters: result.totalChapters,
                chaptersGenerated: result.chapters.length,
                avgSubContentPerChapter: (
                    result.chapters.reduce((sum: number, ch: any) => sum + (ch.subContent?.length || 0), 0) /
                    result.chapters.length
                ).toFixed(1)
            }
        });

    } catch (error: any) {
        console.error('\n' + '═'.repeat(80));
        console.error('🔥 Course Layout Generation Failed');
        console.error('═'.repeat(80));
        console.error('Error Message:', error.message);
        console.error('Error Name:', error.name);
        if (error.stack) {
            console.error('Stack Trace:');
            console.error(error.stack);
        }
        console.error('═'.repeat(80) + '\n');

        return apiError(
            'Failed to generate course layout',
            500,
            'GENERATION_ERROR',
            error.message
        );
    }
}

/** Handle CORS preflight requests */
export async function OPTIONS() {
    return apiOptions();
}