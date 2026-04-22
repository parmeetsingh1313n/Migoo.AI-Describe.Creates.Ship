import AppSidebar from '@/components/AppSidebar'
import { ClerkProviderWrapper } from '@/components/auth/ClerkWrapper'
import GradientBackground from '@/components/GradientBackground'
import { Toaster } from '@/components/ui/sonner'
import type { Metadata } from 'next'
import { Outfit } from 'next/font/google'
import Header from './_components/Header'
import './globals.css'
import Provider from './provider'

const outfit = Outfit({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-outfit',
  preload: true
})

export const metadata: Metadata = {
  title: 'Migoo — Describe It. AI Creates It. Ship It.',
  description: 'Describe It. AI Creates It. Ship It. — Migoo is the AI video creation platform that turns your ideas into studio-quality courses, shorts, and motion graphics.',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en" className={outfit.variable}>
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
      </head>
      <body className={`${outfit.className} antialiased`}>
        <ClerkProviderWrapper>
          <GradientBackground />
          <Header />
          <div className="flex min-h-screen relative z-10">
            <AppSidebar />
            <main className="flex-1 min-w-0">
              <Provider>
                {children}
                <Toaster position='top-center' richColors />
              </Provider>
            </main>
          </div>
        </ClerkProviderWrapper>
      </body>
    </html>
  )
}