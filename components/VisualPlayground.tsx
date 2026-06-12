'use client';

import { useEffect, useRef } from 'react';
import Image from 'next/image';
import Link from 'next/link';

const COLUMN_0 = [
  {
    id: 1,
    title: 'Hormozi CapSync',
    sub: 'Realtime Captions',
    img: '/landing-page-images/visual-playgrounds/capsync.png',
    rotate: '-3deg'
  },
  {
    id: 3,
    title: 'Multi-Voice TTS',
    sub: 'ElevenLabs & Sarvam',
    img: '/landing-page-images/visual-playgrounds/tts.png',
    rotate: '2deg'
  },
  {
    id: 5,
    title: 'Remotion Compiler',
    sub: 'Serverless Render',
    img: '/landing-page-images/visual-playgrounds/compiler.png',
    rotate: '-1.5deg'
  }
];

const COLUMN_1 = [
  {
    id: 2,
    title: 'LLM Orchestrator',
    sub: 'Curriculum Builder',
    img: '/landing-page-images/visual-playgrounds/llm.png',
    rotate: '3deg'
  },
  {
    id: 4,
    title: 'Leonardo.AI Visuals',
    sub: 'Cinematic Prompts',
    img: '/landing-page-images/visual-playgrounds/leonardoai.png',
    rotate: '-2deg'
  },
  {
    id: 6,
    title: 'Appwrite Vault',
    sub: 'Secure Asset Manager',
    img: '/landing-page-images/visual-playgrounds/security.png',
    rotate: '1.5deg'
  }
];

