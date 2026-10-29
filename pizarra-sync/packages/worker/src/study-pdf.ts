import { Sha256 } from '@aws-crypto/sha256-js'
import type { Env } from './index'

const cors = {'Access-Control-Allow-Origin':'*','Access-Control-Expose-Headers':'Content-Length, Retry-After','Cache-Control':'private, no-store'}
const reply = (value: unknown, status = 200) => Response.json(value,{status,headers:cors})
const maximum = 100 * 1024 * 1024
type Pointer = {key:string;cooperative?:boolean;size:number}

// A room link remains the capability. PDFs are explicitly published into that room;
// knowing a content hash alone does not expose files from other rooms or spheres.
export async function studyPdf(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url), [, , room, hash, action] = url.pathname.split('/')
  if (!/^study-[a-f0-9-]{36}$/.test(room || '') || !/^[a-f0-9]{64}$/.test(hash || '')) return reply({error:'PDF inválido.'},422)
  if(request.method === 'OPTIONS') return new Response(null,{status:204,headers:{...cors,'Access-Control-Allow-Methods':'GET, HEAD, POST, OPTIONS','Access-Control-Allow-Headers':'Content-Type, X-File-Size'}})
  const pointerKey = `study-pdfs/${room}/${hash}.json`
  const pointer = await env.UPLOADS.get(pointerKey)
  const saved = pointer ? await pointer.json<Pointer>() : null
  if(request.method === 'GET' || request.method === 'HEAD') {
    if(!saved) return reply({error:'Este PDF todavía no está publicado.'},404)
    const bucket = saved.cooperative ? env.COOP_FILES : env.UPLOADS
    const object = await bucket?.get(saved.key)
    if(!object) return reply({error:'El PDF no está disponible.'},404)
    return new Response(request.method === 'HEAD' ? null : object.body,{headers:{...cors,'Content-Type':'application/pdf','Content-Length':String(object.size),'X-Content-Type-Options':'nosniff'}})
  }
  if(request.method !== 'POST') return reply({error:'Método no permitido.'},405)
  if(saved) return reply({ok:true,size:saved.size})
  const ip = request.headers.get('cf-connecting-ip')
  if(ip && env.UPLOAD_RL && !(await env.UPLOAD_RL.limit({key:ip})).success) return new Response(JSON.stringify({error:'Esperá antes de publicar más archivos.'}),{status:429,headers:{...cors,'Retry-After':'60'}})
  if(action === 'reuse') {
    if(!env.COOP_FILES || !env.COOP_SERVICE) return reply({error:'Reutilización no disponible.'},503)
    const body = await request.json() as {sphereId?:string}
    if(!/^[a-f0-9-]{36}$/.test(body.sphereId || '')) return reply({error:'Esfera inválida.'},422)
    // The existing service checks the publishing user's session and sphere membership.
    const authorization = await env.COOP_SERVICE.fetch(new Request(`https://cursado-realtime/api/cooperation/spheres/${body.sphereId}/files/${hash}`,{headers:{Cookie:request.headers.get('Cookie') || '',Origin:'https://cursado.vercel.app'}}))
    await authorization.body?.cancel()
    if(!authorization.ok) return reply({error:'No se pudo autorizar el PDF de la esfera.'},authorization.status)
    const key = `cursado/shared/${body.sphereId}/${hash}`, file = await env.COOP_FILES.head(key)
    if(!file || file.size > maximum) return reply({error:'PDF no disponible.'},404)
    await env.UPLOADS.put(pointerKey,JSON.stringify({key,cooperative:true,size:file.size} satisfies Pointer))
    return reply({ok:true,size:file.size,reused:true})
  }
  const size = Number(request.headers.get('X-File-Size'))
  if(request.headers.get('Content-Type') !== 'application/pdf' || !Number.isSafeInteger(size) || size < 5 || size > maximum || !request.body) return reply({error:'PDF inválido (máximo 100 MB).'},422)
  const key = `pdf/${hash}.pdf`
  const upload = await env.UPLOADS.createMultipartUpload(key,{httpMetadata:{contentType:'application/pdf'}})
  const reader = request.body.getReader(), digest = new Sha256(), chunks:Uint8Array[] = [], parts:R2UploadedPart[] = []
  let received = 0, buffered = 0, signature = ''
  const flush = async () => {
    const bytes = new Uint8Array(buffered); let offset = 0
    for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length}
    parts.push(await upload.uploadPart(parts.length+1,bytes));chunks.length=0;buffered=0
  }
  try {
    while(true) {
      const next = await reader.read(); if(next.done) break
      received += next.value.length
      if(received > size) throw new Error('El tamaño del PDF no coincide.')
      if(signature.length < 5) signature += new TextDecoder().decode(next.value.subarray(0,5-signature.length))
      digest.update(next.value); chunks.push(next.value); buffered += next.value.length
      if(buffered >= 8*1024*1024) await flush()
    }
    const actual = [...await digest.digest()].map(n=>n.toString(16).padStart(2,'0')).join('')
    if(signature !== '%PDF-' || received !== size || actual !== hash) throw new Error('El PDF no pasó la verificación de integridad.')
    if(buffered) await flush()
    await upload.complete(parts)
    await env.UPLOADS.put(pointerKey,JSON.stringify({key,size} satisfies Pointer))
    return reply({ok:true,size})
  } catch(error) {
    await reader.cancel().catch(()=>{}); await upload.abort().catch(()=>{})
    return reply({error:error instanceof Error ? error.message : 'No se pudo publicar el PDF.'},422)
  }
}
