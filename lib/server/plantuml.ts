export class PlantUmlError extends Error {
  status: number
  constructor(message: string, status = 400) { super(message); this.status = status }
}

export function plantUmlSource(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) throw new PlantUmlError('Pegá el código PlantUML para ver el diagrama.')
  if (new TextEncoder().encode(value).length > 100_000) throw new PlantUmlError('El código supera el límite de 100 KB.', 413)
  return value.trim()
}

export async function renderPlantUml(value: unknown, signal?: AbortSignal, fetcher: typeof fetch = fetch): Promise<ArrayBuffer> {
  const source = plantUmlSource(value)
  const response = await fetcher('https://kroki.io/plantuml/png', {
    method: 'POST', headers: { 'Content-Type': 'text/plain; charset=utf-8', Accept: 'image/png' },
    body: source, signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(25_000)]) : AbortSignal.timeout(25_000),
    cache: 'no-store', redirect: 'error',
  })
  if (!response.ok) {
    const detail = (await response.text()).slice(0, 1200).trim()
    if (response.status === 400 || response.status === 422) throw new PlantUmlError(detail || 'Revisá la sintaxis del código PlantUML.')
    throw new PlantUmlError('El servicio de diagramas no está disponible. Intentá nuevamente.', 502)
  }
  if (!response.headers.get('content-type')?.startsWith('image/png')) throw new PlantUmlError('El servicio no devolvió una imagen válida.', 502)
  if (Number(response.headers.get('content-length') || 0) > 8_000_000) throw new PlantUmlError('El diagrama es demasiado grande.', 413)
  const bytes = await response.arrayBuffer(), data = new Uint8Array(bytes)
  if (bytes.byteLength > 8_000_000) throw new PlantUmlError('El diagrama es demasiado grande.', 413)
  if (data.length < 24 || ![137,80,78,71,13,10,26,10].every((byte, index) => data[index] === byte)) throw new PlantUmlError('El servicio devolvió una imagen inválida.', 502)
  const view = new DataView(bytes), width = view.getUint32(16), height = view.getUint32(20)
  if (!width || !height || width > 8192 || height > 8192 || width * height > 16_000_000) throw new PlantUmlError('El diagrama es demasiado grande. Dividilo en partes.', 413)
  return bytes
}
