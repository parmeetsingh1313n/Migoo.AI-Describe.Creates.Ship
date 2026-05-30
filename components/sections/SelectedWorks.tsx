'use client';
import { useEffect, useRef } from 'react';
import Image from 'next/image';

const PROJECTS = [
  {
    id: 1,
    title: 'AI Video Course Generator',
    tag: 'Module 1 / Educational',
    span: 'md:col-span-7',
    aspect: 'aspect-[16/10]',
    img: '/landing-page-images/creative-seats/course.png',
  },
  {
    id: 2,
    title: 'Viral Shorts Auto-Pilot',
    tag: 'Module 2 / Social Media',
    span: 'md:col-span-5',
    aspect: 'aspect-[4/3]',
    img: '/landing-page-images/creative-seats/shorts.png',
  },
  {
    id: 3,
    title: 'Conversational Motion Graphics',
    tag: 'Module 3 / Marketing',
    span: 'md:col-span-5',
    aspect: 'aspect-[4/3]',
    img: '/landing-page-images/creative-seats/motion.png',
  },
  {
    id: 4,
    title: 'Migoo Studio (Creative Seat)',
    tag: 'Module 4 / Professional',
    span: 'md:col-span-7',
    aspect: 'aspect-[16/10]',
    img: '/landing-page-images/creative-seats/studio.png',
  },
];

export default function SelectedWorks() {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let ctx: any;
    const init = async () => {
      const { gsap } = await import('gsap');
      const { ScrollTrigger } = await import('gsap/ScrollTrigger');
      gsap.registerPlugin(ScrollTrigger);

      ctx = gsap.context(() => {
        gsap.fromTo('.gsap-works-header',
          { opacity: 0, y: 50 },
          {
            opacity: 1,
            y: 0,
            duration: 1.2,
            ease: 'power3.out',
            scrollTrigger: {
              trigger: '.gsap-works-header',
              start: 'top 85%',
              once: true
            }
          }
        );

        gsap.fromTo('.gsap-bento-card',
          { opacity: 0, y: 70, rotationX: 8, transformOrigin: 'top center' },
          {
            opacity: 1,
            y: 0,
            rotationX: 0,
            duration: 1.2,
            stagger: 0.15,
            ease: 'power4.out',
            scrollTrigger: {
              trigger: '.gsap-bento-grid',
              start: 'top 80%',
              once: true
            }
          }
        );
      }, containerRef);
    };

    init();
    return () => ctx?.revert();
  }, []);

  return (
    <section ref={containerRef} className="relative py-16 md:py-24 overflow-hidden bg-transparent">
      {/* Cohesive Theme Ambient Glows */}
      <div className="absolute top-20 right-[-10%] h-[400px] w-[400px] bg-pink-400/5 blur-[120px] rounded-full pointer-events-none" />
      <div className="absolute bottom-[-100px] left-[-10%] h-[400px] w-[400px] bg-purple-400/5 blur-[120px] rounded-full pointer-events-none" />

      <div className="relative z-10 max-w-[1200px] mx-auto px-6 md:px-10 lg:px-16">

        {/* Header */}
        <div className="gsap-works-header opacity-0 flex items-end justify-between mb-12 md:mb-16">
          <div>
            <div className="flex items-center gap-3 mb-4">
              <div className="w-8 h-px bg-black/30" />
              <span className="text-xs uppercase tracking-[0.3em] text-neutral-500 font-semibold">
                Studio Modules
              </span>
            </div>
            <h2 className="text-4xl md:text-5xl font-medium leading-tight text-neutral-900">
              Creative{' '}
              <em style={{ fontFamily: "'Instrument Serif', serif" }} className="italic font-light">
                seat
              </em>
            </h2>
            <p className="mt-3 text-sm text-neutral-500 max-w-lg">
              Explore our four distinct production workflows automating the text-to-video workflow.
            </p>
          </div>

          <button
            className="hidden md:inline-flex items-center gap-2 rounded-full px-5 py-2.5 text-sm border border-neutral-200 bg-white hover:bg-neutral-50 transition-all duration-300 hover:scale-105 cursor-pointer text-neutral-800 shadow-sm"
          >
            Explore all modules <span>→</span>
          </button>
        </div>

        {/* Bento Grid */}
        <div className="gsap-bento-grid grid grid-cols-1 md:grid-cols-12 gap-5 md:gap-6">
          {PROJECTS.map((p) => (
            <div
              key={p.id}
              className={`${p.span} gsap-bento-card opacity-0 group relative overflow-hidden rounded-3xl border border-neutral-100 bg-white/70 backdrop-blur-md shadow-sm hover:shadow-md cursor-pointer`}
              style={{ perspective: '1000px' }}
            >
              <div className={`${p.aspect} relative w-full`}>
                <Image
                  src={p.img}
                  alt={p.title}
                  fill
                  className="object-cover transition-transform duration-700 group-hover:scale-105"
                  sizes="(max-width: 768px) 100vw, 50vw"
                />

                <div
                  className="absolute inset-0 opacity-10 mix-blend-multiply pointer-events-none"
                  style={{
                    backgroundImage: 'radial-gradient(circle, #000 1px, transparent 1px)',
                    backgroundSize: '4px 4px',
                  }}
                />

                <div
                  className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-500 backdrop-blur-sm"
                  style={{ backgroundColor: 'rgba(255,255,255,0.75)' }}
                />

                <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity duration-500">
                  <div
                    className="relative rounded-full px-5 py-2.5 text-sm font-semibold"
                    style={{
                      background: '#111111',
                      color: '#ffffff',
                      boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
                    }}
                  >
                    Launch —{' '}
                    <em style={{ fontFamily: "'Instrument Serif', serif" }} className="italic font-light">
                      {p.title}
                    </em>
                  </div>
                </div>

                <div className="absolute bottom-4 left-4 z-10">
                  <span
                    className="text-[10px] uppercase tracking-[0.25em] px-3 py-1 rounded-full font-semibold border border-neutral-200/50"
                    style={{ backgroundColor: 'rgba(255,255,255,0.85)', color: '#111111', backdropFilter: 'blur(8px)' }}
                  >
                    {p.tag}
                  </span>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
