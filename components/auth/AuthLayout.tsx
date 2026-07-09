'use client';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { ReactNode } from 'react';
import { ArrowLeft, BookOpen, Wand2 } from 'lucide-react';

const AUTH_VIDEO =
    "https://d8j0ntlcm91z4.cloudfront.net/user_38xzZboKViGWJOttwIXH07lWA1P/hf_20260315_073750_51473149-4350-4920-ae24-c8214286f323.mp4";

interface AuthLayoutProps {
    children: ReactNode;
}

export default function AuthLayout({ children }: AuthLayoutProps) {
    const pathname = usePathname();
    const router = useRouter();
    const isSignIn = pathname.includes('/sign-in');

    return (
        <div className="relative h-screen w-full overflow-hidden bg-black">
            {/* ── Video background ─────────────────────────────── */}
            <video
                autoPlay
                loop
                muted
                playsInline
                className="absolute inset-0 w-full h-full object-cover z-0"
            >
                <source src={AUTH_VIDEO} type="video/mp4" />
            </video>

            {/* Dark overlay */}
            <div className="absolute inset-0 z-[1] bg-black/40" />

            {/* ── Main layout ──────────────────────────────────── */}
            <div className="relative z-10 flex h-full w-full">

                {/* ════ LEFT PANEL ════ */}
                <div className="relative flex flex-col w-full lg:w-[52%] h-full">
                    {/* Subtle glass card behind content */}
                    <div
                        className="absolute inset-4 lg:inset-6 rounded-3xl pointer-events-none"
                        style={{
                            background: 'rgba(0, 0, 0, 0.15)',
                            backdropFilter: 'blur(2px)',
                            WebkitBackdropFilter: 'blur(2px)',
                            overflow: 'hidden',
                        }}
                    >
                        <div
                            className="absolute inset-0 rounded-3xl"
                            style={{
                                padding: '1px',
                                background: 'linear-gradient(160deg, rgba(255,255,255,0.15) 0%, transparent 40%, transparent 60%, rgba(255,255,255,0.1) 100%)',
                                WebkitMask: 'linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0)',
                                WebkitMaskComposite: 'xor',
                                maskComposite: 'exclude',
                            }}
                        />
                    </div>

                    {/* Nav */}
                    <nav className="relative z-20 flex items-center justify-between px-8 lg:px-10 pt-8 lg:pt-10">
                        <div /> {/* spacer */}
                        <button
                            onClick={() => router.push(isSignIn ? '/sign-up' : '/sign-in')}
                            className="auth-liquid-glass rounded-full px-5 py-2.5 text-white/80 text-sm font-medium font-['Outfit'] hover:text-white hover:scale-105 transition-all duration-300 cursor-pointer"
                        >
                            {isSignIn ? 'Create Account' : 'Sign In'}
                        </button>
                    </nav>

                    {/* Auth form — centered when it fits, scrollable when taller
                        than the viewport (e.g. the sign-up form at 100% zoom) so
                        the submit button is never clipped off the bottom. */}
                    <div className="auth-scroll relative z-20 flex-1 flex flex-col items-center overflow-y-auto min-h-0 px-4 lg:px-8">
                        <div className="w-full max-w-md mx-auto my-auto py-4">
                            {children}
                        </div>
                    </div>

                    {/* Bottom quote */}
                    <div className="relative z-20 px-8 lg:px-10 pb-8 lg:pb-10">
                        <p className="text-xs tracking-[0.3em] uppercase text-white/40 mb-2 font-['Outfit']">
                            Visionary Design
                        </p>
                        <p className="text-white/60 text-sm font-['Outfit'] leading-relaxed">
                            <span className="italic font-['Source_Serif_4']">&ldquo;Describe it. </span>
                            <span className="font-['Outfit']">AI creates it. </span>
                            <span className="italic font-['Source_Serif_4']">Ship it.&rdquo;</span>
                        </p>
                    </div>
                </div>

                {/* ════ RIGHT PANEL (desktop only) ════ */}
                <div className="hidden lg:flex flex-col w-[48%] h-full p-6 relative">

                    {/* Top bar — Back to Home on right */}
                    <div className="relative z-20 flex items-center justify-end mb-6">
                        <Link
                            href="/"
                            className="auth-liquid-glass rounded-full flex items-center gap-2 px-5 py-2.5 cursor-pointer hover:scale-105 transition-all duration-200 group"
                        >
                            <ArrowLeft className="w-4 h-4 text-white/70 group-hover:text-white transition-colors" />
                            <span className="text-white/60 text-sm font-['Outfit'] group-hover:text-white/90 transition-colors">Back to Home</span>
                        </Link>
                    </div>

                    {/* Center hero text */}
                    <div className="flex-1 flex flex-col items-center justify-center relative z-20">
                        <h1 className="text-6xl xl:text-7xl font-medium text-white tracking-[-0.05em] text-center leading-[1.1] font-['Poppins']">
                            Innovating the
                            <br />
                            <span className="italic text-white/80 font-['Source_Serif_4']">spirit of </span>
                            <span className="text-white font-['Poppins']">Migoo</span>
                        </h1>

                        <p className="text-white/50 text-sm mt-6 text-center max-w-md font-['Outfit']">
                            Transform your ideas into studio-quality AI video courses,
                            cinematic shorts, and motion graphics.
                        </p>

                        {/* Feature pills */}
                        <div className="flex items-center gap-3 mt-8">
                            {['AI Courses', 'Video Studio', 'Smart Notes'].map((label) => (
                                <span
                                    key={label}
                                    className="auth-liquid-glass rounded-full px-4 py-2 text-xs text-white/70 font-['Outfit'] hover:text-white hover:scale-105 transition-all duration-300 cursor-default"
                                >
                                    {label}
                                </span>
                            ))}
                        </div>
                    </div>

                    {/* ── Bottom feature cards ── */}
                    <div className="relative z-20 mt-auto">
                        <div className="auth-liquid-glass rounded-[2rem] p-4">
                            <div className="grid grid-cols-2 gap-3">

                                {/* Processing card */}
                                <div className="auth-liquid-glass rounded-2xl p-5">
                                    <div className="flex items-center gap-3 mb-3">
                                        <div className="w-9 h-9 rounded-xl bg-white/10 flex items-center justify-center flex-shrink-0">
                                            <Wand2 className="w-4 h-4 text-white/80" />
                                        </div>
                                        <h3 className="text-white text-sm font-semibold font-['Outfit'] leading-tight">Processing</h3>
                                    </div>
                                    <p className="text-white/50 text-xs font-['Outfit'] leading-relaxed">
                                        High-end processing functions that bring floral beauty to form
                                    </p>
                                </div>

                                {/* Growth Archive card */}
                                <div className="auth-liquid-glass rounded-2xl p-5">
                                    <div className="flex items-center gap-3 mb-3">
                                        <div className="w-9 h-9 rounded-xl bg-white/10 flex items-center justify-center flex-shrink-0">
                                            <BookOpen className="w-4 h-4 text-white/80" />
                                        </div>
                                        <h3 className="text-white text-sm font-semibold font-['Outfit'] leading-tight">Growth Archive</h3>
                                    </div>
                                    <p className="text-white/50 text-xs font-['Outfit'] leading-relaxed">
                                        Set-up templates and choices for different plant varieties
                                    </p>
                                </div>

                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}