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