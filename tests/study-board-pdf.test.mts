import test from 'node:test'
import assert from 'node:assert/strict'
import { studyPdf } from '../pizarra-sync/packages/worker/src/study-pdf.ts'
import { downloadStudyPdf, publishStudyPdf } from '../lib/study-board-pdf.ts'
import { memoryWorkspace } from './helpers/cooperation-filesystem.mjs'
import { digest, readFile, writeFile } from '../lib/client/cooperation-files.ts'
import { openStudyBoard } from '../lib/study-board-workspace.ts'

const room = 'study-11111111-1111-4111-8111-111111111111'
const pdf = new Blob(['%PDF-1.4\ncontenido'],{type:'application/pdf'})
function bucket() {
  const blobs = new Map<string,Blob>()
  return {blobs,
    head:async(key:string)=>blobs.has(key)?{size:blobs.get(key)!.size}:null,
    get:async(key:string)=>{const blob=blobs.get(key);return blob?{size:blob.size,body:blob.stream(),json:()=>blob.text().then(JSON.parse)}:null},
    put:async(key:string,data:Blob|string)=>{blobs.set(key,data instanceof Blob?data:new Blob([data]))},
    createMultipartUpload:async(key:string)=>{const parts:Uint8Array[]=[];return {uploadPart:async(n:number,bytes:Uint8Array)=>{parts.push(bytes);return {partNumber:n,etag:String(n)}},complete:async()=>{blobs.set(key,new Blob(parts as BlobPart[]))},abort:async()=>{}}},
  }
}
test('PDF upload verifies bytes and room access; a hash alone cannot publish a file',async()=>{
  const uploads=bucket(),env={UPLOADS:uploads} as any,hash=await digest(pdf),url=`https://worker/study-pdf/${room}/${hash}`
  const result=await studyPdf(new Request(url,{method:'POST',headers:{'Content-Type':'application/pdf','X-File-Size':String(pdf.size)},body:pdf}),env)
  assert.equal(result.status,200)
  const download=await studyPdf(new Request(url),env);assert.equal(await download.text(),await pdf.text())
  const head=await studyPdf(new Request(url,{method:'HEAD'}),env);assert.equal(head.headers.get('Content-Length'),String(pdf.size))
  const other=url.replace(room,room.replace('11111111','22222222'))
  assert.equal((await studyPdf(new Request(other),env)).status,404)
  assert.equal((await studyPdf(new Request(other,{method:'POST',headers:{'Content-Type':'application/pdf','X-File-Size':String(pdf.size)},body:'wrong'}),env)).status,422)
  assert.equal((await studyPdf(new Request(other),env)).status,404)
})
test('cooperative PDF reuse checks membership and keeps the existing R2 object',async()=>{
  const uploads=bucket(),cooperative=bucket(),hash=await digest(pdf),sphere='33333333-3333-4333-8333-333333333333'
  await cooperative.put(`cursado/shared/${sphere}/${hash}`,pdf)
  let allowed=false
  const env={UPLOADS:uploads,COOP_FILES:cooperative,COOP_SERVICE:{fetch:async()=>new Response(null,{status:allowed?200:403})}} as any
  const url=`https://worker/study-pdf/${room}/${hash}`,request=()=>new Request(url+'/reuse',{method:'POST',body:JSON.stringify({sphereId:sphere})})
  assert.equal((await studyPdf(request(),env)).status,403);assert.equal(uploads.blobs.size,0)
  allowed=true;assert.equal((await studyPdf(request(),env)).status,200)
  assert.equal(uploads.blobs.size,1);assert.equal(cooperative.blobs.size,1)
  assert.equal(await (await studyPdf(new Request(url),env)).text(),await pdf.text())
})
test('on-demand download reaches 100, persists across opens and preserves locally annotated copies',async t=>{
  const {root}=memoryWorkspace(),hash=await digest(pdf),percent:number[]=[]
  let requests=0
  t.mock.method(globalThis,'fetch',async()=>{requests++;return new Response(pdf)})
  const reference={materialId:1,subjectId:'s',fileName:'Uno.pdf',workspaceFileId:null,sharedPdf:{roomId:room,hash,size:pdf.size}}
  const path=await downloadStudyPdf(root,reference,n=>percent.push(n))
  assert.equal(percent[0],0);assert.equal(percent.at(-1),100);assert.equal(requests,1)
  await writeFile(root,path.slice(12),new Blob(['%PDF-1.4\nanotaciones locales']))
  assert.equal(await downloadStudyPdf(root,reference,()=>assert.fail('No debe volver a descargar')),path)
  assert.equal(requests,1);assert.match(await (await readFile(root,path.slice(12)))!.text(),/anotaciones locales/)
})
test('incomplete downloads are retryable and shared boards reuse the supplied room',async t=>{
  const {root}=memoryWorkspace(),hash=await digest(pdf),reference={materialId:1,subjectId:'s',fileName:'Uno.pdf',workspaceFileId:null,sharedPdf:{roomId:room,hash,size:pdf.size}}
  t.mock.method(globalThis,'fetch',async()=>new Response('incomplete'))
  await assert.rejects(downloadStudyPdf(root,reference,()=>{}),/incompleta/)
  assert.equal(await readFile(root,`pizarrasCompartidas/${hash}.pdf`),null)
  const first=await openStudyBoard(root,'shared-test',room),again=await openStudyBoard(root,'shared-test',room)
  assert.equal(first.record.roomId,room);assert.equal(again.record.roomId,room);assert.equal(first.record.status,'accepted');assert.equal(first.snapshot,null)
  assert.equal(await publishStudyPdf(root,room,reference),reference.sharedPdf)
})
