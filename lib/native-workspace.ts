import type { LibraryManifest } from './workspace-library'

export type NativeWorkspaceSnapshot = { bridgeVersion: 1; linked: boolean; manifest?: LibraryManifest; available?: Record<string, boolean>; error?: string }
export type NativeWorkspaceBridge = {
  snapshot(): string
  home?(): void
  refresh(): void
  pair(): void
  unlink(): void
  openHtml(id: string, revision: string): void
  openExternal(url: string): void
}
declare global { interface Window { CursadoNative?: NativeWorkspaceBridge } }

export function isNativeReadOnly() { return typeof window !== 'undefined' && Boolean(window.CursadoNative) }
export function readOnlyError(): never { throw new DOMException('Esta biblioteca es de solo consulta. Editá desde la computadora.', 'NotAllowedError') }
export function nativeSnapshot(): NativeWorkspaceSnapshot {
  const snapshot = JSON.parse(window.CursadoNative!.snapshot()) as NativeWorkspaceSnapshot
  if (snapshot.bridgeVersion !== 1) throw new Error('Actualizá InScreen para abrir esta versión de Cursado.')
  if (snapshot.error) throw new Error(snapshot.error)
  return snapshot
}
export function nativeFileUrl(workspaceFileId: string) {
  const path = workspaceFileId.replace(/^workspace:\/\//, '')
  const manifest = nativeSnapshot().manifest
  const file = manifest?.files.find(file => file.path === path)
  if (!file || !manifest) throw new Error('Este archivo no está en la publicación sincronizada. Actualizá desde la computadora.')
  return `/files/${manifest.revision}/${file.id}`
}
export function nativePdfHref(workspaceFileId: string, fileName = '') {
  return `/pdfjs/web/viewer.html?${new URLSearchParams({file:nativeFileUrl(workspaceFileId),fileName,libraryReadOnly:'1'})}#locale=es-AR`
}

// This adapter implements only the directory API used by Cursado. It is never
// persisted to IndexedDB: the native app remains the owner of the revision.
export function nativeWorkspaceRoot(snapshot = nativeSnapshot()): FileSystemDirectoryHandle {
  const manifest = snapshot.manifest
  if (!snapshot.linked || !manifest) throw new Error('Vinculá la biblioteca y descargá su inventario primero.')
  const files = new Map(manifest.files.map(file => [file.path, file]))
  function validate(name: string) {
    if (!name || name === '.' || name === '..' || /[\\/\x00-\x1f]/.test(name)) throw new TypeError('Nombre de archivo inválido.')
  }
  function missing(): never { throw new DOMException('No existe en la biblioteca sincronizada.', 'NotFoundError') }
  function directory(path: string): FileSystemDirectoryHandle {
    const prefix = path ? `${path}/` : ''
    const handle = {
      kind: 'directory', name: path.split('/').at(-1) || manifest!.name,
      queryPermission: async () => 'granted', requestPermission: async () => 'granted',
      isSameEntry: async (other: unknown) => other === handle,
      getDirectoryHandle: async (name: string, options?: FileSystemGetDirectoryOptions) => {
        validate(name); if (options?.create) readOnlyError()
        const next = prefix + name
        if (![...files.keys()].some(file => file.startsWith(`${next}/`))) missing()
        return directory(next)
      },
      getFileHandle: async (name: string, options?: FileSystemGetFileOptions) => {
        validate(name); if (options?.create) readOnlyError()
        const file = files.get(prefix + name); if (!file) missing()
        return {
          kind: 'file', name,
          queryPermission: async () => 'granted', requestPermission: async () => 'granted',
          getFile: async () => {
            const response = await fetch(`/files/${manifest!.revision}/${file!.id}`)
            if (!response.ok) {
              const message = 'Archivo pendiente de descarga. Conectate y volvé a abrirlo.'
              if (typeof window !== 'undefined' && window.dispatchEvent) window.dispatchEvent(new CustomEvent('cursado-native-file-error', {detail:message}))
              throw new Error(message)
            }
            return new File([await response.blob()], name, { type: file!.mime, lastModified: Date.parse(manifest!.publishedAt) })
          },
          createWritable: async () => readOnlyError(), remove: async () => readOnlyError(),
        } as unknown as FileSystemFileHandle
      },
      removeEntry: async () => readOnlyError(),
      async *entries() {
        const names = new Map<string, boolean>()
        for (const path of files.keys()) if (path.startsWith(prefix)) {
          const remainder = path.slice(prefix.length), [name] = remainder.split('/')
          names.set(name, remainder.includes('/'))
        }
        for (const [name, dir] of names) yield [name, dir ? await handle.getDirectoryHandle(name) : await handle.getFileHandle(name)]
      },
      async *values() { for await (const [, entry] of handle.entries()) yield entry },
      async *keys() { for await (const [name] of handle.entries()) yield name },
      resolve: async () => null,
      [Symbol.asyncIterator]() { return handle.entries() },
    }
    return handle as unknown as FileSystemDirectoryHandle
  }
  return directory('')
}
