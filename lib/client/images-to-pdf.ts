"use client"

import { loadPdfLib, normalizePdfFileName } from "./text-to-pdf"

export { isMaterialImage, sortMaterialImages } from './material-image-files'

function jpegOrientation(bytes: ArrayBuffer) {
  const view = new DataView(bytes)
  for (let offset = 2; offset + 4 < view.byteLength;) {
    if (view.getUint8(offset) !== 0xff) break
    const marker = view.getUint8(offset + 1)
    if (marker === 0xda || marker === 0xd9) break
    const size = view.getUint16(offset + 2)
    if (size < 2 || offset + size + 2 > view.byteLength) break
    if (marker === 0xe1 && size >= 16 && view.getUint32(offset + 4) === 0x45786966) {
      const base = offset + 10
      const little = view.getUint16(base) === 0x4949
      const directory = base + view.getUint32(base + 4, little)
      if (directory + 2 > view.byteLength) return 1
      const count = view.getUint16(directory, little)
      for (let i = 0; i < count; i++) {
        const entry = directory + 2 + i * 12
        if (entry + 12 > view.byteLength) break
        if (view.getUint16(entry, little) === 0x112) return view.getUint16(entry + 8, little)
      }
    }
    offset += size + 2
  }
  return 1
}

async function webpToPng(file: File) {
  const bitmap = await createImageBitmap(file)
  try {
    const canvas = document.createElement("canvas")
    canvas.width = bitmap.width
    canvas.height = bitmap.height
    const context = canvas.getContext("2d")
    if (!context) throw new Error("No se pudo convertir la imagen.")
    context.drawImage(bitmap, 0, 0)
    const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error("No se pudo convertir la imagen.")), "image/png"))
    return blob.arrayBuffer()
  } finally { bitmap.close() }
}

type EmbeddedImage = { width: number; height: number }
type ImagePdf = {
  embedJpg(bytes: ArrayBuffer): Promise<EmbeddedImage>
  embedPng(bytes: ArrayBuffer): Promise<EmbeddedImage>
  addPage(size: [number, number]): { pushOperators(...operators: unknown[]): void; drawImage(image: EmbeddedImage, options: { x: number; y: number; width: number; height: number }): void }
  save(): Promise<Uint8Array<ArrayBuffer>>
}
type ImagePdfLib = {
  PDFDocument: { create(): Promise<ImagePdf> }
  pushGraphicsState(): unknown
  popGraphicsState(): unknown
  concatTransformationMatrix(...values: number[]): unknown
}

export async function createPdfFromImages(files: File[], name: string) {
  const lib = await loadPdfLib() as unknown as ImagePdfLib
  const document = await lib.PDFDocument.create()
  const errors: string[] = []
  let pages = 0
  for (const file of files) {
    try {
      const bytes = await file.arrayBuffer()
      const signature = new Uint8Array(bytes)
      const jpeg = signature[0] === 0xff && signature[1] === 0xd8
      const png = signature[0] === 0x89 && signature[1] === 0x50
      const webp = signature[0] === 0x52 && signature[1] === 0x49 && String.fromCharCode(...signature.slice(8, 12)) === "WEBP"
      if (!jpeg && !png && !webp) throw new Error("Imagen no válida.")
      const image = jpeg ? await document.embedJpg(bytes) : await document.embedPng(webp ? await webpToPng(file) : bytes)
      const { width: w, height: h } = image
      const orientation = jpeg ? jpegOrientation(bytes) : 1
      const matrices: Record<number, number[]> = {
        1: [1, 0, 0, 1, 0, 0], 2: [-1, 0, 0, 1, w, 0],
        3: [-1, 0, 0, -1, w, h], 4: [1, 0, 0, -1, 0, h],
        5: [0, -1, -1, 0, h, w], 6: [0, -1, 1, 0, 0, w],
        7: [0, 1, 1, 0, 0, 0], 8: [0, 1, -1, 0, h, 0],
      }
      const page = document.addPage(orientation >= 5 && orientation <= 8 ? [h, w] : [w, h])
      page.pushOperators(lib.pushGraphicsState(), lib.concatTransformationMatrix(...(matrices[orientation] ?? matrices[1])))
      page.drawImage(image, { x: 0, y: 0, width: w, height: h })
      page.pushOperators(lib.popGraphicsState())
      pages++
    } catch (error) { errors.push(`${file.name}: ${error instanceof Error ? error.message : "No se pudo convertir."}`) }
  }
  return { file: pages ? new File([await document.save()], normalizePdfFileName(name), { type: "application/pdf" }) : null, errors }
}
