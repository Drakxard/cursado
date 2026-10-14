import assert from 'node:assert/strict'
import test from 'node:test'
import config from '../next.config.mjs'

test('board APIs proxy to their original Python paths and study APIs remain untouched', async () => {
  const previous = process.env.PIZARRA_BACKEND_URL
  try {
    process.env.PIZARRA_BACKEND_URL = 'https://board.example.com/'
    const rules = await config.rewrites()
    assert.deepEqual(rules.beforeFiles.slice(0, 2), [
      { source: '/pizarra/api/:path*', destination: 'https://board.example.com/api/:path*' },
      { source: '/pizarra/recognize/:path*', destination: 'https://board.example.com/recognize/:path*' },
    ])
    assert.ok(!rules.beforeFiles.some(rule => rule.source === '/api/:path*'))
    delete process.env.PIZARRA_BACKEND_URL
    const offline = await config.rewrites()
    assert.equal(offline.beforeFiles[0].destination, '/api/pizarra-unavailable')
    for (const value of ['https://secret@board.example.com', 'https://board.example.com/api', 'https://board.example.com?secret=value', 'ftp://board.example.com']) {
      process.env.PIZARRA_BACKEND_URL = value
      await assert.rejects(() => config.rewrites(), /PIZARRA_BACKEND_URL/)
    }
  } finally {
    if (previous === undefined) delete process.env.PIZARRA_BACKEND_URL
    else process.env.PIZARRA_BACKEND_URL = previous
  }
})
