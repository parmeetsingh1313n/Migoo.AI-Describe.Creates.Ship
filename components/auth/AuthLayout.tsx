'use client';
import NeumorphismButton from '@/components/ui/NeumorphismButton';
import Image from 'next/image';
import { usePathname, useRouter } from 'next/navigation';
import { createContext, ReactNode, useCallback, useContext, useEffect, useState } from 'react';

// Create context for sharing slide state
const SlideContext = createContext<{
    currentSlide: number;
    setCurrentSlide: (index: number) => void;
}>({
    currentSlide: 0,
    setCurrentSlide: () => { },
});

const slides = [
    {
        id: 1,
        title: "AI Course Generator",
        description: "Create complete video courses with AI in minutes. From script to final video.",
        stats: "Professional Quality",
        image: "/signin-img/course.jpg",
        color: "from-purple-500 to-indigo-500"
    },
    {
        id: 2,
        title: "Smart Ad Creation",
        description: "Generate promotional content automatically. AI creates engaging ads for your courses.",
        stats: "High Conversion",
        image: "/signin-img/ad-creation.jpg",
        color: "from-orange-500 to-pink-500"
    },
    {
        id: 3,
        title: "Quiz & Test Builder",
        description: "Create interactive assessments with AI. Automatic grading and instant feedback.",
        stats: "Student Engagement",
        image: "/signin-img/quiz.jpg",
        color: "from-emerald-500 to-teal-500"
    },
    {
        id: 4,
        title: "YouTube Automation",
        description: "AI agents handle video uploads and playlist management automatically.",
        stats: "Time Saving",
        image: "/signin-img/automation.jpg",
        color: "from-red-500 to-rose-500"
    },
    {
        id: 5,
        title: "24/7 AI Support",
        description: "Voice and text chatbots trained on your course content. Answer student questions anytime.",
        stats: "Always Available",
        image: "/signin-img/ai-support.jpg",
        color: "from-yellow-200 to-green-yellow-500"
    },
    {
        id: 6,
        title: "Viral Shorts Generator",
        description: "Transform courses into engaging short-form content. Perfect for social media.",
        stats: "Maximum Reach",
        image: "/signin-img/viral-shorts.jpg",
        color: "from-violet-500 to-fuchsia-500"
    }
];

// Array of beautiful slide animations
const slideAnimations = [
    'animate-slide-in-right',
    'animate-slide-in-left',
    'animate-slide-in-up',
    'animate-slide-in-down',
    'animate-zoom-in',
    'animate-flip-in',
    'animate-fade-in-blur',
    'animate-rotate-in',
    'animate-bounce-in'
];

interface AuthLayoutProps {
    children: ReactNode;
}

export default function AuthLayout({ children }: AuthLayoutProps) {
    const pathname = usePathname();
    const isSignIn = pathname.includes('/sign-in');
    const [currentSlide, setCurrentSlide] = useState(0);

    return (
        <SlideContext.Provider value={{ currentSlide, setCurrentSlide }}>
            <div className="relative h-screen w-full overflow-hidden bg-background">
                {/* Background image from carousel - BLURRED */}
                <div className="absolute inset-0 z-0">
                    <Image
                        key={currentSlide}
                        src={slides[currentSlide].image}
                        alt="Background"
                        fill
                        className="object-cover blur-3xl opacity-20 transition-opacity duration-1000"
                        priority
                    />
                    {/* Gradient overlay */}
                    <div className="absolute inset-0 bg-gradient-to-br from-background/90 via-background/70 to-background/90" />
                </div>

                {/* Original background effects for left panel */}
                <div className="absolute inset-0 z-0">
                    <div className="absolute inset-0 bg-gradient-to-br from-primary/5 via-background to-accent/5" />
                    <div className="absolute top-20 left-10 w-72 h-72 bg-primary/10 rounded-full blur-3xl animate-float" />
                    <div className="absolute bottom-20 right-10 w-72 h-72 bg-accent/10 rounded-full blur-3xl animate-float-delayed" />
                    <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-80 h-80 bg-secondary/5 rounded-full blur-3xl animate-pulse-slow" />
                </div>

                {/* Main content */}
                <div className="flex h-full w-full relative z-10">
                    {/* Left panel - Auth forms */}
                    <div className="flex flex-col items-center justify-center w-full lg:w-2/5 px-4 py-4 relative">
                        {/* SIGNIN BACKGROUND IMAGE - ADDED HERE */}
                        <div
                            className="absolute inset-0 bg-cover bg-center bg-no-repeat opacity-10 mix-blend-overlay"
                            style={{
                                backgroundImage: `url('/signin-background.png')`
                            }}
                        />

                        {/* Content on top of background */}
                        <div className="w-full max-w-sm relative z-10">
                            {children}
                        </div>
                    </div>

                    {/* Right panel - Carousel (with integrated header) */}
                    <div className="hidden lg:flex relative w-3/5 h-full">
                        <CarouselSection />
                    </div>
                </div>
            </div>
        </SlideContext.Provider>
    );
}

