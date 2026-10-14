import { useEffect, useState } from 'react'
export default function HomeError() {
  const [error, setError] = useState('')
  useEffect(() => {
    const show = (event: Event) => setError((event as CustomEvent<string>).detail)
    window.addEventListener('cursado-home-error', show)
    return () => window.removeEventListener('cursado-home-error', show)
  }, [])
  return error ? <div role="alert" style={{ position: 'fixed', bottom: 16, left: 16, right: 16, zIndex: 10000, padding: 16, borderRadius: 12, background: '#fee2e2', color: '#450a0a' }}>{error} <button onClick={() => setError('')}>Cerrar</button></div> : null
}
