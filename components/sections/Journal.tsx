'use client';
import { useEffect, useRef } from 'react';
import Image from 'next/image';

const ENTRIES = [
  {
    id: 1,
    title: 'Multi-Provider Orchestration: Balancing Groq, OpenRouter, and Gemini for Zero-Downtime Video Generation',
    readTime: '6 min read',
    date: 'May 2026',
    img: '/landing-page-images/system-insights/one.png',
  },
  {
    id: 2,
    title: 'Remotion CapSync: Compiling Real-Time Slides with Word-Level Synchronized Hormozi Captions',
    readTime: '5 min read',
    date: 'Apr 2026',
    img: '/landing-page-images/system-insights/two.png',
  },
  {
    id: 3,
    title: 'Scaling Background Video Compilations with Serverless Remotion and Inngest Durable Workflows',
    readTime: '8 min read',
    date: 'Mar 2026',
    img: '/landing-page-images/system-insights/third.png',
  },
  {
    id: 4,
    title: 'Context-Aware Image Sourcing: Architecting Rich Leonardo AI Prompts for Chapter Content Layouts',
    readTime: '4 min read',
    date: 'Feb 2026',
    img: '/landing-page-images/system-insights/fourth.png',
  },
];

export default function Journal() {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let ctx: any;
    const init = async () => {
      const { gsap } = await import('gsap');
      const { ScrollTrigger } = await import('gsap/ScrollTrigger');
      gsap.registerPlugin(ScrollTrigger);

      ctx = gsap.context(() => {
        gsap.fromTo('.gsap-journal-header',
          { opacity: 0, y: 40 },
          {
            opacity: 1,
            y: 0,
            duration: 1.2,
            ease: 'power3.out',
            scrollTrigger: {
              trigger: '.gsap-journal-header',
              start: 'top 85%',
              once: true
            }
          }
        );

        gsap.fromTo('.gsap-journal-pill',
          { opacity: 0, x: -60, scale: 0.96 },
          {
            opacity: 1,
            x: 0,
            scale: 1,
            duration: 1,
            stagger: 0.12,
            ease: 'power3.out',
            scrollTrigger: {
              trigger: '.gsap-journal-list',
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
      <div className="absolute top-20 left-[-10%] h-[400px] w-[400px] bg-blue-400/5 blur-[120px] rounded-full pointer-events-none" />
      <div className="absolute bottom-[-100px] right-[-10%] h-[400px] w-[400px] bg-sky-400/5 blur-[120px] rounded-full pointer-events-none" />

      <div className="relative z-10 max-w-[1200px] mx-auto px-6 md:px-10 lg:px-16">

        {/* Header */}
        <div className="gsap-journal-header opacity-0 flex items-end justify-between mb-12">
          <div>
            <div className="flex items-center gap-3 mb-4">
              <div className="w-8 h-px bg-black/30" />
              <span className="text-xs uppercase tracking-[0.3em] text-neutral-500 font-semibold">
                Tech Journal
              </span>
            </div>
            <h2 className="text-4xl md:text-5xl font-medium leading-tight text-neutral-900">
              System{' '}
              <em style={{ fontFamily: "'Instrument Serif', serif" }} className="italic font-light">
                insights
              </em>
            </h2>
            <p className="mt-3 text-sm text-neutral-500 max-w-lg">
              Technical documentation, architecture explorations, and system design insights behind Migoo.
            </p>
          </div>

          <button
            className="hidden md:inline-flex items-center gap-2 rounded-full px-5 py-2.5 text-sm border border-neutral-200 bg-white hover:bg-neutral-50 transition-all duration-300 hover:scale-105 cursor-pointer text-neutral-800 shadow-sm"
          >
            Read all insights <span>→</span>
          </button>
        </div>

        {/* Entries */}
        <div className="gsap-journal-list flex flex-col gap-3">
          {ENTRIES.map((entry) => (
            <div
              key={entry.id}
              className="gsap-journal-pill opacity-0 group flex items-center gap-6 p-4 rounded-[40px] sm:rounded-full border border-neutral-100/50 cursor-pointer transition-colors duration-300 shadow-sm"
              style={{
                backgroundColor: 'rgba(255,255,255,0.65)',
                backdropFilter: 'blur(8px)',
              }}
              onMouseEnter={e => {
                e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.9)';
                e.currentTarget.style.borderColor = 'rgba(0,0,0,0.12)';
              }}
              onMouseLeave={e => {
                e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.65)';
                e.currentTarget.style.borderColor = 'rgba(255,255,255,0.65)';
              }}
            >
              {/* Thumbnail */}
              <div className="relative w-12 h-12 sm:w-14 sm:h-14 flex-shrink-0 rounded-full overflow-hidden">
                <Image src={entry.img} alt={entry.title} fill className="object-cover" sizes="56px" />
              </div>

              {/* Title */}
              <p className="flex-1 text-sm sm:text-base font-semibold leading-snug text-neutral-800 group-hover:text-black transition-colors duration-300">
                {entry.title}
              </p>

              {/* Meta */}
              <div className="hidden sm:flex items-center gap-4 flex-shrink-0">
                <span className="text-xs text-neutral-500 font-semibold">{entry.readTime}</span>
                <span className="text-xs text-neutral-500 font-semibold">{entry.date}</span>
              </div>

              {/* Arrow */}
              <div
                className="flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center border border-neutral-200 opacity-0 group-hover:opacity-100 transition-opacity duration-300 bg-white shadow-sm text-neutral-800"
              >
                <span className="text-xs">↗</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
