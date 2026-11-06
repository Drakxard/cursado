// Yield to input/painting without nested setTimeouts, which browsers heavily
// throttle in hidden tabs. No animation frames are required to finish an export.
export async function yieldExportTask(signal?: AbortSignal) {
  signal?.throwIfAborted()
  const scheduler = (globalThis as typeof globalThis & { scheduler?: { yield?: () => Promise<void> } }).scheduler
  if (scheduler?.yield) await scheduler.yield()
  else await new Promise<void>(resolve => {
    const channel = new MessageChannel()
    channel.port1.onmessage = () => {
      channel.port1.close()
      channel.port2.close()
      resolve()
    }
    channel.port2.postMessage(null)
  })
  signal?.throwIfAborted()
}
