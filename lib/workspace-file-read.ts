// A File is a snapshot: a concurrent atomic save can invalidate it before text().
// Reacquire the snapshot, while preserving permission and persistent I/O errors.
export async function readWorkspaceFileText(handle: Pick<FileSystemFileHandle, 'getFile'>): Promise<string> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await (await handle.getFile()).text()
    } catch (error) {
      // Folder handles can arrive from a sibling frame with another DOMException realm.
      if ((error as { name?: string } | null)?.name !== 'NotReadableError' || attempt >= 2) throw error
    }
  }
}
