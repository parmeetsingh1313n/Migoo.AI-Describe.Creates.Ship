'use client';
import { useEffect, useRef } from 'react';
import Link from 'next/link';

const HLS_SRC = 'https://stream.mux.com/Aa02T7oM1wH5Mk5EEVDYhbZ1ChcdhRsS2m1NYyx4Ua1g.m3u8';
const MARQUEE_TEXT = 'DESCRIBE IT. AI CREATES IT. SHIP IT. • ';

const SOCIALS = ['Twitter', 'LinkedIn', 'YouTube', 'GitHub'];

export default function ContactFooter() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const marqueeRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLElement>(null);
  const buttonRef = useRef<HTMLAnchorElement>(null);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const setup = async () => {
      if (typeof window === 'undefined') return;
      const Hls = (await import('hls.js')).default;
      if (Hls.isSupported()) {
        const hls = new Hls();
        hls.loadSource(HLS_SRC);
        hls.attachMedia(video);
        return () => hls.destroy();
      } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
        video.src = HLS_SRC;
      }
    };
    setup();
  }, []);

  useEffect(() => {
    let ctx: any;
    const init = async () => {
      const { gsap } = await import('gsap');
      const { ScrollTrigger } = await import('gsap/ScrollTrigger');
      gsap.registerPlugin(ScrollTrigger);

      ctx = gsap.context(() => {
        gsap.to(marqueeRef.current, {
          xPercent: -50,
          duration: 40,
          ease: 'none',
          repeat: -1,
        });

        gsap.fromTo('.gsap-footer-title',
          { opacity: 0, y: 50, scale: 0.95 },
          {
            opacity: 1,
            y: 0,
            scale: 1,
            duration: 1.2,
            ease: 'power3.out',
            scrollTrigger: {
              trigger: '.gsap-footer-title',
              start: 'top 85%',
              once: true,
            }
          }
        );

        const btn = buttonRef.current;
        if (btn) {
          const onMouseMove = (e: MouseEvent) => {
            const rect = btn.getBoundingClientRect();
            const x = e.clientX - rect.left - rect.width / 2;
            const y = e.clientY - rect.top - rect.height / 2;

            gsap.to(btn, {
              x: x * 0.35,
              y: y * 0.35,
              duration: 0.3,
              ease: 'power2.out',
            });
          };

          const onMouseLeave = () => {
            gsap.to(btn, {
              x: 0,
              y: 0,
              duration: 0.5,
              ease: 'elastic.out(1, 0.3)',
            });
          };

          btn.addEventListener('mousemove', onMouseMove);
          btn.addEventListener('mouseleave', onMouseLeave);

          return () => {
            btn.removeEventListener('mousemove', onMouseMove);
            btn.removeEventListener('mouseleave', onMouseLeave);
          };
        }
      }, containerRef);
    };

    init();
    return () => ctx?.revert();
  }, []);

  return (
    <footer
      ref={containerRef}
      className="relative pt-16 md:pt-20 pb-8 md:pb-12 overflow-hidden bg-transparent"
    >
      {/* Background video — flipped vertically */}
      <div className="absolute inset-0 z-0">
        <video
          ref={videoRef}
          autoPlay
          muted
          loop
          playsInline
          className="absolute inset-0 w-full h-full object-cover"
          style={{ transform: 'scaleY(-1)' }}
        />
        <div className="absolute inset-0" style={{ backgroundColor: 'rgba(0,0,0,0.65)' }} />
      </div>

      {/* Cohesive Theme Ambient Glows Overlay */}
      <div className="absolute top-0 left-[-10%] h-[350px] w-[350px] bg-pink-400/5 blur-[120px] rounded-full pointer-events-none z-1" />
      <div className="absolute bottom-0 right-[-10%] h-[350px] w-[350px] bg-purple-400/5 blur-[120px] rounded-full pointer-events-none z-1" />

      {/* Content */}
      <div className="relative z-10">

        {/* Marquee */}
        <div className="overflow-hidden mb-16 md:mb-24 select-none">
          <div
            ref={marqueeRef}
            className="flex whitespace-nowrap"
            style={{ width: 'max-content' }}
          >
            {Array.from({ length: 20 }).map((_, i) => (
              <span
                key={i}
                className="text-4xl md:text-6xl lg:text-7xl font-medium tracking-[-0.02em] pr-8"
                style={{
                  fontFamily: "'Instrument Serif', serif",
                  color: i % 2 === 0 ? 'hsl(0 0% 96%)' : 'transparent',
                  WebkitTextStroke: i % 2 !== 0 ? '1px rgba(255,255,255,0.15)' : undefined,
                }}
              >
                {MARQUEE_TEXT}
              </span>
            ))}
          </div>
        </div>

        {/* CTA */}
        <div className="max-w-[1200px] mx-auto px-6 md:px-10 lg:px-16">
          <div className="flex flex-col items-center text-center mb-16">
            <p className="text-xs uppercase tracking-[0.3em] mb-6 text-neutral-400 font-semibold">
              Ready to ship?
            </p>
            <h2
              className="gsap-footer-title opacity-0 text-5xl md:text-7xl font-medium mb-10 leading-tight"
              style={{ fontFamily: "'Instrument Serif', serif", color: 'hsl(0 0% 96%)' }}
            >
              Start creating cinematic courses{' '}
              <em className="italic font-light">&amp; viral shorts</em>
            </h2>

            <Link
              ref={buttonRef as any}
              href="/course-generator"
              className="relative inline-flex items-center gap-2 rounded-full px-8 py-4 text-sm font-semibold transition-all duration-300 cursor-pointer group bg-white text-black shadow-lg hover:scale-105"
            >
              <span className="absolute inset-0 rounded-full opacity-0 group-hover:opacity-100 transition-opacity duration-300"
                style={{
                  background: 'linear-gradient(90deg, #3EA5D6, #6D5BD3)',
                  padding: '2px',
                  zIndex: -1,
                  WebkitMask: 'linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0)',
                  WebkitMaskComposite: 'xor',
                  maskComposite: 'exclude',
                }}
              />
              Start Generating for Free ⚡
            </Link>
          </div>

          {/* Footer bar */}
          <div
            className="flex flex-col sm:flex-row items-center justify-between gap-4 pt-8 border-t border-neutral-800"
          >
            {/* Socials */}
            <div className="flex items-center gap-6">
              {SOCIALS.map(s => (
                <a
                  key={s}
                  href="#"
                  className="text-xs transition-colors duration-200 text-neutral-400 hover:text-white font-semibold"
                >
                  {s}
                </a>
              ))}
            </div>

            {/* Copyright */}
            <span className="text-xs text-neutral-400 font-semibold">
              &copy; {new Date().getFullYear()} Migoo.AI. All rights reserved.
            </span>
          </div>
        </div>
      </div>
    </footer>
  );
}
