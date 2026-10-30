import assert from 'node:assert/strict'
import test from 'node:test'
import { build } from 'esbuild'
import { memoryWorkspace } from './helpers/cooperation-filesystem.mjs'
import { digest, writeFile } from '../lib/client/cooperation-files.ts'
import { withWorkspaceFileLock } from '../lib/workspace-file-lock.ts'

test('a concurrent local save cannot replace a cooperative file before its verification', async () => {
  const fs = memoryWorkspace(), path = 'manifests/subject-shortcuts.json'
  const set = fs.files.set.bind(fs.files)
  let competing: Promise<void> | undefined, scheduled = false
  fs.files.set = (key, value) => {
    const result = set(key, value)
    if (key === path && value.size > 0 && !scheduled) {
      scheduled = true
      competing = withWorkspaceFileLock(`write:${path}`, () => fs.put(path, { local: 'later edit' }))
    }
    return result
  }
  await writeFile(fs.root as any, path, new Blob([JSON.stringify({ shared: 'verified first' })]))
  assert.ok(competing)
  await competing
  assert.deepEqual(await fs.json(path), { local: 'later edit' })
})

test('shared manifest updates preserve other subjects, received containers and parallel PDF additions', async t => {
  const fs = memoryWorkspace(), previousWindow = globalThis.window
  globalThis.window = new EventTarget() as any
  ;(globalThis as any).__shortcutRoot = fs.root
  t.after(() => { globalThis.window = previousWindow; delete (globalThis as any).__shortcutRoot })
  const bundled = await build({ stdin: { contents: 'export { getLocalSubjectShortcuts, createLocalSubjectMaterialContainer, completeLocalMaterialUpload } from "./lib/local-workspace-data.ts"; export { applyMirrorFile, scanSphere } from "./lib/client/cooperation-files.ts"', resolveDir: process.cwd() }, bundle: true, write: false, platform: 'browser', format: 'esm', plugins: [{ name: 'root', setup(builder) {
    builder.onResolve({ filter: /local-workspace-client(?:\.ts)?$/ }, () => ({ path: 'root', namespace: 'fixture' }))
    builder.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: 'export const getReadyWorkspaceHandle=()=>globalThis.__shortcutRoot; export const loadWorkspaceHandle=async()=>globalThis.__shortcutRoot; export const queryWorkspacePermission=async()=>"granted"; export const ensureWorkspaceSubdirectories=async()=>{}; export const setReadyWorkspaceHandle=()=>{}; export const getReadyInscreenConfigToken=()=>"";' }))
  } }] })
  const client = await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString('base64')}`)
  await fs.put('manifests/subject-catalog.json', { version: 2, subjects: {} })
  const shortcut = await client.getLocalSubjectShortcuts('Prog3')
  let writes = 0
  window.addEventListener('cursado-workspace-saved', () => writes++)
  await client.getLocalSubjectShortcuts('Prog3')
  await client.getLocalSubjectShortcuts('Prog3')
  assert.equal(writes, 0)
  const binding = { id: 'sphere', groupId: 'group', subjectId: 'algebra', storageKey: 'Algebra', sourceId: 'algebra', sourceKey: 'Algebra', name: 'Álgebra', color: '#000000', owner: true }
  await Promise.all([
    client.getLocalSubjectShortcuts('Prog3'),
    client.applyMirrorFile(fs.root, binding, 'scope/shortcuts.json', { subjectId: 'Algebra', buttons: [] }),
  ])
  const saved = await fs.json('manifests/subject-shortcuts.json')
  assert.deepEqual(saved.Prog3, shortcut)
  assert.deepEqual(saved.Algebra, { subjectId: 'Algebra', buttons: [] })
  await fs.put('manifests/subject-catalog.json', { version: 2, subjects: { algebra: { id: 'algebra', name: 'Álgebra', storageKey: 'Algebra' } } })
  const containers = [
    { id: 1, subjectId: 'algebra', kind: 'theory', name: 'Teoría', normalizedName: 'teoría', orderIndex: 0 },
    { id: 2, subjectId: 'algebra', kind: 'practice', name: 'Práctica', normalizedName: 'práctica', orderIndex: 1 },
    { id: 3, subjectId: 'algebra', kind: 'custom', name: 'Resúmenes', normalizedName: 'resúmenes', orderIndex: 2 },
  ]
  await client.applyMirrorFile(fs.root, binding, 'scope/containers.json', containers)
  assert.ok((await fs.json('manifests/material-containers.json')).Algebra.every(row => row.subjectId === 'Algebra'))
  const prior = (await client.scanSphere(fs.root, binding)).find(file => file.key === 'scope/containers.json').value
  const created = await client.createLocalSubjectMaterialContainer('algebra', 'Parciales')
  assert.deepEqual((await fs.json('manifests/material-containers.json')).Algebra.map(row => row.id), [1, 2, 3, created.id], 'creating a container preserves all received containers')
  await assert.rejects(client.applyMirrorFile(fs.root, binding, 'scope/containers.json', containers, { value: prior }), error => error.name === 'NotReadableError')
  assert.equal((await fs.json('manifests/material-containers.json')).Algebra.length, 4, 'a stale remote apply cannot discard the new container')
  const materialInput = { subjectId: 'algebra', sessionDate: '2026-10-30', materialType: 'theory' }
  const uploaded = await Promise.all(['Uno', 'Dos'].map(name => client.completeLocalMaterialUpload({ ...materialInput, driveFileId: `workspace://teoria/Algebra/${name}.pdf`, fileName: `${name}.pdf` })))
  const materialPath = `manifests/materials/Algebra/week-${uploaded[0].week_number}.json`
  const materials = await fs.json(materialPath)
  assert.equal(materials.materials.length, 2, 'parallel PDF additions preserve both rows')
  const next = { ...materials, materials: [...materials.materials, { id: 12345, file_name: 'Tres.pdf' }] }
  await fs.put(materialPath, next)
  await assert.rejects(client.applyMirrorFile(fs.root, binding, materialPath, materials, { value: materials }), error => error.name === 'NotReadableError')
  assert.equal((await fs.json(materialPath)).materials.length, 3)
})


test('persistent binary read failures identify the file and retain the failure type', async () => {
  const file=new File(['pdf'],'fallido.pdf')
  file.arrayBuffer=async()=>{throw new DOMException('A requested file or directory could not be found','NotFoundError')}
  await assert.rejects(digest(file),error=>error instanceof Error && error.name==='NotFoundError' && /fallido.pdf/.test(error.message) && /carpeta de Estudio/.test(error.message))
})
