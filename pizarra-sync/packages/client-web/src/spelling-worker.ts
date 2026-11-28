import Typo from 'typo-js'
import affUrl from '../node_modules/dictionary-es-ar/index.aff?url'
import dicUrl from '../node_modules/dictionary-es-ar/index.dic?url'

let dictionary: Promise<Typo> | undefined
const load = () => dictionary ??= Promise.all([affUrl, dicUrl].map(async url => {
  const response = await fetch(url)
  if (!response.ok) throw new Error('No se pudo cargar el diccionario')
  return response.text()
})).then(([aff, dic]) => new Typo('es_AR', aff, dic))

self.onmessage = async ({ data }) => {
  try {
    const dict = await load()
    if (data.type === 'check') {
      const words = [...new Set(data.words as string[])]
      self.postMessage({ id: data.id, value: words.filter(word => !dict.check(word)) })
    } else if (data.type === 'suggest') {
      self.postMessage({ id: data.id, value: dict.suggest(data.word, 5) })
    }
  } catch {
    dictionary = undefined
    self.postMessage({ id: data.id, error: true })
  }
}
