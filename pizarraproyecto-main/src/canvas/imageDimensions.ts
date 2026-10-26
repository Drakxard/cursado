/** Read common raster headers without asking the browser to retain full-size pixels. */
export async function imageDimensions(blob: Blob): Promise<{ width: number; height: number }> {
  let bytes = new Uint8Array(await blob.slice(0, 32).arrayBuffer())
  if (bytes[0] === 0xff && bytes[1] === 0xd8) bytes = new Uint8Array(await blob.slice(0, 512 * 1024).arrayBuffer())
  const view = new DataView(bytes.buffer)
  const valid = (width: number, height: number) => width > 0 && height > 0 ? { width, height } : undefined
  if (bytes.length >= 24 && view.getUint32(0) === 0x89504e47 && view.getUint32(4) === 0x0d0a1a0a) {
    const size = valid(view.getUint32(16), view.getUint32(20)); if (size) return size
  }
  if (bytes.length >= 4 && view.getUint16(0) === 0xffd8) {
    let width = 0, height = 0, orientation = 1
    try {
      for (let offset = 2; offset + 4 <= bytes.length;) {
        if (bytes[offset] !== 0xff) break
        const marker = bytes[offset + 1]
        if (marker === 0xda || marker === 0xd9) break
        if (marker === 0xff) { offset++; continue }
        const length = view.getUint16(offset + 2), end = offset + 2 + length
        if (length < 2 || end > bytes.length) break
        if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker) && length >= 8) {
          height = view.getUint16(offset + 5); width = view.getUint16(offset + 7)
        }
        if (marker === 0xe1 && length >= 16 && view.getUint32(offset + 4) === 0x45786966 && view.getUint16(offset + 8) === 0) {
          const base = offset + 10, little = view.getUint16(base) === 0x4949
          const directory = base + view.getUint32(base + 4, little)
          if (directory >= base && directory + 2 <= end) {
            const count = view.getUint16(directory, little)
            for (let i = 0; i < count; i++) {
              const entry = directory + 2 + i * 12
              if (entry + 12 > end) break
              if (view.getUint16(entry, little) === 0x112 && view.getUint16(entry + 2, little) === 3 && view.getUint32(entry + 4, little) === 1) orientation = view.getUint16(entry + 8, little)
            }
          }
        }
        offset = end
      }
      if (width && height) return orientation >= 5 && orientation <= 8 ? { width: height, height: width } : { width, height }
    } catch { /* Unusual headers fall back to the browser. */ }
  }
  if (bytes.length >= 30 && view.getUint32(0) === 0x52494646 && view.getUint32(8) === 0x57454250) {
    const kind = view.getUint32(12)
    let size
    if (kind === 0x56503858 && !(bytes[20] & 0x08)) size = valid(1 + bytes[24] + (bytes[25] << 8) + (bytes[26] << 16), 1 + bytes[27] + (bytes[28] << 8) + (bytes[29] << 16))
    if (kind === 0x56503820 && bytes[23] === 0x9d && bytes[24] === 1 && bytes[25] === 0x2a) size = valid(view.getUint16(26, true) & 0x3fff, view.getUint16(28, true) & 0x3fff)
    if (kind === 0x5650384c && bytes[20] === 0x2f) {
      const bits = view.getUint32(21, true); size = valid((bits & 0x3fff) + 1, ((bits >>> 14) & 0x3fff) + 1)
    }
    if (size) return size
  }
  // The element fallback also respects EXIF orientation in JPEGs and uncommon formats.
  const url = URL.createObjectURL(blob), image = new Image()
  try {
    return await new Promise((resolve, reject) => {
      image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight })
      image.onerror = () => reject(new Error('No se pudo leer la imagen.'))
      image.src = url
    })
  } finally { image.src = ''; URL.revokeObjectURL(url) }
}
