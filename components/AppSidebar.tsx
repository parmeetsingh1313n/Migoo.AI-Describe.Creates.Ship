"use client"
import { useUser } from '@clerk/nextjs'
import Image from 'next/image'
import {
    ChevronLeft,
    ChevronRight,
    Clapperboard,
    Menu,
    Sparkles,
    Video,
    Wand2,
    X,
} from 'lucide-react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useState } from 'react'

interface NavItem {
    label: string
    href: string
    icon: React.ReactNode
    description: string
    badge?: string
}

const navItems: NavItem[] = [
    {
        label: 'Video Course',
        href: '/',
        icon: <Video className="w-5 h-5" />,
        description: 'Generate full AI courses',
    },
    {
        label: 'Short Generator',
        href: '/short-generator',
        icon: <Clapperboard className="w-5 h-5" />,
        description: 'Create viral short series',
    },
    {
        label: 'Motion Graphics',
        href: '/motion-graphics',
        icon: <Wand2 className="w-5 h-5" />,
        description: 'AI animated promo videos',
        badge: '✨',
    },
    {
        label: 'Migoo Studio',
        href: '/studio',
        icon: <Sparkles className="w-5 h-5" />,
        description: "Director's Chair",
        badge: '⚡',
    },
]

function AppSidebar() {
    const { isSignedIn, isLoaded } = useUser()
    const pathname = usePathname()
    const [collapsed, setCollapsed] = useState(false)
    const [mobileOpen, setMobileOpen] = useState(false)

    // Hide sidebar on auth pages and course detail pages
    const isAuthPage = pathname === '/sign-in' || pathname === '/sign-up'
    const isCourseDetailPage = /^\/course\/[^/]+/.test(pathname)

    // Close mobile sidebar on route change
    useEffect(() => {
        setMobileOpen(false)
    }, [pathname])

    if (!isLoaded || !isSignedIn || isAuthPage || isCourseDetailPage) return null

    const isActive = (href: string) => {
        if (href === '/') return pathname === '/'
        return pathname.startsWith(href)
    }

    const isMotionProjectPage = /^\/motion-graphics\/[^/]+/.test(pathname)

    const sidebarContent = (
        <div className="flex flex-col h-full">
            {/* Migoo Logo — only shown on motion-graphics project pages (global header is hidden there) */}
            {isMotionProjectPage && (
                <div className={`flex items-center ${collapsed ? 'justify-center px-2' : 'justify-start px-4'} py-3 border-b border-border/60`}>
                    <Link href="/">
                        <Image src="/logo.png" alt="Migoo" width={collapsed ? 32 : 80} height={collapsed ? 32 : 40} className="object-contain" />
                    </Link>
                </div>
            )}

            {/* Navigation */}
            <nav className="flex-1 px-3 py-2 space-y-1">
                {!collapsed && (
                    <p className="text-[11px] uppercase font-semibold text-muted-foreground tracking-wider px-3 mb-3">
                        Create
                    </p>
                )}
                {navItems.map((item) => {
                    const active = isActive(item.href)
                    return (
                        <Link
                            key={item.href}
                            href={item.href}
                            className={`
                                group flex items-center ${collapsed ? 'justify-center' : 'gap-3'} 
                                px-3 py-2.5 rounded-xl text-sm font-medium cursor-pointer
                                transition-all duration-200 relative overflow-hidden
                                ${active
                                    ? 'bg-gradient-to-r from-primary/15 to-accent/10 text-primary shadow-sm border border-primary/10'
                                    : 'text-muted-foreground hover:text-foreground hover:bg-muted/60'
                                }
                            `}
                            title={collapsed ? item.label : undefined}
                        >
                            {/* Active indicator */}
                            {active && (
                                <div className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-5 bg-primary rounded-r-full" />
                            )}

                            <span className={`flex-shrink-0 ${active ? 'text-primary' : 'text-muted-foreground group-hover:text-foreground'} transition-colors`}>
                                {item.icon}
                            </span>

                            {!collapsed && (
                                <div className="overflow-hidden flex-1">
                                    <div className="flex items-center gap-1.5">
                                        <p className="truncate">{item.label}</p>
                                        {item.badge && (
                                            <span className="text-[9px] leading-none px-1 py-0.5 rounded-full bg-violet-500/20 text-violet-400 border border-violet-400/30 font-bold shrink-0">
                                                {item.badge}
                                            </span>
                                        )}
                                    </div>
                                    <p className={`text-[10px] truncate ${active ? 'text-primary/60' : 'text-muted-foreground/60'}`}>
                                        {item.description}
                                    </p>
                                </div>
                            )}

                            {/* Hover shimmer */}
                            {!active && (
                                <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-300">
                                    <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/5 to-transparent translate-x-[-100%] group-hover:translate-x-[100%] transition-transform duration-700" />
                                </div>
                            )}
                        </Link>
                    )
                })}
            </nav>

            {/* Bottom section */}
            <div className="px-3 pb-4">
                <div className={`
                    flex items-center ${collapsed ? 'justify-center' : 'gap-2'} 
                    px-3 py-2 rounded-xl bg-gradient-to-r from-primary/5 to-accent/5 
                    border border-primary/5
                `}>
                    <Sparkles className="w-4 h-4 text-primary flex-shrink-0" />
                    {!collapsed && (
                        <p className="text-[11px] text-muted-foreground">
                            <span className="font-medium text-foreground">Pro Features</span> coming soon
                        </p>
                    )}
                </div>
            </div>

            {/* Collapse Toggle (desktop only) */}
            <button
                onClick={() => setCollapsed(!collapsed)}
                className="hidden md:flex items-center justify-center p-2 mx-3 mb-3 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-all duration-200 cursor-pointer"
            >
                {collapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
            </button>
        </div>
    )

    return (
        <>
            {/* Mobile Hamburger Button */}
            <button
                onClick={() => setMobileOpen(true)}
                className="md:hidden fixed top-4 left-4 z-50 p-2 rounded-xl bg-white/80 backdrop-blur-sm border border-border shadow-sm hover:bg-white transition-all cursor-pointer"
            >
                <Menu className="w-5 h-5" />
            </button>

            {/* Mobile Overlay */}
            {mobileOpen && (
                <div
                    className="md:hidden fixed inset-0 bg-black/40 backdrop-blur-sm z-40"
                    onClick={() => setMobileOpen(false)}
                />
            )}

            {/* Mobile Sidebar */}
            <aside
                className={`
                    md:hidden fixed top-0 left-0 bottom-0 z-50 w-64
                    bg-white/95 backdrop-blur-xl border-r border-border
                    shadow-2xl shadow-primary/5
                    transform transition-transform duration-300 ease-out
                    ${mobileOpen ? 'translate-x-0' : '-translate-x-full'}
                `}
            >
                <button
                    onClick={() => setMobileOpen(false)}
                    className="absolute top-4 right-4 p-1 rounded-lg hover:bg-muted transition-colors cursor-pointer"
                >
                    <X className="w-5 h-5" />
                </button>
                {sidebarContent}
            </aside>

            {/* Desktop Sidebar */}
            <aside
                className={`
                    hidden md:flex flex-col flex-shrink-0
                    ${collapsed ? 'w-[72px]' : 'w-[220px]'}
                    bg-white/80 backdrop-blur-xl
                    border-r border-border/60
                    transition-all duration-300 ease-out
                    h-screen sticky top-0
                `}
            >
                {sidebarContent}
            </aside>
        </>
    )
}

export default AppSidebar