// Enhanced Carousel Section Component
function CarouselSection() {
    const { currentSlide, setCurrentSlide } = useContext(SlideContext);
    const [isAnimating, setIsAnimating] = useState(false);
    const [progress, setProgress] = useState(0);
    const [currentAnimation, setCurrentAnimation] = useState('animate-slide-in-right');
    const pathname = usePathname();
    const isSignIn = pathname.includes('/sign-in');
    const router = useRouter();

    const getRandomAnimation = useCallback(() => {
        const randomIndex = Math.floor(Math.random() * slideAnimations.length);
        return slideAnimations[randomIndex];
    }, []);

    const goToSlide = useCallback((index: number) => {
        if (isAnimating || index === currentSlide) return;
        setIsAnimating(true);

        // Set random animation for the new slide
        setCurrentAnimation(getRandomAnimation());

        setTimeout(() => {
            setCurrentSlide(index);
            setProgress(0);
            setTimeout(() => setIsAnimating(false), 1200);
        }, 100);
    }, [currentSlide, isAnimating, getRandomAnimation, setCurrentSlide]);

    const nextSlide = useCallback(() => {
        if (isAnimating) return;
        const next = (currentSlide + 1) % slides.length;
        goToSlide(next);
    }, [currentSlide, isAnimating, goToSlide]);

    const prevSlide = useCallback(() => {
        if (isAnimating) return;
        const prev = currentSlide === 0 ? slides.length - 1 : currentSlide - 1;
        goToSlide(prev);
    }, [currentSlide, isAnimating, goToSlide]);

    // Auto-rotate slides every 6 seconds
    useEffect(() => {
        const interval = setInterval(() => {
            if (!isAnimating) {
                nextSlide();
            }
        }, 6000);

        return () => clearInterval(interval);
    }, [currentSlide, isAnimating, nextSlide]);

    // Progress bar animation
    useEffect(() => {
        if (isAnimating) return;

        const startTime = Date.now();
        const duration = 6000;

        const updateProgress = () => {
            const elapsed = Date.now() - startTime;
            const currentProgress = Math.min((elapsed / duration) * 100, 100);
            setProgress(currentProgress);

            if (currentProgress < 100) {
                requestAnimationFrame(updateProgress);
            }
        };

        requestAnimationFrame(updateProgress);

        return () => { };
    }, [currentSlide, isAnimating]);

    const slide = slides[currentSlide];

    // Get the color classes for current slide
    const gradientColors = slide.color;

    return (
        <div className="relative h-full w-full overflow-hidden">
            {/* Dynamic background gradient - USING SLIDE COLORS */}
            <div className={`absolute inset-0 bg-gradient-to-br ${gradientColors} transition-all duration-1000`}>
                <div className="absolute inset-0 opacity-40">
                    <div className="absolute top-0 left-0 w-96 h-96 bg-white/30 rounded-full blur-3xl animate-blob"></div>
                    <div className="absolute bottom-0 right-0 w-96 h-96 bg-white/20 rounded-full blur-3xl animate-blob animation-delay-2000"></div>
                    <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-96 h-96 bg-white/25 rounded-full blur-3xl animate-blob animation-delay-4000"></div>
                </div>

            </div>

            {/* Header integrated into carousel */}
            <header className="absolute top-0 left-0 w-full z-50 px-8 py-6 mb-8"> {/* Added mb-8 */}
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <span className="text-xl font-semibold text-white drop-shadow-lg">
                            {/* Brand name removed */}
                        </span>
                    </div>

                    <NeumorphismButton
                        onClick={() => router.push(isSignIn ? '/sign-up' : '/sign-in')}
                        className="bg-white/10 backdrop-blur-sm border border-white/20 hover:border-white/40 mb-2" // Added mb-2
                        withIcon={false}
                    >
                        {isSignIn ? 'Create Account' : 'Sign In'}
                    </NeumorphismButton>
                </div>
            </header>

            <div className="relative h-full w-full flex flex-col items-center justify-center p-4 md:p-8 pt-16">
                {/* Carousel container */}
                <div className="relative w-full max-w-4xl">
                    {/* Side preview images with dynamic colors */}
                    <div className="absolute left-0 top-1/2 -translate-y-1/2 -translate-x-32 w-48 h-36 rounded-2xl overflow-hidden opacity-30 blur-sm transition-all duration-700 cursor-pointer hover:opacity-70 hover:blur-0 hover:scale-110 z-20">
                        <div className={`absolute inset-0 bg-gradient-to-br ${slides[currentSlide === 0 ? slides.length - 1 : currentSlide - 1].color} opacity-20`}></div>
                        <Image
                            src={slides[currentSlide === 0 ? slides.length - 1 : currentSlide - 1].image}
                            alt={slides[currentSlide === 0 ? slides.length - 1 : currentSlide - 1].title}
                            fill
                            className="object-cover"
                            sizes="192px"
                        />
                    </div>

                    <div className="absolute right-0 top-1/2 -translate-y-1/2 translate-x-32 w-48 h-36 rounded-2xl overflow-hidden opacity-30 blur-sm transition-all duration-700 cursor-pointer hover:opacity-70 hover:blur-0 hover:scale-110 z-20">
                        <div className={`absolute inset-0 bg-gradient-to-br ${slides[(currentSlide + 1) % slides.length].color} opacity-20`}></div>
                        <Image
                            src={slides[(currentSlide + 1) % slides.length].image}
                            alt={slides[(currentSlide + 1) % slides.length].title}
                            fill
                            className="object-cover"
                            sizes="192px"
                        />
                    </div>

                    {/* Main Carousel with enhanced effects */}
                    <div className="relative aspect-[16/9] rounded-3xl overflow-hidden scale-90">
                        {/* Animated rotating border with moving sparkles */}
                        <div className="absolute inset-0 rounded-3xl p-[4px] overflow-hidden">
                            {/* Moving sparkle on border */}
                            <div className="absolute top-0 left-0 w-6 h-6 rounded-full bg-white shadow-lg shadow-white/50 animate-border-sparkle"></div>
                            <div className="absolute bottom-0 right-0 w-6 h-6 rounded-full bg-white shadow-lg shadow-white/50 animate-border-sparkle animation-delay-2000"></div>

                            {/* Rotating gradient border */}
                            <div className="absolute inset-0 rounded-3xl" style={{
                                background: `linear-gradient(135deg, rgba(255,255,255,0.3), transparent, rgba(255,255,255,0.3))`,
                                animation: 'rotate-border 4s linear infinite'
                            }}>
                                <div className="absolute inset-0 rounded-3xl bg-black/20 backdrop-blur-sm"></div>
                            </div>

                            {/* Glow effect */}
                            <div className="absolute -inset-4 rounded-3xl opacity-50 blur-3xl" style={{
                                background: `linear-gradient(135deg, rgba(255,255,255,0.3), transparent, rgba(255,255,255,0.3))`,
                                animation: 'pulse-glow 3s ease-in-out infinite'
                            }}></div>

                            {/* Star twinkle effects on border */}
                            <div className="absolute top-2 left-2 w-3 h-3 rounded-full bg-white animate-star-twinkle"></div>
                            <div className="absolute top-2 right-2 w-3 h-3 rounded-full bg-white animate-star-twinkle animation-delay-300"></div>
                            <div className="absolute bottom-2 left-2 w-3 h-3 rounded-full bg-white animate-star-twinkle animation-delay-600"></div>
                            <div className="absolute bottom-2 right-2 w-3 h-3 rounded-full bg-white animate-star-twinkle animation-delay-900"></div>

                            {/* Middle border sparkles */}
                            <div className="absolute top-1/2 left-2 w-2 h-2 rounded-full bg-white animate-star-twinkle animation-delay-400"></div>
                            <div className="absolute top-1/2 right-2 w-2 h-2 rounded-full bg-white animate-star-twinkle animation-delay-700"></div>
                            <div className="absolute top-2 left-1/2 w-2 h-2 rounded-full bg-white animate-star-twinkle animation-delay-500"></div>
                            <div className="absolute bottom-2 left-1/2 w-2 h-2 rounded-full bg-white animate-star-twinkle animation-delay-800"></div>

                            {/* Shimmer effect */}
                            <div className="absolute inset-0 overflow-hidden">
                                <div className="absolute -inset-[200%] rotate-45 bg-gradient-to-r from-transparent via-white/5 to-transparent animate-shimmer"></div>
                            </div>

                            {/* Main content */}
                            <div className="absolute inset-[4px] rounded-[24px] overflow-hidden border-2 border-white/20 backdrop-blur-xl"
                                style={{
                                    boxShadow: `
                                        inset 0 0 30px rgba(255, 255, 255, 0.1),
                                        inset 0 0 60px var(--shadow-color, rgba(99, 102, 241, 0.2)),
                                        0 0 80px var(--shadow-color, rgba(99, 102, 241, 0.4)),
                                        0 0 120px var(--shadow-color, rgba(99, 102, 241, 0.2))
                                    `
                                }}
                            >
                                {/* Current slide with random animation */}
                                <div
                                    className={`relative w-full h-full ${currentAnimation}`}
                                    style={{
                                        animationDuration: '1.2s'
                                    }}
                                >
                                    <Image
                                        src={slide.image}
                                        alt={slide.title}
                                        fill
                                        className="object-cover transition-opacity duration-700"
                                        priority
                                        sizes="(max-width: 768px) 100vw, 50vw"
                                    />

                                    {/* Dynamic gradient overlay based on slide color */}
                                    <div className={`absolute inset-0 bg-gradient-to-t from-black/80 via-black/40 to-transparent`}>
                                        <div className={`absolute inset-0 bg-gradient-to-br ${gradientColors} opacity-10`}></div>
                                    </div>

                                    {/* Content */}
                                    <div className="absolute bottom-0 left-0 right-0 p-6 md:p-8">
                                        <div
                                            className="animate-fade-in-up animation-delay-400"
                                            style={{
                                                animationDuration: '1s'
                                            }}
                                        >
                                            <div className="flex items-center gap-3 mb-3">
                                                <div className="w-2 h-8 rounded-full bg-gradient-to-b from-white/60 to-white/30"></div>
                                                <h3 className="text-2xl md:text-3xl font-bold text-white drop-shadow-2xl">
                                                    {slide.title}
                                                </h3>
                                            </div>
                                            <p className="text-white/90 text-sm md:text-base mb-6 max-w-xl drop-shadow-lg">
                                                {slide.description}
                                            </p>
                                            <div className="flex items-center gap-4">
                                                <div className="flex items-center gap-2">
                                                    <div className="w-8 h-8 rounded-full bg-white/20 backdrop-blur-sm flex items-center justify-center">
                                                        <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                                                        </svg>
                                                    </div>
                                                    <span className="text-white/80 text-sm font-medium drop-shadow">
                                                        {slide.stats}
                                                    </span>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Navigation Controls */}
                    <div className="flex items-center justify-center gap-6 mt-10">
                        <button
                            onClick={prevSlide}
                            disabled={isAnimating}
                            className="w-12 h-12 rounded-full bg-white/10 backdrop-blur-sm border border-white/20 hover:bg-white/20 hover:scale-110 transition-all duration-300 flex items-center justify-center disabled:opacity-50 disabled:cursor-not-allowed shadow-xl"
                            aria-label="Previous slide"
                        >
                            <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                            </svg>
                        </button>

                        {/* Indicators with progress */}
                        <div className="flex gap-2">
                            {slides.map((slideItem, index) => (
                                <button
                                    key={slideItem.id}
                                    onClick={() => goToSlide(index)}
                                    disabled={isAnimating}
                                    className={`relative rounded-full overflow-hidden transition-all duration-500 ${index === currentSlide
                                        ? 'w-10 h-2 bg-white shadow-lg shadow-white/50'
                                        : 'w-2 h-2 bg-white/40 hover:bg-white/60 hover:scale-125'
                                        }`}
                                    aria-label={`Go to slide ${index + 1}`}
                                >
                                    {index === currentSlide && (
                                        <div
                                            className="absolute inset-0 bg-white/50"
                                            style={{
                                                width: `${progress}%`,
                                                transition: 'width 100ms linear'
                                            }}
                                        ></div>
                                    )}
                                </button>
                            ))}
                        </div>

                        <button
                            onClick={nextSlide}
                            disabled={isAnimating}
                            className="w-12 h-12 rounded-full bg-white/10 backdrop-blur-sm border border-white/20 hover:bg-white/20 hover:scale-110 transition-all duration-300 flex items-center justify-center disabled:opacity-50 disabled:cursor-not-allowed shadow-xl"
                            aria-label="Next slide"
                        >
                            <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                            </svg>
                        </button>
                    </div>
                </div>

                {/* Carousel info */}
                <div className="mt-8 text-center">
                    <p className="text-black/60 text-lg font-semibold drop-shadow-lg">
                        Discover AI-powered education tools
                    </p>
                </div>
            </div>
        </div>
    );
}

// Helper function to extract color from gradient string
function getColorFromGradient(gradientString: string) {
    const colors = gradientString.match(/from-(\S+)\s+to-(\S+)/);
    if (colors) {
        const colorMap: { [key: string]: string } = {
            'emerald-500': '#10b981',
            'teal-500': '#14b8a6',
            'orange-500': '#f97316',
            'pink-500': '#ec4899',
            'purple-500': '#8b5cf6',
            'indigo-500': '#6366f1',
            'red-500': '#ef4444',
            'rose-500': '#f43f5e',
            'green-yellow-500': '#ADFF2F',
            'yellow-200': '#FFFF00',
            'violet-500': '#8b5cf6',
            'fuchsia-500': '#d946ef',
        };

        const fromColor = colorMap[colors[1]] || '#6366f1';
        const toColor = colorMap[colors[2]] || '#8b5cf6';

        return `${fromColor}, ${toColor}`;
    }
    return '#6366f1, #8b5cf6';
}