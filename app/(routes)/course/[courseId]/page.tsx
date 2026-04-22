"use client"
import { Course } from '@/type/CourseType';
import axios from 'axios';
import { useParams } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import CourseChapters from './_components/CourseChapters';
import CourseInfoCard from './_components/CourseInfoCard';

function CoursePage() {
    const { courseId } = useParams();
    const [courseDetails, setCourseDetails] = useState<Course>();
    const isGenerating = useRef(false);
    const hasGenerated = useRef(false);  // Prevent re-triggering after generation loop completes

    useEffect(() => {
        GetCourseDetails();
    }, [courseId])

    const GetCourseDetails = async () => {
        const loadingToast = toast.loading("Fetching Course Details...");
        try {
            const res = await axios.get(`/api/course?courseId=${courseId}`);

            // apiSuccess wraps response as { success, data: { ...course, chapterContentSlides }, timestamp }
            const courseData = res.data?.data ?? res.data;

            setCourseDetails(courseData);
            toast.success("Course Details Fetched Successfully!", {
                id: loadingToast
            });

            // Check which chapters already have slides in the DB
            const existingSlides = courseData?.chapterContentSlides || [];
            const existingChapterIds = new Set(
                existingSlides.map((slide: any) => slide.chapterId)
            );
            const allChapters = courseData?.courseLayout?.chapters || [];
            const missingChapters = allChapters.filter(
                (ch: any) => !existingChapterIds.has(ch.chapterId)
            );

            if (missingChapters.length > 0) {
                if (!isGenerating.current && !hasGenerated.current) {
                    console.log(`✅ ${missingChapters.length} chapter(s) missing slides, generating content...`);
                    console.log("Missing chapters:", missingChapters.map((ch: any) => ch.chapterTitle));
                    GenerateVideoContent(courseData);
                } else if (hasGenerated.current) {
                    console.log("✅ Generation already completed (some chapters may be skipped in testing mode)");
                } else {
                    console.log("⚠️ Generation already in progress, skipping...");
                }
            } else {
                console.log("✅ All chapters already have slides in database!");
                console.log("Number of existing slides:", existingSlides.length);
                console.log("Chapters with slides:", [...existingChapterIds]);
            }

            // ═══════════════════════════════════════════════════════════════════
            // AUTO THUMBNAIL GENERATION (New or Migrate S3)
            // ═══════════════════════════════════════════════════════════════════
            const hasThumbnail = !!courseData?.courseThumbnail;
            const isExternal = hasThumbnail && courseData.courseThumbnail.startsWith('http');

            if ((!hasThumbnail || isExternal) && courseData?.courseId && courseData?.courseName) {
                axios.post('/api/generate-thumbnail', {
                    courseId: courseData.courseId,
                    courseName: courseData.courseName
                }).then(thumbRes => {
                    // Refresh details to get the new thumbnail URL
                    if (thumbRes.data?.success) {
                        GetCourseDetails();
                    }
                }).catch(err => {
                    console.error("❌ Auto-thumbnail generation failed:", err);
                });
            }
        } catch (error) {
            console.error("❌ Error fetching course:", error);
            toast.error("Failed to fetch course details", {
                id: loadingToast
            });
        }
    }

    const GenerateVideoContent = async (course: Course) => {
        console.log("\n" + "═".repeat(80));
        console.log("🎬 Starting Video Content Generation");
        console.log("═".repeat(80));
        console.log("Course ID:", course.courseId);
        console.log("Course Name:", course.courseName);
        console.log("Total Chapters:", course.courseLayout.chapters.length);
        console.log("═".repeat(80) + "\n");

        isGenerating.current = true;

        if (!course?.courseLayout?.chapters || course.courseLayout.chapters.length === 0) {
            console.log("⚠️ No chapters found to generate content for");
            toast.error("No chapters found in course layout");
            return;
        }

        // ═══════════════════════════════════════════════════════════════════
        // Step 1: Generate DeAPI Images (before video content)
        // ═══════════════════════════════════════════════════════════════════
        console.log("\n🖼️  Step 1: Generating DeAPI images for all chapters...");
        const imageToast = toast.loading("Generating AI images for course slides...", { duration: Infinity });

        try {
            const imageRes = await axios.post(`/api/generate-images`, {
                courseName: course.courseName,
                courseId: course.courseId,
                chapters: course.courseLayout.chapters
            });

            if (imageRes.data.skipped) {
                console.log("✅ Images already exist, skipping generation");
                toast.info("Images already generated for this course", {
                    id: imageToast,
                    duration: 3000
                });
            } else {
                console.log(`✅ Generated ${imageRes.data.data?.length} images`);
                toast.success(
                    `✅ Generated ${imageRes.data.data?.length} AI images for course slides!`,
                    { id: imageToast, duration: 4000 }
                );
            }
        } catch (imageError: any) {
            console.error("❌ Image generation failed:", imageError.message);
            toast.error(
                `Image generation failed: ${imageError.response?.data?.error || imageError.message}. Continuing with video content...`,
                { id: imageToast, duration: 6000 }
            );
            // Don't return — continue with video content even if images fail
        }

        // ═══════════════════════════════════════════════════════════════════
        // Step 2: Generate Video Content for each chapter
        // ═══════════════════════════════════════════════════════════════════
        console.log("\n🎬 Step 2: Generating video content for each chapter...");

        let successCount = 0;
        let skippedCount = 0;
        let errorCount = 0;

        for (let i = 0; i < course.courseLayout.chapters.length; i++) {
            const chapter = course.courseLayout.chapters[i];

            console.log(`\n${'='.repeat(80)}`);
            console.log(`📝 Processing Chapter ${i + 1}/${course.courseLayout.chapters.length}`);
            console.log(`${'='.repeat(80)}`);
            console.log(`Chapter ID: ${chapter.chapterId}`);
            console.log(`Chapter Title: ${chapter.chapterTitle}`);
            console.log(`Sub-content items: ${chapter.subContent?.length}`);
            console.log(`${'='.repeat(80)}`);

            const loadingToast = toast.loading(
                `Generating Video Content for Chapter ${i + 1}/${course.courseLayout.chapters.length}: ${chapter.chapterTitle}`,
                { duration: Infinity }
            );

            try {
                console.log(`📤 Sending request for Chapter ${chapter.chapterId} (index ${i})...`);

                const res = await axios.post(`/api/generate-video-content`, {
                    chapter: chapter,
                    courseId: course.courseId,
                    courseName: course.courseName,
                    chapterIndex: i  // ⚠️ CRITICAL: Pass chapter index for testing mode
                });

                console.log(`✅ Chapter ${i + 1} Response:`, res.data);

                if (res.data.skipped) {
                    skippedCount++;
                    console.log(`⏭️ Chapter ${i + 1} was skipped:`, res.data.reason || res.data.message);
                    toast.info(`Chapter ${i + 1} skipped: ${res.data.message}`, {
                        id: loadingToast,
                        duration: 3000
                    });
                } else {
                    successCount++;
                    console.log(`🔊 Audio URLs for Chapter ${i + 1}:`,
                        res.data.data?.map((slide: any) => slide.audioUrl)
                    );

                    toast.success(
                        `✅ Video Content for Chapter ${i + 1} Generated Successfully! (${res.data.data?.length} slides)`,
                        { id: loadingToast, duration: 4000 }
                    );

                    // Refresh UI immediately after each chapter
                    await GetCourseDetails();
                }

            } catch (error: any) {
                errorCount++;
                console.error(`❌ Error generating content for Chapter ${i + 1}:`, error);
                console.error('Error details:', error.response?.data || error.message);

                toast.error(
                    `Failed to generate content for Chapter ${i + 1}: ${error.response?.data?.error || error.message}`,
                    { id: loadingToast, duration: 6000 }
                );
            }
        }

        // Generation complete
        console.log("\n" + "═".repeat(80));
        console.log("🎉 Video Content Generation Complete!");
        console.log("═".repeat(80));
        console.log(`✅ Successful: ${successCount} chapters`);
        console.log(`⏭️ Skipped: ${skippedCount} chapters`);
        console.log(`❌ Errors: ${errorCount} chapters`);
        console.log("═".repeat(80) + "\n");

        isGenerating.current = false;
        hasGenerated.current = true;  // Prevent GetCourseDetails from re-triggering

        // Show final summary
        if (successCount > 0 || skippedCount > 0) {
            toast.success(
                `Generation Complete! Success: ${successCount}, Skipped: ${skippedCount}, Errors: ${errorCount}`,
                { duration: 6000 }
            );
        }

        // Refresh course data to show the newly generated slides
        if (successCount > 0) {
            console.log("🔄 Refreshing course data to load generated slides...");
            await GetCourseDetails();
        }
    }

    return (
        <div className='flex flex-col items-center'>
            <CourseInfoCard course={courseDetails} />
            <CourseChapters course={courseDetails} />
        </div>
    )
}

export default CoursePage