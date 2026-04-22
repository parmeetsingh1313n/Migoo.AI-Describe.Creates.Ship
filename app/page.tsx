import CourseList from './_components/CourseList';
import Hero from './_components/Hero';

export default function HomePage() {
  return (
    <div className="min-h-screen">
      <Hero />
      <CourseList />
    </div>
  );
}