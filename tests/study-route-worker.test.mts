import assert from 'node:assert/strict'
import test from 'node:test'
import vm from 'node:vm'
import { offlineApp } from '../pizarraproyecto-main/scripts/pwa-build.ts'

test('standalone offline worker leaves named Study boards to Next and retains its own offline shell', async () => {
  let source = ''
  const plugin = offlineApp()
  const generate = plugin.generateBundle as Function
  generate.call({ emitFile: (asset: { source: string }) => { source = asset.source } }, {}, {})
  const handlers: Record<string, Function> = {}
  vm.runInNewContext(source, {
    self: { location: { origin: 'https://app.test' }, addEventListener: (type: string, handler: Function) => { handlers[type] = handler } },
    URL, Map, caches: { open: async () => ({ match: async () => new Response('offline shell') }) },
  })
  let response: Promise<Response> | null = null
  const navigate = (path: string) => handlers.fetch({ request: { method: 'GET', mode: 'navigate', url: 'https://app.test' + path }, respondWith: (value: Promise<Response>) => { response = value } })
  navigate('/pizarra/base-de-datos/4/temas')
  assert.equal(response, null)
  navigate('/pizarra/')
  assert.equal(await (await response!).text(), 'offline shell')
})
