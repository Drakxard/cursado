"use client"

import { usePathname } from 'next/navigation'
import { LocalWorkspaceProvider } from '@/components/local-workspace-provider'
import { ThemeProvider } from '@/components/theme-provider'
import { Toaster } from '@/components/ui/toaster'

export function AppProviders({ children, localMode }: { children: React.ReactNode; localMode: boolean }) {
  const pathname = usePathname()
  // The launcher never prompts for a study folder or starts its services.
  if (pathname === '/') return children
  return <LocalWorkspaceProvider enabled={localMode}>
    <ThemeProvider attribute="data-theme" defaultTheme="daylight" enableSystem={false} disableTransitionOnChange>
      {children}
      <Toaster />
    </ThemeProvider>
  </LocalWorkspaceProvider>
}
