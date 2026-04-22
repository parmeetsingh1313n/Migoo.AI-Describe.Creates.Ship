import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { Course } from '@/type/CourseType'
import { Calendar, Dot, Layers, Play } from 'lucide-react'
import moment from 'moment'
import Link from 'next/link'

type Props = {
  courseItem: Course
}

function CourseListCard({ courseItem }: Props) {
  return (
    <Card className='bg-white z-10'>
      <CardHeader>
        <div className='flex justify-between items-center'>
          <h2 className='font-medium text-md '>{courseItem.courseName}</h2>
          <h2 className='text-primary text-sm bg-primary/10 p-1 px-2 border rounded-4xl border-primary'>{courseItem.courseLayout.level}</h2>
        </div>

        {/* Course Thumbnail */}
        <div className='relative w-full h-40 rounded-lg overflow-hidden bg-gradient-to-br from-primary/20 to-primary/5 mt-2 mb-2'>
          {courseItem.courseThumbnail ? (
            <img
              src={courseItem.courseThumbnail}
              alt={courseItem.courseName}
              onError={(e) => {
                e.currentTarget.style.display = 'none';
              }}
              className='w-full h-full object-cover rounded-lg'
            />
          ) : (
            <div className='flex items-center justify-center h-full text-primary/40'>
              <Layers className='w-10 h-10' />
            </div>
          )}
        </div>

        <div className='flex gap-3 items-center '>
          <h2 className='flex items-center gap-2 text-slate-600 text-xs bg-slate-400/10 p-1 px-2 border rounded-4xl border-slate-400'>
            <Layers className='w-4 h-4 mr-2' />
            {courseItem.courseLayout.totalChapters} chapters
          </h2>
          <h2 className='flex items-center gap-2 text-slate-600 text-xs bg-slate-400/10 p-1 px-2 border rounded-4xl border-slate-400'>
            <Calendar className='w-4 h-4 mr-1' />
            {moment(courseItem.createdAt).format('MMM DD, YYYY')}
            <Dot className='w-2 h-2 mr-1' />
            {moment(courseItem.createdAt).fromNow()}
          </h2>
        </div>
      </CardHeader>
      <CardContent>
        <div className='flex gap-2 items-center justify-between'>
          <p>Keep Learning...</p>
          <Link href={`/course/${courseItem.courseId}`}>
            <Button>Watch Now <Play /> </Button>
          </Link>
        </div>
      </CardContent>
    </Card>
  )
}

export default CourseListCard