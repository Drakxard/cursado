import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import AnonymousGate from './AnonymousGate'
import './pwa'
import { installHomeShortcut } from './homeNavigation'
import HomeError from './components/HomeError'
import EmbeddedTopicBoard from './EmbeddedTopicBoard'

installHomeShortcut()

// The publisher owns the Next.js services configuration; it never prompts here.
if (window.parent === window) {
  const publisher = document.createElement('iframe')
  publisher.src = '/biblioteca/publicador'
  publisher.hidden = true
  publisher.title = 'Publicación de biblioteca'
  document.body.append(publisher)
  // A board restored by its service worker may have opened without Next.js.
  window.addEventListener('online', () => { publisher.src = '/biblioteca/publicador' })
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {window.parent !== window && new URLSearchParams(location.search).has('topicBoard') ? <EmbeddedTopicBoard /> : <AnonymousGate />}
    <HomeError />
  </StrictMode>,
)
