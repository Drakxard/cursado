// A File is a snapshot: a concurrent atomic save can invalidate it before text().
// Reacquire the snapshot, while preserving permission and persistent I/O errors.
export async function readWorkspaceFileText(handle: Pick<FileSystemFileHandle, 'getFile'>): Promise<string> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await (await handle.getFile()).text()
    } catch (error) {
      if (!(error instanceof DOMException && error.name === 'NotReadableError') || attempt >= 2) throw error
    }
  }
}
