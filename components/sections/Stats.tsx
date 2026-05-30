'use client';
import { useEffect, useRef } from 'react';

const STATS = [
  { target: 98, suffix: '%', label: 'Rendering Speedup', desc: 'Accelerated programmatic video output via serverless compilation and dynamic Inngest queue scaling.' },
  { target: 4, suffix: '', label: 'Production Modules', desc: 'Educational video courses, viral social shorts, conversational motion graphics, and the full creative director seat.' },
  { target: 5, suffix: '+', label: 'AI Integrations', desc: 'Seamless orchestration and intelligent fallbacks across Gemini, OpenRouter, Sarvam AI, ElevenLabs, and Leonardo AI.' },
];

export default function Stats() {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let ctx: any;
    const init = async () => {
      const { gsap } = await import('gsap');
      const { ScrollTrigger } = await import('gsap/ScrollTrigger');
      gsap.registerPlugin(ScrollTrigger);

      ctx = gsap.context(() => {
        gsap.fromTo('.gsap-stats-box',
          { opacity: 0, y: 50 },
          {
            opacity: 1,
            y: 0,
            duration: 1,
            ease: 'power3.out',
            scrollTrigger: {
              trigger: '.gsap-stats-box',
              start: 'top 85%',
              once: true
            }
          }
        );

        STATS.forEach((stat, index) => {
          const obj = { value: 0 };
          const element = document.querySelector(`.gsap-counter-${index}`);
          if (!element) return;

          gsap.to(obj, {
            value: stat.target,
            duration: 2,
            ease: 'power4.out',
            scrollTrigger: {
              trigger: element,
              start: 'top 90%',
              once: true
            },
            onUpdate: () => {
              element.textContent = Math.floor(obj.value).toString();
            }
          });
        });
      }, containerRef);
    };

    init();
    return () => ctx?.revert();
  }, []);

  return (
    <section ref={containerRef} className="relative py-16 md:py-24 overflow-hidden bg-transparent">
      {/* Cohesive Theme Ambient Glows */}
      <div className="absolute top-10 right-[-10%] h-[400px] w-[400px] bg-purple-400/5 blur-[120px] rounded-full pointer-events-none" />
      <div className="absolute bottom-[-100px] left-[-10%] h-[400px] w-[400px] bg-pink-400/5 blur-[120px] rounded-full pointer-events-none" />

      <div className="relative z-10 max-w-[1200px] mx-auto px-6 md:px-10 lg:px-16">
        <div
          className="gsap-stats-box opacity-0 grid grid-cols-1 md:grid-cols-3 divide-y md:divide-y-0 md:divide-x divide-neutral-100 rounded-3xl border border-neutral-100 p-8 md:p-0 bg-white/70 backdrop-blur-md shadow-sm"
        >
          {STATS.map((stat, i) => (
            <div
              key={stat.label}
              className="flex flex-col px-8 py-10 md:py-14 gap-4 border-neutral-100"
            >
              <div
                className="text-6xl md:text-7xl font-light tabular-nums flex items-baseline text-neutral-900"
                style={{
                  fontFamily: "'Instrument Serif', serif",
                }}
              >
                <span className={`gsap-counter-${i}`}>0</span>
                <span>{stat.suffix}</span>
              </div>
              <div>
                <p className="text-base font-semibold mb-1 text-neutral-800">
                  {stat.label}
                </p>
                <p className="text-sm leading-relaxed text-neutral-500">
                  {stat.desc}
                </p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
