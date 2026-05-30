// Bridge file: exposes CourseComposition to the Remotion server-side renderer.
// ChapterVideo.tsx has no Next.js-specific imports, so this re-export works cleanly.
export { CourseComposition } from '../app/(routes)/course/[courseId]/_components/ChapterVideo';
