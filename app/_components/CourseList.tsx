"use client";
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import axios from 'axios';
import { useEffect, useState } from 'react';
import CourseListCard from './CourseListCard';

function CourseListCardSkeleton() {
  const skeletonClass = 'bg-gradient-to-r from-[#8F4EE6]/20 via-[#5285D1]/20 to-[#33BDD1]/20 animate-pulse rounded-md';
  return (
    <Card className='bg-white z-10'>
      <CardHeader>
        <div className='flex justify-between items-center'>
          <div className={`${skeletonClass} h-5 w-3/5`} />
          <div className={`${skeletonClass} h-6 w-20 rounded-full`} />
        </div>
        {/* Thumbnail skeleton */}
        <div className={`${skeletonClass} w-full h-40 rounded-lg mt-2 mb-2`} />
        <div className='flex gap-3 items-center'>
          <div className={`${skeletonClass} h-6 w-28 rounded-full`} />
          <div className={`${skeletonClass} h-6 w-40 rounded-full`} />
        </div>
      </CardHeader>
      <CardContent>
        <div className='flex gap-2 items-center justify-between'>
          <div className={`${skeletonClass} h-4 w-28`} />
          <div className={`${skeletonClass} h-9 w-28 rounded-md`} />
        </div>
      </CardContent>
    </Card>
  );
}

function CourseList() {

  const [courseList, setCourseList] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    GetCourseList();
  }, []);

  const GetCourseList = async () => {
    try {
      setLoading(true);
      const result = await axios.get('/api/course');
      // apiSuccess wraps response as { success, data, timestamp }
      const courses = Array.isArray(result.data) ? result.data : (result.data?.data || []);
      setCourseList(courses);

      // Auto-generate thumbnails for courses that don't have one yet
      const coursesWithoutThumbnail = courses.filter(
        (course: any) => !course.courseThumbnail
      );

      if (coursesWithoutThumbnail.length > 0) {
        console.log(`🖼️ Found ${coursesWithoutThumbnail.length} courses without thumbnails, generating...`);
        GenerateMissingThumbnails(coursesWithoutThumbnail);
      }
    } finally {
      setLoading(false);
    }
  }

  const GenerateMissingThumbnails = async (courses: any[]) => {
    for (const course of courses) {
      try {
        console.log(`🖼️ Generating thumbnail for: ${course.courseName}`);
        await axios.post('/api/generate-thumbnail', {
          courseId: course.courseId,
          courseName: course.courseName,
        });
        console.log(`✅ Thumbnail generated for: ${course.courseName}`);
      } catch (err: any) {
        console.error(`❌ Thumbnail failed for ${course.courseName}:`, err.message);
      }
    }
    // Refresh list to show newly generated thumbnails
    const refreshed = await axios.get('/api/course');
    const refreshedCourses = Array.isArray(refreshed.data) ? refreshed.data : (refreshed.data?.data || []);
    setCourseList(refreshedCourses);
  }

  return (
    <div className='max-w-6xl mx-auto mt-10'>
      <h2 className="text-2xl font-bold">My Courses</h2>
      <div className='grid grid-cols-2 md:grid-cols-3 xl:grid-cols-3 gap-4 mt-4'>
        {loading ? (
          <>
            <CourseListCardSkeleton />
            <CourseListCardSkeleton />
            <CourseListCardSkeleton />
            <CourseListCardSkeleton />
            <CourseListCardSkeleton />
            <CourseListCardSkeleton />
          </>
        ) : (
          courseList.map((course: any, index: number) => (
            <CourseListCard key={index} courseItem={course} />
          ))
        )}
      </div>
    </div>
  )
}

export default CourseList