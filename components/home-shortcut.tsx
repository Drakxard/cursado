"use client"

import { useEffect, useState } from 'react'
import { usePathname } from 'next/navigation'
import { returnToHome, trackHomeWrites } from '@/lib/client/home-navigation'

export function HomeShortcut() {
  const pathname = usePathname()
  const [error, setError] = useState('')
  useEffect(() => {
    setError('')
    if (pathname === '/') return
    const attached = new Map<Document, () => void>()
    const key = (event: KeyboardEvent) => {
      if (!event.ctrlKey || event.altKey || event.shiftKey || event.key.toLowerCase() !== 'q' || event.repeat) return
      event.preventDefault()
      event.stopImmediatePropagation()
      void returnToHome()
    }
    const scan = (current: Window) => {
      try {
        const doc = current.document
        if (!attached.has(doc)) {
          doc.addEventListener('keydown', key, true)
          const untrack = trackHomeWrites(current)
          const refresh = () => scan(current)
          const observer = new MutationObserver(refresh)
          observer.observe(doc, { childList: true, subtree: true })
          doc.addEventListener('load', refresh, true)
          attached.set(doc, () => { doc.removeEventListener('keydown', key, true); doc.removeEventListener('load', refresh, true); observer.disconnect(); untrack() })
        }
        current.document.querySelectorAll('iframe').forEach(frame => { if (frame.contentWindow) scan(frame.contentWindow) })
      } catch { /* Sandboxed explanation frames use the explicit message bridge. */ }
    }
    const message = (event: MessageEvent) => {
      if (event.data?.type !== 'cursado-return-home') return
      // Only accept the bridge from a currently embedded document.
      const containsSource = (current: Window): boolean => {
        try { return [...current.document.querySelectorAll('iframe')].some(frame => frame.contentWindow === event.source || (frame.contentWindow && containsSource(frame.contentWindow))) }
        catch { return false }
      }
      if (containsSource(window)) void returnToHome()
    }
    const showError = (event: Event) => setError((event as CustomEvent<string>).detail)
    scan(window)
    const observer = new MutationObserver(() => scan(window))
    observer.observe(document.body, { childList: true, subtree: true })
    const loaded = () => scan(window)
    document.addEventListener('load', loaded, true)
    window.addEventListener('message', message)
    window.addEventListener('cursado-home-error', showError)
    return () => {
      observer.disconnect()
      attached.forEach(remove => remove())
      document.removeEventListener('load', loaded, true)
      window.removeEventListener('message', message)
      window.removeEventListener('cursado-home-error', showError)
    }
  }, [pathname])
  return error ? <div role="alert" className="fixed bottom-4 left-4 right-4 z-[200] rounded-xl bg-red-100 p-4 text-red-950">{error} <button className="ml-3 underline" onClick={() => setError('')}>Cerrar</button></div> : null
}
