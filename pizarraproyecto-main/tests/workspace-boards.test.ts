import { describe, expect, it } from 'vitest'
import { createWorkspaceBoardStore } from '../src/storage/workspaceBoards'
import type { WorkspaceBoard } from '../src/storage/workspaceBoards'

function fixture() {
  const files = new Map<string, Blob>(), directories = new Set([''])
  let denied = false
  const absent = () => new DOMException('Not found', 'NotFoundError')
  const directory = (prefix = ''): FileSystemDirectoryHandle => ({
    async getDirectoryHandle(name: string, options?: { create?: boolean }) {
      const path = prefix + name + '/'
      if (!directories.has(path) && !options?.create) throw absent()
      directories.add(path); return directory(path)
    },
    async getFileHandle(name: string, options?: { create?: boolean }) {
      const path = prefix + name
      if (!files.has(path)) { if (!options?.create) throw absent(); files.set(path, new Blob()) }
      return {
        async getFile() { return files.get(path)! },
        async createWritable() {
          let staged = files.get(path)!
          return { async write(value: Blob | string) { staged = typeof value === 'string' ? new Blob([value]) : value },
            async close() { if (denied) throw new DOMException('Denied', 'NotAllowedError'); files.set(path, staged) }, async abort() {} }
        },
      }
    },
  }) as unknown as FileSystemDirectoryHandle
  const root = directory()
  return { files, store: createWorkspaceBoardStore(root), reopen: () => createWorkspaceBoardStore(root), deny: () => { denied = true } }
}
const board = (): WorkspaceBoard => ({ id: 'local:original', name: 'Original', folderId: null, assets: {}, scene: {
  strokes: [], texts: [{ id: 'text', text: 'Original', x: 0, y: 0, fontSize: 20, color: '#000' }], media: [], camera: { x: 0, y: 0, zoom: 1 }, shapes: [], tables: [], graphs: [], videos: [],
} })

describe('home boards in the workspace folder', () => {
  it('merges independent browser edits, preserves camera and reuses existing assets on text edits', async () => {
    const { store, reopen, files } = fixture(), input = board()
    input.scene.media.push({ id: 'media', assetId: 'asset', kind: 'image', name: 'Photo', x: 0, y: 0, width: 10, height: 10 })
    const photo = new Blob(['immutable original'], { type: 'image/png' })
    const initial = await store.save(input, async () => photo)
    const other = reopen(), remote = structuredClone(initial)
    remote.scene.texts.push({ ...remote.scene.texts[0], id: 'remote', text: 'Another browser' })
    await other.save(remote, async () => { throw Error('Unchanged assets must not be read again') }, initial.scene)
    const local = structuredClone(initial)
    local.scene.texts[0].text = 'Edited here'
    local.scene.camera = { x: 50, y: 60, zoom: 2 }
    const result = await store.save(local, async () => { throw Error('Unchanged assets must not be read again') }, initial.scene)
    expect(result.scene.texts.map(t => t.text)).toEqual(['Edited here', 'Another browser'])
    expect(result.scene.camera.zoom).toBe(2)
    expect(await (await store.asset(result.assets.asset)).text()).toBe('immutable original')
    expect([...files.keys()].filter(path => path.endsWith('.bin'))).toHaveLength(1)
  })
  it('keeps the folder authoritative over a legacy browser copy and preserves unknown scene fields', async () => {
    const { store } = fixture(), original = board()
    Object.assign(original.scene, { futureField: { value: 42 } })
    await store.save(original, async () => undefined)
    const stale = board(); stale.scene.texts = []
    expect((await store.save(stale, async () => undefined)).scene).toEqual(original.scene)
    expect((await store.read(original.id))?.scene).toMatchObject({ futureField: { value: 42 } })
  })
  it('never commits a migration with a missing asset and rejects invalid folder files', async () => {
    const { store, files } = fixture(), input = board()
    input.scene.media.push({ id: 'media', assetId: 'missing', kind: 'image', name: 'Missing', x: 0, y: 0, width: 10, height: 10 })
    await expect(store.save(input, async () => undefined)).rejects.toThrow('Falta el archivo')
    expect((await store.library()).boards).toEqual([])
    await store.addFolder({ id: 'local:folder', name: 'Folder' })
    files.set('boards/library.json', new Blob(['invalid JSON']))
    await expect(store.library()).rejects.toThrow()
  })
  it('retains the prior document after denied writes and never resurrects deleted boards or folders', async () => {
    const first = fixture(), initial = await first.store.save(board(), async () => undefined)
    first.deny()
    const edited = structuredClone(initial); edited.scene.texts = []
    await expect(first.store.save(edited, async () => undefined, initial.scene)).rejects.toMatchObject({ name: 'NotAllowedError' })
    expect((await first.store.read(initial.id))?.scene.texts).toHaveLength(1)
    const second = fixture()
    await second.store.addFolder({ id: 'local:folder', name: 'Folder' })
    await second.store.removeFolder('local:folder')
    await second.store.addFolder({ id: 'local:folder', name: 'Old browser folder' })
    expect((await second.store.library()).folders).toEqual([])
    await second.store.save(board(), async () => undefined)
    await second.store.remove(initial.id)
    await expect(second.reopen().save(board(), async () => undefined)).rejects.toThrow('eliminada')
    expect((await second.store.library()).boards).toEqual([])
    const third = fixture(), opened = await third.store.save(board(), async () => undefined)
    third.files.delete('boards/library.json')
    await expect(third.store.save(opened, async () => undefined, opened.scene)).rejects.toThrow('ya no está en la carpeta')
  })
})