export default function VisualPlayground() {
  const sectionRef = useRef<HTMLElement>(null);
  const pinnedRef = useRef<HTMLDivElement>(null);
  const col0Ref = useRef<HTMLDivElement>(null);
  const col1Ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let ctx: any;

    const init = async () => {
      const { gsap } = await import('gsap');
      const { ScrollTrigger } = await import('gsap/ScrollTrigger');
      gsap.registerPlugin(ScrollTrigger);

      ctx = gsap.context(() => {
        ScrollTrigger.create({
          trigger: sectionRef.current,
          start: 'top top',
          end: 'bottom bottom',
          pin: pinnedRef.current,
          pinSpacing: false,
        });

        gsap.fromTo(
          col0Ref.current,
          { y: '25vh' },
          {
            y: '-35vh',
            ease: 'none',
            scrollTrigger: {
              trigger: sectionRef.current,
              start: 'top bottom',
              end: 'bottom top',
              scrub: 1.2,
            },
          }
        );

        gsap.fromTo(
          col1Ref.current,
          { y: '-25vh' },
          {
            y: '35vh',
            ease: 'none',
            scrollTrigger: {
              trigger: sectionRef.current,
              start: 'top bottom',
              end: 'bottom top',
              scrub: 1.2,
            },
          }
        );

        gsap.from('.vp-card-container', {
          opacity: 0,
          y: 100,
          scale: 0.9,
          duration: 1.2,
          stagger: 0.15,
          ease: 'power4.out',
          scrollTrigger: {
            trigger: sectionRef.current,
            start: 'top 70%',
            once: true,
          },
        });
      }, sectionRef);
    };

    init();
    return () => ctx?.revert();
  }, []);

  return (
    <section
      ref={sectionRef}
      className="relative w-full overflow-hidden bg-transparent"
      style={{
        minHeight: '280vh',
      }}
    >
      {/* ── Cohesive Theme Ambient Glows ────────────────────────── */}
      <div className="absolute top-[15%] left-[5%] w-[45vw] h-[45vw] rounded-full bg-purple-500/10 blur-[130px] pointer-events-none" />
      <div className="absolute top-[45%] right-[5%] w-[45vw] h-[45vw] rounded-full bg-pink-500/10 blur-[130px] pointer-events-none" />
      <div className="absolute bottom-[15%] left-[10%] w-[45vw] h-[45vw] rounded-full bg-blue-500/10 blur-[130px] pointer-events-none" />

      {/* ── Layer 1: Pinned Center Text (z-10) ─────────────────── */}
      <div
        ref={pinnedRef}
        className="relative z-10 h-screen flex flex-col items-center justify-center text-center pointer-events-none select-none px-6"
      >
        <div className="flex items-center gap-3 mb-6">
          <span className="w-6 h-[1px] bg-black/20" />
          <p
            className="text-[10px] uppercase tracking-[0.4em] font-semibold text-neutral-500"
          >
            Creative Capabilities
          </p>
          <span className="w-6 h-[1px] bg-black/20" />
        </div>

        <h2
          className="text-5xl sm:text-6xl md:text-7xl font-medium tracking-tight leading-[1.1] mb-6 text-neutral-900"
        >
          Visual{' '}
          <em
            className="italic font-light font-serif text-neutral-700"
          >
            playground
          </em>
        </h2>

        <p
          className="text-sm max-w-sm leading-relaxed mb-10 text-neutral-500"
        >
          A peek into the advanced algorithmic features, AI integrations, and cinematic pipelines powering Migoo.
        </p>

        <Link
          href="/course-generator"
          className="pointer-events-auto group relative flex items-center gap-2.5 rounded-full px-6 py-3 text-xs font-semibold tracking-wide border border-neutral-800 text-white cursor-pointer overflow-hidden transition-all duration-300 hover:scale-105 bg-[#111111] shadow-md"
        >
          <span className="relative font-['Outfit']">Launch Migoo Studio 🚀</span>
        </Link>
      </div>

      {/* ── Layer 2: Floating Columns (z-20) ──────────────────── */}
      <div
        className="absolute inset-0 z-20 flex items-start justify-center pointer-events-none"
        style={{ padding: '0 4vw' }}
      >
        <div
          className="w-full h-full grid"
          style={{
            maxWidth: '1440px',
            gridTemplateColumns: '1fr 1fr',
            gap: 'clamp(8rem, 25vw, 32rem)',
          }}
        >
          <div
            ref={col0Ref}
            className="flex flex-col items-center justify-start"
            style={{ gap: '15vh', paddingTop: '35vh' }}
          >
            {COLUMN_0.map((card) => (
              <VisualCard key={card.id} card={card} />
            ))}
          </div>

          <div
            ref={col1Ref}
            className="flex flex-col items-center justify-start"
            style={{ gap: '15vh', paddingTop: '10vh' }}
          >
            {COLUMN_1.map((card) => (
              <VisualCard key={card.id} card={card} />
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

function VisualCard({ card }: { card: typeof COLUMN_0[0] }) {
  const cardRef = useRef<HTMLDivElement>(null);

  return (
    <div
      ref={cardRef}
      className="vp-card-container pointer-events-auto w-full max-w-[340px]"
      style={{
        transform: `rotate(${card.rotate})`,
        transition: 'transform 0.5s cubic-bezier(0.25, 1, 0.5, 1)',
      }}
      onMouseEnter={() => {
        if (cardRef.current) {
          cardRef.current.style.transform = 'rotate(0deg) scale(1.05)';
        }
      }}
      onMouseLeave={() => {
        if (cardRef.current) {
          cardRef.current.style.transform = `rotate(${card.rotate}) scale(1)`;
        }
      }}
    >
      <div
        className="relative group w-full aspect-square overflow-hidden"
        style={{
          borderRadius: '32px',
          boxShadow: '0 15px 40px -10px rgba(0, 0, 0, 0.15), 0 0 20px rgba(255, 255, 255, 0.4)',
          border: '1px solid rgba(0,0,0,0.06)',
          backgroundColor: '#ffffff',
        }}
      >
        <Image
          src={card.img}
          alt={card.title}
          fill
          className="object-cover transition-transform duration-700 ease-[cubic-bezier(0.25, 1, 0.5, 1)] group-hover:scale-108"
          sizes="340px"
        />

        <div
          className="absolute inset-0 opacity-5 pointer-events-none mix-blend-multiply"
          style={{
            backgroundImage: 'radial-gradient(circle, #000 1px, transparent 1px)',
            backgroundSize: '4px 4px',
          }}
        />

        <div
          className="absolute bottom-0 left-0 right-0 p-5 opacity-0 group-hover:opacity-100 transition-opacity duration-300"
          style={{
            background: 'linear-gradient(to top, rgba(0,0,0,0.85) 0%, transparent 100%)',
            backdropFilter: 'blur(8px)',
          }}
        >
          <p className="text-[10px] uppercase tracking-[0.25em] mb-1 text-white/70 font-semibold">
            {card.sub}
          </p>
          <h3 className="text-sm font-semibold text-white">
            {card.title}
          </h3>
        </div>

        <div
          className="absolute top-4 right-4 w-8 h-8 rounded-full flex items-center justify-center text-[10px] font-semibold border border-neutral-200"
          style={{
            backgroundColor: 'rgba(255,255,255,0.85)',
            color: '#111111',
            backdropFilter: 'blur(4px)',
          }}
        >
          0{card.id}
        </div>
      </div>
    </div>
  );
}
