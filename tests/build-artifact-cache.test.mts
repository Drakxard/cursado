import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { cachedArtifact } from '../scripts/build-artifact-cache.mjs'

test('artifacts reuse identical inputs and rebuild for source, environment and dependency changes', async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'cursado-build-cache-'))
  assert.equal(path.dirname(root), path.resolve(tmpdir()))
  t.after(() => rm(root, { recursive: true, force: true }))
  await writeFile(path.join(root, 'source.ts'), 'first')
  await writeFile(path.join(root, 'lock.json'), 'dependencies-v1')
  let builds = 0
  const options = {
    root, name: 'fixture', inputs: ['source.ts', 'lock.json'], output: 'public/fixture',
    envFiles: ['.env.production'], env: { worker: 'first.example' },
    build: async () => {
      builds++
      await mkdir(path.join(root, 'public/fixture'), { recursive: true })
      await writeFile(path.join(root, 'public/fixture/index.html'), `build-${builds}`)
    },
  }
  await cachedArtifact(options)
  await rm(path.join(root, 'public/fixture'), { recursive: true })
  await cachedArtifact(options)
  assert.equal(builds, 1)
  assert.equal(await readFile(path.join(root, 'public/fixture/index.html'), 'utf8'), 'build-1')
  await writeFile(path.join(root, 'source.ts'), 'changed')
  await cachedArtifact(options)
  assert.equal(builds, 2)
  options.env.worker = 'changed.example'
  await cachedArtifact(options)
  assert.equal(builds, 3)
  await writeFile(path.join(root, 'lock.json'), 'dependencies-v2')
  await cachedArtifact(options)
  assert.equal(builds, 4)
  await writeFile(path.join(root, '.env.production'), 'VITE_SETTING=changed')
  await cachedArtifact(options)
  assert.equal(builds, 5)
  await rm(path.join(root, '.next/cache/build-artifacts/fixture/output/index.html'))
  await cachedArtifact(options)
  assert.equal(builds, 6)
  await writeFile(path.join(root, 'source.ts'), 'broken')
  await assert.rejects(cachedArtifact({ ...options, build: async () => { throw new Error('build failed') } }), /build failed/)
  await cachedArtifact(options)
  assert.equal(builds, 7)
})
