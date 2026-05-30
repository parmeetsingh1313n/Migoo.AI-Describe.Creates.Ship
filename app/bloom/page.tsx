'use client';

import {
  ArrowRight,
  BookOpen,
  Download,
  Instagram,
  Linkedin,
  Menu,
  Sparkles,
  Twitter,
  Wand2,
} from 'lucide-react';
import Image from 'next/image';
import Link from 'next/link';

const BLOOM_VIDEO =
  'https://d8j0ntlcm91z4.cloudfront.net/user_38xzZboKViGWJOttwIXH07lWA1P/hf_20260315_073750_51473149-4350-4920-ae24-c8214286f323.mp4';

export default function BloomPage() {
  return (
    <>
      {/* Google Fonts */}
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Poppins:ital,wght@0,300;0,400;0,500;0,600;1,300;1,400&family=Source+Serif+4:ital,wght@0,400;1,300;1,400&display=swap');
      `}</style>

      <div className="bloom-root">
        {/* ── Video background ───────────────────────────────────── */}
        <video
          autoPlay
          loop
          muted
          playsInline
          className="bloom-video"
        >
          <source src={BLOOM_VIDEO} type="video/mp4" />
        </video>
        {/* Subtle dark veil so glass pops */}
        <div className="bloom-veil" />

        {/* ── Two-panel layout ───────────────────────────────────── */}
        <div className="bloom-panels">

          {/* ════════════════════════════════
              LEFT PANEL
          ════════════════════════════════ */}
          <div className="bloom-left-panel">
            {/* Frosted glass overlay card */}
            <div className="bloom-left-glass liquid-glass-strong" />

            {/* ── Nav ── */}
            <nav className="bloom-nav">
              <Link href="/" className="bloom-logo-link">
                <Image src="/logo-transparent.png" alt="Bloom" width={32} height={32} className="invert brightness-0 invert-[1]" />
                <span className="bloom-logo-text">bloom</span>
              </Link>
              <button className="liquid-glass bloom-menu-pill">
                <Menu className="w-4 h-4 text-white/80" />
                <span className="bloom-menu-label">Menu</span>
              </button>
            </nav>

            {/* ── Hero center ── */}
            <div className="bloom-hero-center">
              <Image
                src="/logo-transparent.png"
                alt="Bloom"
                width={80}
                height={80}
                className="invert brightness-0 invert-[1] mb-6 opacity-90"
              />

              <h1 className="bloom-headline">
                Innovating the
                <br />
                <em className="bloom-headline-italic">spirit of bloom</em>{' '}
                <span className="bloom-headline-normal">AI</span>
              </h1>

              {/* CTA button */}
              <button className="bloom-cta liquid-glass-strong">
                <span className="bloom-cta-label">Explore Now</span>
                <span className="bloom-cta-icon-wrap">
                  <Download className="w-4 h-4 text-white" />
                </span>
              </button>

              {/* Feature pills */}
              <div className="bloom-pills">
                {['Artistic Gallery', 'AI Generation', '3D Structures'].map((label) => (
                  <span key={label} className="bloom-pill liquid-glass">
                    {label}
                  </span>
                ))}
              </div>
            </div>

            {/* ── Bottom quote ── */}
            <div className="bloom-quote-block">
              <p className="bloom-quote-label">VISIONARY DESIGN</p>
              <p className="bloom-quote-text">
                <span className="bloom-quote-display">"We imagined </span>
                <em className="bloom-quote-serif">a realm with</em>
                <span className="bloom-quote-display"> no ending."</span>
              </p>
              <div className="bloom-quote-author">
                <span className="bloom-author-line" />
                <span className="bloom-author-name">MARCUS AURELIO</span>
                <span className="bloom-author-line" />
              </div>
            </div>
          </div>

          {/* ════════════════════════════════
              RIGHT PANEL (desktop only)
          ════════════════════════════════ */}
          <div className="bloom-right-panel">

            {/* ── Top bar ── */}
            <div className="bloom-right-topbar">
              {/* Social pill */}
              <div className="liquid-glass bloom-social-pill">
                {[
                  { Icon: Twitter, href: '#' },
                  { Icon: Linkedin, href: '#' },
                  { Icon: Instagram, href: '#' },
                ].map(({ Icon, href }, i) => (
                  <Link key={i} href={href} className="bloom-social-icon-link">
                    <span className="bloom-icon-circle">
                      <Icon className="w-3.5 h-3.5" />
                    </span>
                  </Link>
                ))}
                <span className="bloom-social-divider" />
                <ArrowRight className="w-4 h-4 text-white/50" />
              </div>

              {/* Account button */}
              <button className="liquid-glass bloom-account-btn">
                <Sparkles className="w-4 h-4 text-white/70" />
              </button>
            </div>

            {/* ── Community card ── */}
            <div className="liquid-glass bloom-community-card">
              <p className="bloom-community-title">Enter our ecosystem</p>
              <p className="bloom-community-desc">
                Connect with growers, designers & AI artists building the future of flora.
              </p>
            </div>

            {/* ── Bottom feature section ── */}
            <div className="bloom-feature-section liquid-glass">

              {/* Two side-by-side cards */}
              <div className="bloom-feature-pair">
                <div className="liquid-glass bloom-feature-card">
                  <span className="bloom-icon-circle">
                    <Wand2 className="w-4 h-4 text-white/70" />
                  </span>
                  <p className="bloom-feature-card-title">Processing</p>
                  <p className="bloom-feature-card-desc">Real-time rendering</p>
                </div>
                <div className="liquid-glass bloom-feature-card">
                  <span className="bloom-icon-circle">
                    <BookOpen className="w-4 h-4 text-white/70" />
                  </span>
                  <p className="bloom-feature-card-title">Growth Archive</p>
                  <p className="bloom-feature-card-desc">Track your history</p>
                </div>
              </div>

              {/* Bottom wide card */}
              <div className="liquid-glass bloom-feature-wide-card">
                <div className="bloom-feature-thumb">
                  <div className="bloom-feature-thumb-placeholder" />
                </div>
                <div className="bloom-feature-wide-body">
                  <p className="bloom-feature-wide-title">Advanced Plant Sculpting</p>
                  <p className="bloom-feature-wide-desc">
                    Craft intricate botanical structures with precision AI tools.
                  </p>
                </div>
                <button className="liquid-glass bloom-feature-plus">+</button>
              </div>

            </div>
          </div>
        </div>
      </div>
    </>
  );
}
