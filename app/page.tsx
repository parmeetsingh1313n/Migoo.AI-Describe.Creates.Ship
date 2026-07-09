"use client";

import { UserButton, useUser } from "@clerk/nextjs";
import { LogIn, Menu, Sparkles, UserPlus, X } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import VisualPlayground from "@/components/VisualPlayground";
import SelectedWorks from "@/components/sections/SelectedWorks";
import Journal from "@/components/sections/Journal";
import Stats from "@/components/sections/Stats";
import ContactFooter from "@/components/sections/ContactFooter";
import DrawOutlineButton from "@/components/ui/DrawOutlineButton";

const VIDEO_1 =
  "https://d8j0ntlcm91z4.cloudfront.net/user_38xzZboKViGWJOttwIXH07lWA1P/hf_20260328_083109_283f3553-e28f-428b-a723-d639c617eb2b.mp4";

const VIDEO_2 =
  "https://d8j0ntlcm91z4.cloudfront.net/user_38xzZboKViGWJOttwIXH07lWA1P/hf_20260511_131941_d136af49-e243-493a-be14-6ff3f24e09e6.mp4";

type Phase = "video1" | "to-video2" | "video2" | "to-video1";

export default function LandingPage() {
  const video1Ref = useRef<HTMLVideoElement>(null);
  const video2Ref = useRef<HTMLVideoElement>(null);
  const { isSignedIn } = useUser();
  const [phase, setPhase] = useState<Phase>("video1");
  const [menuOpen, setMenuOpen] = useState(false);

  const ctaHref = isSignedIn ? "/course-generator" : "/sign-in";

  /* ── VIDEO 1: fade in/out, play once → crossfade to video 2 ────── */
  useEffect(() => {
    if (phase !== "video1") return;
    const video = video1Ref.current;
    if (!video) return;

    video.currentTime = 0;
    video.style.opacity = "0";

    let rafId: number;

    const tick = () => {
      if (!video.duration || video.paused) { rafId = requestAnimationFrame(tick); return; }
      const t = video.currentTime, d = video.duration, fw = 0.5;
      if (t < fw) video.style.opacity = String(Math.min(t / fw, 1));
      else if (t > d - fw) video.style.opacity = String(Math.max((d - t) / fw, 0));
      else video.style.opacity = "1";
      rafId = requestAnimationFrame(tick);
    };

    const onEnded = () => {
      video.style.opacity = "0";
      setPhase("to-video2");
      setTimeout(() => setPhase("video2"), 1000);
    };

    video.addEventListener("ended", onEnded);
    rafId = requestAnimationFrame(tick);
    video.play().catch(() => {});

    return () => { cancelAnimationFrame(rafId); video.removeEventListener("ended", onEnded); };
  }, [phase]);

  /* ── VIDEO 2: slow 0.5x, play once → crossfade back to video 1 ── */
  useEffect(() => {
    if (phase !== "video2") return;
    const video = video2Ref.current;
    if (!video) return;

    video.currentTime = 0;
    video.playbackRate = 0.5;
    video.play().catch(() => {});

    const onEnded = () => {
      setPhase("to-video1");
      setTimeout(() => setPhase("video1"), 1000);
    };

    video.addEventListener("ended", onEnded);
    return () => video.removeEventListener("ended", onEnded);
  }, [phase]);

  /* ── GSAP HERO ENTRANCE ANIMATION ─────────────────────────────── */
  useEffect(() => {
    const initIntro = async () => {
      const { gsap } = await import("gsap");
      
      // Animate nav items fading and dropping down
      gsap.fromTo(".landing-nav-item",
        { opacity: 0, y: -20 },
        { opacity: 1, y: 0, duration: 1, stagger: 0.1, ease: "power4.out", delay: 0.2 }
      );

      // Animate headline words sliding up elegantly
      gsap.fromTo(".gsap-hero-title > span",
        { y: 80, opacity: 0 },
        { y: 0, opacity: 1, duration: 1.4, stagger: 0.15, ease: "power4.out", delay: 0.5 }
      );

      // Animate description and CTA button
      gsap.fromTo(".gsap-hero-desc",
        { opacity: 0, y: 20 },
        { opacity: 1, y: 0, duration: 1.2, ease: "power3.out", delay: 1 }
      );

      gsap.fromTo(".gsap-hero-cta",
        { scale: 0.9, opacity: 0 },
        { scale: 1, opacity: 1, duration: 1.2, ease: "elastic.out(1, 0.75)", delay: 1.2 }
      );
    };

    initIntro();
  }, []);

  /* ── Mobile scroll lock ─────────────────────────────────────────── */
  useEffect(() => {
    document.body.style.overflow = menuOpen ? "hidden" : "";
    return () => { document.body.style.overflow = ""; };
  }, [menuOpen]);

  const showV1 = phase === "video1" || phase === "to-video2";
  const showV2 = phase === "video2" || phase === "to-video1";

  const navLinks = [
    { href: "/course-generator", label: "Studio" },
    { href: "/notes", label: "Notes" },
    { href: "/motion-graphics", label: "Motion" },
  ];

  return (
    <div className="landing-root">
      <div className="landing-hero-block">

      {/* ── VIDEO BACKGROUND LAYER ─────────────────────────────────── */}
      {/* Video 1 */}
      <div
        className="landing-section"
        style={{
          opacity: showV1 ? 1 : 0,
          transform: showV1 ? "scale(1)" : "scale(0.97)",
          filter: showV1 ? "blur(0px)" : "blur(6px)",
          transition: "all 1s cubic-bezier(0.22,1,0.36,1)",
          zIndex: showV1 ? 5 : 4,
          pointerEvents: "none",
        }}
      >
        <div className="landing-video-wrapper">
          <video ref={video1Ref} src={VIDEO_1} muted playsInline preload="auto"
            className="landing-video" style={{ opacity: 0 }} />
          <div className="landing-video-overlay" />
        </div>
      </div>

      {/* Video 2 */}
      <div
        className="landing-section"
        style={{
          opacity: showV2 ? 1 : 0,
          transform: showV2 ? "scale(1)" : "scale(1.03)",
          filter: showV2 ? "blur(0px)" : "blur(8px)",
          transition: "all 1.2s cubic-bezier(0.22,1,0.36,1)",
          zIndex: showV2 ? 5 : 4,
          pointerEvents: "none",
        }}
      >
        <video ref={video2Ref} src={VIDEO_2} muted playsInline preload="auto"
          className="absolute inset-0 w-full h-full object-cover" />
        <div className="landing-video-overlay" />
      </div>

      {/* ── UI OVERLAY — single unified Migoo design ───────────────── */}
      <div className="landing-section" style={{ zIndex: 20, pointerEvents: "auto", background: "transparent" }}>

        {/* NAV */}
        <nav className="absolute top-0 left-0 right-0 z-30 flex items-center justify-between px-6 sm:px-10 md:px-14 py-6 sm:py-10">

          {/* Logo */}
          <div className="flex items-center landing-nav-item opacity-0">
            <Link href="/">
              <Image
                src="/logo-transparent.png"
                alt="Migoo"
                width={120}
                height={54}
                className="object-contain"
                priority
              />
            </Link>
          </div>

          {/* Desktop pill nav */}
          <div className="hidden lg:flex items-center gap-6 bg-white/70 backdrop-blur-md rounded-full pl-8 pr-1 py-1 shadow-sm border border-white/60 landing-nav-item opacity-0">
            {navLinks.map((link, i) => (
              <Link
                key={link.href}
                href={link.href}
                className="px-4 py-2"
              >
                <span className="nav-flip">
                  <span className={`nav-flip-top ${i === 0 ? "nav-flip-top--active" : ""}`}>
                    {link.label}
                  </span>
                  <span className="nav-flip-bottom">{link.label}</span>
                </span>
              </Link>
            ))}
            <DrawOutlineButton
              href={ctaHref}
              fullWidth={false}
              accentColor="#3363AD"
              className="ml-2 text-sm font-semibold border border-[#3363AD]/60"
            >
              Get Started
            </DrawOutlineButton>
          </div>

          {/* Right: auth area */}
          <div className="flex items-center gap-3 sm:gap-4 landing-nav-item opacity-0">
            {isSignedIn ? (
              /* Signed in — show Clerk profile button */
              <UserButton
                appearance={{
                  elements: {
                    avatarBox: "w-9 h-9 ring-2 ring-[#3363AD]/30",
                  },
                }}
              />
            ) : (
              /* Signed out — show Sign Up / Sign In */
              <>
                <Link
                  href="/sign-up"
                  className="hidden sm:flex items-center gap-2 text-sm font-medium text-[#3363AD] hover:opacity-70 transition-opacity font-['Outfit']"
                >
                  <UserPlus className="w-4 h-4" />
                  Sign Up
                </Link>
                <Link
                  href="/sign-in"
                  className="hidden sm:flex items-center gap-2 text-sm font-medium text-[#3363AD] hover:opacity-70 transition-opacity font-['Outfit']"
                >
                  <LogIn className="w-4 h-4" />
                  Sign In
                </Link>
              </>
            )}
            {/* Hamburger — always visible on mobile */}
            <button
              onClick={() => setMenuOpen(v => !v)}
              className="lg:hidden relative flex items-center justify-center w-10 h-10 rounded-full bg-white/70 backdrop-blur-md border border-white/60 text-[#3363AD] transition-all duration-300 hover:bg-white/90"
              aria-label={menuOpen ? "Close menu" : "Open menu"}
            >
              <Menu className={`w-5 h-5 absolute transition-all duration-300 ${menuOpen ? "opacity-0 rotate-90 scale-50" : "opacity-100 rotate-0 scale-100"}`} />
              <X className={`w-5 h-5 absolute transition-all duration-300 ${menuOpen ? "opacity-100 rotate-0 scale-100" : "opacity-0 -rotate-90 scale-50"}`} />
            </button>
          </div>
        </nav>

        {/* Mobile overlay */}
        <div
          className={`lg:hidden fixed inset-0 z-20 transition-opacity duration-300 ${menuOpen ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"}`}
          onClick={() => setMenuOpen(false)}
        >
          <div className="absolute inset-0 bg-[#3363AD]/20 backdrop-blur-sm" />
        </div>

        {/* Mobile drawer */}
        <div className={`lg:hidden fixed top-0 right-0 bottom-0 z-40 w-[85%] max-w-sm bg-white/95 backdrop-blur-xl shadow-2xl transition-transform duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] ${menuOpen ? "translate-x-0" : "translate-x-full"}`}>
          <div className="flex flex-col h-full pt-24 px-8 pb-8">
            <div className="flex flex-col gap-1">
              {navLinks.map((link, i) => (
                <Link
                  key={link.href}
                  href={link.href}
                  onClick={() => setMenuOpen(false)}
                  className={`text-2xl font-semibold text-[#3363AD] py-4 border-b border-[#3363AD]/10 transition-all duration-500 ${menuOpen ? "translate-x-0 opacity-100" : "translate-x-8 opacity-0"}`}
                  style={{ transitionDelay: menuOpen ? `${150 + i * 70}ms` : "0ms" }}
                >
                  {link.label}
                </Link>
              ))}
            </div>
            <div
              className={`mt-8 flex flex-col gap-4 transition-all duration-500 ${menuOpen ? "translate-x-0 opacity-100" : "translate-x-8 opacity-0"}`}
              style={{ transitionDelay: menuOpen ? "400ms" : "0ms" }}
            >
              <Link href="/sign-up" className="flex items-center gap-2 text-sm font-medium text-[#6F6F6F]">
                <UserPlus className="w-4 h-4" /> Sign Up
              </Link>
              <Link href="/sign-in" className="flex items-center gap-2 text-sm font-medium text-[#6F6F6F]">
                <LogIn className="w-4 h-4" /> Sign In
              </Link>
              <DrawOutlineButton
                href={ctaHref}
                accentColor="#3363AD"
                className="mt-2 text-sm font-semibold border border-[#3363AD]/60"
              >
                Get Started
              </DrawOutlineButton>
            </div>
          </div>
        </div>

        {/* HERO */}
        <section className="landing-hero select-none relative overflow-hidden">
          {/* Cohesive Theme Ambient Glows */}
          <div className="absolute top-[-100px] left-[-100px] h-[350px] w-[350px] bg-purple-400/5 blur-[120px] rounded-full pointer-events-none" />
          <div className="absolute bottom-[-100px] right-[-100px] h-[350px] w-[350px] bg-sky-400/5 blur-[120px] rounded-full pointer-events-none" />

          <h1 className="landing-headline gsap-hero-title overflow-hidden flex flex-wrap justify-center gap-x-10 gap-y-3 relative z-10">
            <span className="inline-block">Describe it.</span>
            <span className="inline-block">
              <span className="italic font-['Source_Serif_4'] font-light mr-2">AI</span>
              creates it.
            </span>
            <span className="inline-block">Ship it.</span>
          </h1>
          <p className="landing-description gsap-hero-desc opacity-0">
            Migoo transforms your ideas into studio-quality AI video courses,
            cinematic shorts, and motion graphics — no editing skills required.
          </p>
          <DrawOutlineButton
            href={ctaHref}
            fullWidth={false}
            accentColor="#3363AD"
            className="gsap-hero-cta opacity-0 mt-12 text-base font-semibold px-8 py-4 border border-[#3363AD]/60"
          >
            Start Creating Free
          </DrawOutlineButton>
        </section>

        {/* Bottom-left tag removed */}
      </div>

      </div>{/* end landing-hero-block */}

      {/* ── SELECTED WORKS ─────────────────────────────────────── */}
      <SelectedWorks />

      {/* ── JOURNAL ──────────────────────────────────────────── */}
      <Journal />

      {/* ── VISUAL PLAYGROUND ────────────────────────────────── */}
      <VisualPlayground />

      {/* ── STATS ─────────────────────────────────────────────── */}
      <Stats />

      {/* ── CONTACT / FOOTER ─────────────────────────────────── */}
      <ContactFooter />

    </div>
  );
}