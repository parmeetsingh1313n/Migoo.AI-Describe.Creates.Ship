"use client"
import { Button } from '@/components/ui/button';
import { UserButton, useUser } from '@clerk/nextjs';
import Image from 'next/image';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

function Header() {
    const { isSignedIn, isLoaded } = useUser();
    const pathname = usePathname();

    // Hide header on auth pages, motion-graphics project pages, and note viewer pages (they have their own top bar)
    if (pathname === '/sign-in' || pathname === '/sign-up' || /^\/motion-graphics\/[^/]+/.test(pathname) || /^\/notes\/[^/]+/.test(pathname)) {
        return null;
    }

    // When signed in: minimal transparent bar with logo + user avatar
    if (isLoaded && isSignedIn) {
        const isCourseDetailPage = /^\/course\/[^/]+/.test(pathname);

        return (
            <div className={`flex items-center justify-between px-4 py-2 ${isCourseDetailPage ? 'border-b shadow-sm bg-white' : ''}`}>
                {/* Left: Logo */}
                <div className='flex gap-2 items-center'>
                    <Link href="/">
                        <Image src={'/logo.png'} alt='logo' width={90} height={90} />
                    </Link>
                </div>

                {/* Right: User Avatar */}
                <div className='flex items-center ml-auto'>
                    <UserButton afterSignOutUrl="/" />
                </div>
            </div>
        )
    }

    // Show loading state
    if (!isLoaded) {
        return (
            <div className='flex items-center justify-between p-4'>
                <div className='flex gap-2 items-center'>
                    <div className="w-20 h-20 bg-gray-200 rounded animate-pulse"></div>
                </div>
                <div className="w-10 h-10 bg-gray-200 rounded-full animate-pulse"></div>
            </div>
        )
    }

    // Not signed in: classic header
    return (
        <div className='flex items-center justify-between p-4 border-b shadow-sm bg-white'>
            {/* Left: Logo */}
            <div className='flex gap-2 items-center'>
                <Image src={'/logo.png'} alt='logo' width={75} height={75} />
            </div>

            {/* Center: Navigation */}
            <div className='flex gap-8 items-center'>
                <span className='text-lg hover:text-primary transition-colors cursor-pointer'>Home</span>
                <span className='text-lg hover:text-primary transition-colors cursor-pointer'>Price</span>
            </div>

            {/* Right: Auth Button */}
            <div className='flex items-center'>
                <Link href="/sign-in">
                    <Button className="px-6 py-2 bg-primary hover:bg-primary/90">
                        Get Started
                    </Button>
                </Link>
            </div>
        </div>
    )
}

export default Header