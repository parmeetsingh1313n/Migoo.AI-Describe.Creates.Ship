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
    // Guard so course images are auto-queued only ONCE per page mount, no matter
    // how many times the course is refetched (the images fn is itself idempotent).
    const imagesFiredRef = useRef(false);

    useEffect(() => {
        GetCourseDetails();
    }, [courseId]);

    const GetCourseDetails = async () => {
        try {
            const res = await axios.get(`/api/course?courseId=${courseId}`);
            const courseData = res.data?.data ?? res.data;
            setCourseDetails(courseData);

            // Auto thumbnail trigger
            const hasThumbnail = !!courseData?.courseThumbnail;
            const isExternal = hasThumbnail && courseData.courseThumbnail.startsWith('http');
            if ((!hasThumbnail || isExternal) && courseData?.courseId && courseData?.courseName) {
                axios.post('/api/generate-thumbnail', {
                    courseId: courseData.courseId,
                    courseName: courseData.courseName,
                }).catch(err => console.error("❌ Thumbnail trigger failed:", err));
            }

            // Auto-start slide IMAGE generation as soon as the layout is on screen —
            // decoupled from the "Generate Video Content" button so images are ready
            // (or nearly so) by the time the user clicks generate. Fired once; the
            // Inngest images fn self-skips when every planned image already exists.
            const chapters = courseData?.courseLayout?.chapters;
            if (!imagesFiredRef.current && courseData?.courseId && courseData?.courseName && Array.isArray(chapters) && chapters.length > 0) {
                imagesFiredRef.current = true;
                axios.post('/api/generate-images', {
                    courseName: courseData.courseName,
                    courseId: courseData.courseId,
                    chapters,
                }).catch(err => console.error("⚠️ Image auto-queue failed:", err?.message));
            }

            return courseData;
        } catch (error) {
            console.error("❌ Error fetching course:", error);
            toast.error("Failed to fetch course details");
        }
    };

    return (
        <div className='flex flex-col items-center'>
            <CourseInfoCard course={courseDetails} />
            <CourseChapters course={courseDetails} onRefresh={GetCourseDetails} />
        </div>
    );
}

export default CoursePage;