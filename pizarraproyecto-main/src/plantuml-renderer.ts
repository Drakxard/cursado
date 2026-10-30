import { parseMindmap } from './canvas/mindmap'
import { plantumlImage } from './canvas/plantumlImage'

window.addEventListener('message', async event => {
  if (event.origin !== location.origin || event.source !== parent || event.data?.type !== 'plantuml:render') return
  const { source } = event.data
  try {
    const blob = await plantumlImage(parseMindmap(source))
    parent.postMessage({ type: 'plantuml:result', blob }, location.origin)
  } catch (error) {
    parent.postMessage({ type: 'plantuml:result', error: error instanceof Error ? error.message : String(error) }, location.origin)
  }
})
parent.postMessage({ type: 'plantuml:ready' }, location.origin)
