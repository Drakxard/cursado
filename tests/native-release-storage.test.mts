import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pruneNativeReleases } from '../scripts/native-release-storage.mjs'
import { stripPublicSourceMaps } from '../scripts/prepare-vercel-output.mjs'

test('native deployment retains only the advertised release and leaves unrelated files alone', async t => {
  const root = await mkdtemp(join(tmpdir(), 'native-releases-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  for (const revision of ['a'.repeat(64), 'b'.repeat(64), 'notes']) {
    await mkdir(join(root, 'releases', revision), { recursive: true })
    await writeFile(join(root, 'releases', revision, 'asset.js'), 'asset')
  }
  await pruneNativeReleases(root, 'b'.repeat(64))
  assert.deepEqual((await readdir(join(root, 'releases'))).sort(), ['b'.repeat(64), 'notes'])
  await assert.rejects(pruneNativeReleases(root, '../outside'), /Invalid/)
})

test('Vercel removes debugging maps while preserving runtime modules and PDF resources', async t => {
  const root = await mkdtemp(join(tmpdir(), 'vercel-static-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  await mkdir(join(root, 'pdfjs'))
  await writeFile(join(root, 'pdfjs', 'pdf.worker.mjs.map'), 'debug map')
  await writeFile(join(root, 'pdfjs', 'pdf.worker.mjs'), 'runtime')
  await writeFile(join(root, 'pdfjs', 'font.pfb'), 'font')
  assert.equal(await stripPublicSourceMaps(root), 9)
  assert.deepEqual((await readdir(join(root, 'pdfjs'))).sort(), ['font.pfb', 'pdf.worker.mjs'])
})
