import AppSidebar from '@/components/AppSidebar'
import { ClerkProviderWrapper } from '@/components/auth/ClerkWrapper'
import GradientBackground from '@/components/GradientBackground'
import { Toaster } from '@/components/ui/sonner'
import type { Metadata } from 'next'
import { Instrument_Serif, Outfit } from 'next/font/google'
import Header from './_components/Header'
import './globals.css'
import Provider from './provider'

const outfit = Outfit({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-outfit',
  preload: true
})

const instrumentSerif = Instrument_Serif({
  subsets: ['latin'],
  display: 'swap',
  weight: '400',
  style: ['normal', 'italic'],
  variable: '--font-instrument',
  preload: true,
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
    <html lang="en" className={`${outfit.variable} ${instrumentSerif.variable}`}>
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://db.onlinewebfonts.com/c/6e47ef470dd19698c911332a9b4d1cf4?family=Neue+Haas+Grotesk+Text+Pro" rel="stylesheet" />
        <link href="https://db.onlinewebfonts.com/c/dec0d9b4e22ca588dc20e1e2e09a59b5?family=Neue+Haas+Grotesk+Display+Pro+55+Roman" rel="stylesheet" />
        <link href="https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&display=swap" rel="stylesheet" />
        <link href="https://fonts.googleapis.com/css2?family=DM+Sans:opsz,wght@9..40,100..1000&display=swap" rel="stylesheet" />
        <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Material+Symbols+Rounded:opsz,wght,FILL,GRAD@24,400,1,0" />
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