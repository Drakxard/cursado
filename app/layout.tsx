import type { Metadata, Viewport } from 'next'
import { Geist, Geist_Mono } from 'next/font/google'
import { Analytics } from '@vercel/analytics/next'
import { AppProviders } from '@/components/app-providers'
import { HomeShortcut } from '@/components/home-shortcut'
import { isLocalStorageMode } from '@/lib/storage-mode'
import './globals.css'

const _geist = Geist({ subsets: ["latin"] });
const _geistMono = Geist_Mono({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: 'Cursado',
  description: 'Gestiona tus materias diarias con esta app interactiva',
  generator: 'v0.app',
  icons: {
    icon: '/icon.svg',
  },
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  const localMode = isLocalStorageMode()

  return (
    <html lang="es" suppressHydrationWarning>
      <body className="bg-background font-sans antialiased">
        <AppProviders localMode={localMode}>{children}</AppProviders>
        <HomeShortcut />
        {!localMode ? <Analytics /> : null}
      </body>
    </html>
  )
}
