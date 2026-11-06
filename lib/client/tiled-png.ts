// Encode strips into one PNG without allocating a document-sized canvas.
// PNG's IDAT chunks share a single zlib stream; each row uses filter 1 (Sub).
const crcTable = Uint32Array.from({ length: 256 }, (_, value) => {
  for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1
  return value >>> 0
})

function chunk(name: string, data: Uint8Array): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(data.length + 12)
  const view = new DataView(bytes.buffer)
  view.setUint32(0, data.length)
  bytes.set(new TextEncoder().encode(name), 4)
  bytes.set(data, 8)
  let crc = 0xffffffff
  for (let i = 4; i < bytes.length - 4; i++) crc = crcTable[(crc ^ bytes[i]) & 255] ^ (crc >>> 8)
  view.setUint32(bytes.length - 4, (crc ^ 0xffffffff) >>> 0)
  return bytes
}

export function createTiledPng(width: number, height: number, signal?: AbortSignal) {
  const header = new Uint8Array(13)
  const view = new DataView(header.buffer)
  view.setUint32(0, width)
  view.setUint32(4, height)
  header[8] = 8
  header[9] = 2 // RGB, opaque export background.
  const parts: BlobPart[] = [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", header)]
  const compressor = new CompressionStream("deflate")
  const writer = compressor.writable.getWriter()
  const reader = compressor.readable.getReader()
  const abort = () => { void writer.abort(signal?.reason).catch(() => {}); void reader.cancel(signal?.reason).catch(() => {}) }
  signal?.addEventListener("abort", abort, { once: true })
  const draining = (async () => {
    while (true) {
      const { done, value } = await reader.read()
      if (done) return
      parts.push(chunk("IDAT", value))
    }
  })()
  // Attach a handler immediately, including when rendering fails before finish.
  void draining.catch(() => {})
  let rows = 0
  return {
    async write(canvas: HTMLCanvasElement) {
      if (canvas.width !== width || rows + canvas.height > height) throw new Error("Dimensiones de PNG inválidas.")
      const context = canvas.getContext("2d")
      if (!context) throw new Error("No se pudo leer la franja de exportación.")
      // Bound both pixel reads and compression buffers, and yield on each write.
      for (let y = 0; y < canvas.height; y += 32) {
        signal?.throwIfAborted()
        const count = Math.min(32, canvas.height - y)
        const pixels = context.getImageData(0, y, width, count).data
        const stride = width * 3 + 1
        const data = new Uint8Array(stride * count)
        for (let row = 0; row < count; row++) {
          data[row * stride] = 1
          for (let x = 0; x < width; x++) {
            const input = (row * width + x) * 4
            const output = row * stride + 1 + x * 3
            for (let channel = 0; channel < 3; channel++) {
              data[output + channel] = pixels[input + channel] - (x ? pixels[input + channel - 4] : 0)
            }
          }
        }
        await writer.write(data)
      }
      rows += canvas.height
    },
    async finish() {
      if (rows !== height) throw new Error("La imagen PNG está incompleta.")
      await writer.close()
      await draining
      signal?.throwIfAborted()
      parts.push(chunk("IEND", new Uint8Array()))
      return new Blob(parts, { type: "image/png" })
    },
    dispose() {
      signal?.removeEventListener("abort", abort)
      abort()
    },
  }
}
