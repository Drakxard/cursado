// Extracted from the existing board SVG importer.
  async function imageFromBlob(blob: Blob): Promise<HTMLImageElement> {
    const url = URL.createObjectURL(blob)
    try {
      const image = new Image()
      image.src = url
      await image.decode()
      return image
    } finally {
      // decode() deja los píxeles disponibles para drawImage.
      URL.revokeObjectURL(url)
    }
  }
export async function svgToPng(file: File): Promise<Blob> {
    // No conservar HTML/SVG activo ni solicitar recursos externos al importarlo.
    if (file.size > 3_000_000) throw new Error('El SVG supera el límite de 3 MB.')
    const source = await file.text()
    if (!source.trim()) throw new Error('El archivo SVG está vacío.')
    const doc = new DOMParser().parseFromString(source, 'image/svg+xml')
    const root = doc.documentElement
    if (doc.querySelector('parsererror') || root.localName.toLowerCase() !== 'svg') {
      throw new Error('El archivo no contiene un SVG válido.')
    }
    const blocked = new Set(['script','foreignobject','iframe','object','embed',
      'audio','video','feimage','animate','animatetransform','animatemotion','set'])
    const urlReferences = (text: string) => Array.from(
      text.matchAll(/url\s*\(\s*(['"]?)(.*?)\1\s*\)/gi)
    ).some(match => !match[2]!.trim().startsWith('#'))
    const all = [root, ...Array.from(root.querySelectorAll('*'))]
    for (const node of all) {
      if (!node.isConnected && node !== root) continue
      if (blocked.has(node.localName.toLowerCase())) { node.remove(); continue }
      for (const attr of Array.from(node.attributes)) {
        const name = attr.localName.toLowerCase()
        const value = attr.value.trim()
        if (name.startsWith('on') || urlReferences(value) ||
            (name === 'href' && !value.startsWith('#')) ||
            /(?:javascript:|@import|expression\s*\()/i.test(value)) {
          node.removeAttributeNode(attr)
        }
      }
      if (node.localName.toLowerCase() === 'style' &&
          (/@import/i.test(node.textContent || '') || urlReferences(node.textContent || ''))) {
        node.remove()
      }
    }
    // Muchos SVG exportados tienen solo viewBox y dimensiones porcentuales.
    // Convertirlas a dimensiones físicas conserva la proporción al rasterizar.
    const viewBox = (root.getAttribute('viewBox') || '').trim().split(/[\s,]+/).map(Number)
    const viewW = viewBox.length === 4 && viewBox[2]! > 0 ? viewBox[2]! : 640
    const viewH = viewBox.length === 4 && viewBox[3]! > 0 ? viewBox[3]! : 480
    const numericLength = (value: string | null): number | null => {
      if (!value || !/^\s*\d+(?:\.\d+)?(?:px)?\s*$/i.test(value)) return null
      const n = Number.parseFloat(value)
      return Number.isFinite(n) && n > 0 ? n : null
    }
    const svgW = numericLength(root.getAttribute('width'))
    const svgH = numericLength(root.getAttribute('height'))
    const originalRatio = viewW / viewH
    const intendedW = svgW ?? (svgH ? svgH * originalRatio : viewW)
    const intendedH = svgH ?? (svgW ? svgW / originalRatio : viewH)
    const safeDimensions = Math.min(1, 4096 / Math.max(intendedW, intendedH))
    root.setAttribute('width', String(Math.max(1, Math.round(intendedW * safeDimensions))))
    root.setAttribute('height', String(Math.max(1, Math.round(intendedH * safeDimensions))))
    if (!root.getAttribute('xmlns')) root.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
    const serialized = new XMLSerializer().serializeToString(root)
    const safeSvg = new Blob([serialized], {type:'image/svg+xml'})
    const image = await imageFromBlob(safeSvg)
    const originalW = image.naturalWidth || 640
    const originalH = image.naturalHeight || 480
    const baseScale = Math.min(1, 1200 / Math.max(originalW,originalH))
    // Guardar una imagen de alta resolución, transparente y redimensionable.
    const rasterScale = Math.min(3, 4096 / Math.max(originalW*baseScale, originalH*baseScale))
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(originalW*baseScale*rasterScale))
    canvas.height = Math.max(1, Math.round(originalH*baseScale*rasterScale))
    try {
      const ctx = canvas.getContext('2d')
      if (!ctx) throw new Error('No se pudo preparar el SVG para pegarlo.')
      ctx.drawImage(image,0,0,canvas.width,canvas.height)
      return await new Promise<Blob>((resolve,reject)=>{
        canvas.toBlob(result=>result?resolve(result):reject(new Error('No se pudo convertir el SVG a PNG.')), 'image/png')
      })
    } finally { canvas.width = canvas.height = 0; image.src = '' }
  }

