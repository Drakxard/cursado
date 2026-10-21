"use client"

import { useEffect, useState } from 'react'
import { usePathname } from 'next/navigation'
import { returnToHome, trackHomeWrites } from '@/lib/client/home-navigation'
import { observeHomeFrames } from '@/lib/client/home-frame-observer'

export function HomeShortcut() {
  const pathname = usePathname()
  const [error, setError] = useState('')
  useEffect(() => {
    setError('')
    if (pathname === '/') return
    const key = (event: KeyboardEvent) => {
      if (!event.ctrlKey || event.altKey || event.shiftKey || event.key.toLowerCase() !== 'q' || event.repeat) return
      event.preventDefault()
      event.stopImmediatePropagation()
      void returnToHome()
    }
    const stopObserving = observeHomeFrames(window, current => {
      const doc = current.document
      doc.addEventListener('keydown', key, true)
      const untrack = trackHomeWrites(current)
      return () => { doc.removeEventListener('keydown', key, true); untrack() }
    })
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
    window.addEventListener('message', message)
    window.addEventListener('cursado-home-error', showError)
    return () => {
      stopObserving()
      window.removeEventListener('message', message)
      window.removeEventListener('cursado-home-error', showError)
    }
  }, [pathname])
  return error ? <div role="alert" className="fixed bottom-4 left-4 right-4 z-[200] rounded-xl bg-red-100 p-4 text-red-950">{error} <button className="ml-3 underline" onClick={() => setError('')}>Cerrar</button></div> : null
}
