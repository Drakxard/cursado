import { deviceDB, readDeviceBoard } from './storage/device'
import type { BoardContentWithExtras } from './biblioteca'
import type { ShapeItem } from './canvas/visualObjects'
import { workspaceRoot } from './canvas/countdowns'
import { mergeBoard, strokeIds } from './storage/merge'
import type { BoardPdfReference } from '../../lib/board-library-contract'
import { withWorkspaceFileLock } from '../../lib/workspace-file-lock'
import { validBoardContent } from '../../lib/board-link-model'
import { loadHomeWorkspaceBoard, saveHomeWorkspaceBoard, loadHomeWorkspaceAsset } from './workspaceBoardStorage'

type SharedFile = {hash:string;mime:string;name:string}
type Remote = {id:string;name:string;version:number;content:BoardContentWithExtras;files:Record<string,SharedFile>}
export type BoardLinkBinding = {id:string;version:number;base:BoardContentWithExtras|null;files:Record<string,SharedFile>;pending?:boolean;denied?:boolean}
type Binding=BoardLinkBinding
const apiRoot=`${location.origin}/pizarra/api/board-links`
export const linkToken=new URLSearchParams(location.search).get('link')||''
export const isLinkGuest=()=>Boolean(linkToken)
export const linkAssetCacheKey=(source:string,id:string)=>isLinkGuest()?`board-link:${source}:${id}`:`device:${id}`
let guestBoards:{id:string;name:string}[]=[]
let session:Promise<unknown>|undefined
const jobs=new Map<string,Promise<unknown>>()
const equal=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b)
class LinkError extends Error {status:number;constructor(status:number,message:string){super(message);this.status=status}}
class MissingSource extends Error {}
export async function linkRequest<T>(path:string,method='GET',body?:unknown):Promise<T> {
  const url=new URL(apiRoot+path);if(linkToken)url.searchParams.set('link',linkToken)
  const response=await fetch(url,{method,credentials:'include',signal:AbortSignal.timeout(30000),...(body===undefined?{}:{headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})})
  if(!response.ok){const data=await response.json().catch(()=>({}));throw new LinkError(response.status,data.detail||`Error al compartir (${response.status}).`)}
  return response.json()
}
export function linkSession(){return session??=(linkRequest('/session','POST',{}).catch(error=>{session=undefined;throw error}))}
const bindingKey=(source:string)=>`board-link-binding:${source}`
export async function linkBinding(source:string):Promise<Binding|undefined>{return (await deviceDB).get('meta',bindingKey(source))}
export async function restoreBoardLinkBinding(source:string,value:unknown) {
  const binding=value as Binding|undefined
  if(!binding||typeof binding.id!=='string'||!/^[a-f0-9-]{36}$/.test(binding.id)||!Number.isSafeInteger(binding.version)||binding.version<0||!validBoardContent(binding.base)||!binding.files||typeof binding.files!=='object'||Array.isArray(binding.files)||await linkBinding(source))return
  await (await deviceDB).put('meta',{id:binding.id,version:binding.version,base:binding.base,files:binding.files},bindingKey(source))
}
export async function portableBoardLinkBinding(source:string){const binding=await linkBinding(source);return binding?{id:binding.id,version:binding.version,base:binding.base,files:binding.files}:undefined}
const localGuestId=(id:string)=>`local:link-${id}`
export async function openBoardLink() {
  await linkSession()
  const result=await linkRequest<{root:string;boards:{id:string;name:string}[]}>('/open')
  guestBoards=result.boards
  const db=await deviceDB
  for(const board of guestBoards){const local=localGuestId(board.id),binding=await linkBinding(local);if(!binding)await db.put('meta',{id:board.id,version:0,base:null,files:{}},bindingKey(local));else if(binding.denied)await db.put('meta',{...binding,denied:false},bindingKey(local));if(!await readDeviceBoard(local))await db.put('boards',{key:local,id:local,name:board.name,folder_id:null,storage:'private',version:0,updated_at:new Date().toISOString(),content:{strokes:[],texts:[],media:[],shapes:[],camera:{x:0,y:0,zoom:1}}})}
  return localGuestId(result.root)
}
export async function guestLibrary(){await openBoardLink();return {folders:[],boards:guestBoards.map(board=>({id:localGuestId(board.id),name:board.name,folder_id:null,storage:'private' as const,version:0,updated_at:''}))}}
async function allBindings(){const db=await deviceDB, keys=await db.getAllKeys('meta');const result=new Map<string,Binding>();for(const key of keys)if(String(key).startsWith('board-link-binding:')){const source=String(key).slice('board-link-binding:'.length);if(source.startsWith('local:link-')===isLinkGuest())result.set(source,await db.get('meta',key))}return result}
async function encode(content:BoardContentWithExtras) {
  const result=strokeIds(structuredClone(content)), mappings=await allBindings()
  for(const shape of (result.shapes||[]) as ShapeItem[])if(shape.boardReference&&!shape.sharedUnavailable){const binding=mappings.get(shape.boardReference.boardId);if(binding){shape.boardReference.boardId=binding.id;delete shape.sharedUnavailable}else shape.sharedUnavailable=true}
  return result
}
async function decode(content:BoardContentWithExtras) {
  const result=structuredClone(content), mappings=await allBindings(), reverse=new Map([...mappings].map(([source,value])=>[value.id,source]))
  for(const shape of (result.shapes||[]) as ShapeItem[])if(shape.boardReference&&!shape.sharedUnavailable)shape.boardReference.boardId=reverse.get(shape.boardReference.boardId)||(isLinkGuest()?localGuestId(shape.boardReference.boardId):shape.boardReference.boardId)
  return result
}
async function readFile(root:FileSystemDirectoryHandle,path:string) {
  const segments=path.split('/');if(!segments.length||segments.some(part=>!part||part==='.'||part==='..'||/[\\\x00-\x1f]/.test(part)))throw new Error('Ruta de archivo inválida.')
  let directory=root;for(const part of segments.slice(0,-1))directory=await directory.getDirectoryHandle(part)
  return (await directory.getFileHandle(segments.at(-1)!)).getFile()
}
async function sourceBoard(source:string) {
  if(source.startsWith('local:important-')) {
    const root=await workspaceRoot()
    if(!root)throw new Error('Conectá la carpeta para compartir esta pizarra y sus accesos.')
    const snapshot=JSON.parse(await (await readFile(root,`progreso/pizarras/${source.slice('local:important-'.length)}.json`)).text())
    await restoreBoardLinkBinding(source,snapshot.sharedBoard)
    return {name:snapshot.name,content:snapshot.content as BoardContentWithExtras,assets:snapshot.assets as Record<string,string>}
  }
  const cached=await readDeviceBoard(source)
  const board=await loadHomeWorkspaceBoard(source,cached)??cached
  if(!board || !source.startsWith('local:') || source.startsWith('local:link-'))throw new MissingSource('No tenés permiso para publicar esta pizarra.')
  return {name:board.name,content:board.draft??board.content,assets:{} as Record<string,string>}
}
const digest=async(blob:Blob)=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',await blob.arrayBuffer()))].map(n=>n.toString(16).padStart(2,'0')).join('')
async function uploadFile(binding:Binding,key:string,blob:Blob,name:string,mime=blob.type||'application/octet-stream') {
  const hash=await digest(blob), known=binding.files[key]
  if(known?.hash===hash)return known
  const {uploadUrl}=await linkRequest<{uploadUrl:string}>(`/boards/${binding.id}/files`,'POST',{hash,size:blob.size,mime})
  const url=new URL(uploadUrl);if(url.protocol==='wss:')url.protocol='https:'
  const response=await fetch(url,{method:'PUT',headers:{'Content-Type':mime},body:blob,signal:AbortSignal.timeout(180000)})
  if(!response.ok)throw new Error(`No se pudo publicar ${name}. Reintentá compartir (${response.status}).`)
  return {hash,mime,name}
}
async function prepare(source:string,content:BoardContentWithExtras,binding:Binding,assets:Record<string,string>={}) {
  const result=await encode(content), files:Record<string,SharedFile>={}
  for(const media of result.media) {
    if(files[media.assetId])continue
    const blob=await (await deviceDB).get('assets',linkAssetCacheKey(source,media.assetId)) as Blob|undefined ?? await loadHomeWorkspaceAsset(source,media.assetId)
    if(blob)files[media.assetId]=await uploadFile(binding,media.assetId,blob,media.name)
    else if(assets[media.assetId]?.startsWith('data:'))files[media.assetId]=await uploadFile(binding,media.assetId,await (await fetch(assets[media.assetId])).blob(),media.name)
    else if(binding.files[media.assetId])files[media.assetId]=binding.files[media.assetId]
    else throw new Error(`Falta el archivo ${media.name}. No se publicó un enlace incompleto.`)
  }
  let root:FileSystemDirectoryHandle|null=null
  for(const shape of (result.shapes||[]) as ShapeItem[]) {
    if(shape.visualType!=='pdf-shortcut'||!shape.pdfReference)continue
    const reference=shape.pdfReference
    if(isLinkGuest()&&reference.sharedFileId&&binding.files[reference.sharedFileId]){files[reference.sharedFileId]=binding.files[reference.sharedFileId];continue}
    if(isLinkGuest())throw new Error('El PDF todavía no está publicado.')
    const id=`pdf_${await digest(new Blob([reference.workspaceFileId||`${reference.subjectId}:${reference.materialId}`]))}`
    let blob:Blob
    if(reference.workspaceFileId){root??=await workspaceRoot();if(!root)throw new Error('Conectá la carpeta original para compartir los PDF.');blob=await readFile(root,reference.workspaceFileId.slice(12))}
    else {const response=await fetch(`/api/subject-day-materials/${reference.materialId}/file`,{credentials:'include'});if(!response.ok)throw new Error(`No se pudo leer ${reference.fileName}.`);blob=await response.blob();if(!blob.type.includes('pdf'))throw new Error(`El archivo ${reference.fileName} no es un PDF disponible.`)}
    files[id]=await uploadFile(binding,id,blob,reference.fileName,'application/pdf');reference.sharedFileId=id
  }
  // Keep local references independent of server identities.
  void source
  return {content:result,files}
}
async function ensureBinding(source:string,name:string) {
  let binding=await linkBinding(source)
  if(!binding){const created=await linkRequest<{id:string}>('/boards','POST',{source,name});binding={id:created.id,version:0,base:null,files:{}};await (await deviceDB).put('meta',binding,bindingKey(source))}
  return binding
}
async function discover(source:string,content?:BoardContentWithExtras) {
  const visited=new Map<string,Awaited<ReturnType<typeof sourceBoard>>>()
  async function walk(id:string,override?:BoardContentWithExtras,required=false):Promise<boolean>{
    if(visited.has(id))return true
    let board:Awaited<ReturnType<typeof sourceBoard>>
    try{board=await sourceBoard(id)}catch(error){if(!required&&(error instanceof MissingSource||(error as {name?:string}).name==='NotFoundError'))return false;throw error}
    if(override)board.content=structuredClone(override)
    visited.set(id,board);await ensureBinding(id,board.name)
    for(const shape of (board.content.shapes||[]) as ShapeItem[])if(shape.visualType==='board-shortcut'&&shape.boardReference){const target=shape.boardReference.boardId;shape.sharedUnavailable=!(target.startsWith('local:')&&!target.startsWith('local:link-')&&await walk(target))}
    return true
  }
  await walk(source,content,true)
  return visited
}
async function persistSource(source:string,content:BoardContentWithExtras,base:BoardContentWithExtras) {
  const db=await deviceDB
  const tx=db.transaction('boards','readwrite'),board=await tx.store.get(source)
  if(board){const merged=mergeBoard(base,board.content,content);if(!equal(board.content,merged))await tx.store.put({...board,content:merged,version:board.version+1})}
  await tx.done
  const updated=await readDeviceBoard(source)
  if(updated)await saveHomeWorkspaceBoard(updated)
  if(source.startsWith('local:important-')) {
    const root=await workspaceRoot();if(!root)throw new Error('Conectá la carpeta de la pizarra.')
    const path=`progreso/pizarras/${source.slice('local:important-'.length)}.json`
    await withWorkspaceFileLock(path,async()=>{
    const snapshot=JSON.parse(await (await readFile(root,path)).text())
    snapshot.content=mergeBoard(base,snapshot.content,content)
    snapshot.sharedBoard=await portableBoardLinkBinding(source)
    for(const media of content.media) {
      if(snapshot.assets[media.assetId])continue
      const blob=await db.get('assets',`device:${media.assetId}`) as Blob|undefined??await linkedAsset(source,media.assetId)
      if(!blob)throw new Error('Falta una imagen de la pizarra vinculada.')
      snapshot.assets[media.assetId]=await new Promise<string>((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result));reader.onerror=()=>reject(reader.error);reader.readAsDataURL(blob)})
    }
    const parts=path.split('/');let directory=root;for(const part of parts.slice(0,-1))directory=await directory.getDirectoryHandle(part)
    const writer=await(await directory.getFileHandle(parts.at(-1)!)).createWritable();await writer.write(JSON.stringify(snapshot));await writer.close()
    window.dispatchEvent(new Event('cursado-workspace-saved'))
    })
  }
}
/** Serializes a source's baseline so overlapping refresh/save cannot acknowledge stale edits. */
async function exclusive<T>(source:string,work:()=>Promise<T>):Promise<T>{const previous=jobs.get(source)||Promise.resolve();const job=previous.catch(()=>{}).then(work);jobs.set(source,job);try{return await job}finally{if(jobs.get(source)===job)jobs.delete(source)}}
async function commit(source:string,local:BoardContentWithExtras,assets?:Record<string,string>) {
  let binding=(await linkBinding(source))!, merged=await prepare(source,local,binding,assets)
  for(let attempt=0;attempt<8;attempt++) {
    const latest=await linkRequest<Remote>(`/boards/${binding.id}`)
    const remote=latest.content
    if(remote&&!binding.base)merged={content:remote,files:latest.files}
    if(remote&&binding.base)merged.content=mergeBoard(binding.base,merged.content,remote)
    if(remote)merged.files={...latest.files,...Object.fromEntries(Object.entries(merged.files).map(([key,file])=>[key,equal(file,binding.files[key])&&latest.files[key]?latest.files[key]:file]))}
    // Only retain files referenced by the merged document.
    const ids=new Set([...merged.content.media.map(m=>m.assetId),...((merged.content.shapes||[]) as ShapeItem[]).map(s=>s.pdfReference?.sharedFileId).filter((id):id is string=>!!id)])
    merged.files=Object.fromEntries(Object.entries(merged.files).filter(([id])=>ids.has(id)))
    try {
      const result=remote&&equal(remote,merged.content)&&equal(latest.files,merged.files)?latest:await linkRequest<Remote>(`/boards/${binding.id}`,'PUT',{version:latest.version,...merged})
      binding={id:binding.id,version:result.version,base:merged.content,files:merged.files}
      await (await deviceDB).put('meta',binding,bindingKey(source))
      return await decode(merged.content)
    } catch(error){if(!(error instanceof LinkError)||error.status!==409)throw error;binding={...binding,base:remote,version:latest.version}}
  }
  throw new Error('La pizarra sigue recibiendo cambios. Reintentá sincronizar.')
}
export async function syncLinkedBoard(source:string,content:BoardContentWithExtras):Promise<{content:BoardContentWithExtras;pending:boolean}> {
  const binding=await linkBinding(source)
  if(!binding)return {content,pending:false}
  if(binding.denied)return {content,pending:true}
  return exclusive(source,async()=>{
    try {
      await linkSession()
      let prepared=content
      if(!isLinkGuest()) {
        const chain=await discover(source,content)
        prepared=chain.get(source)!.content
        for(const [id,board] of [...chain].reverse())if(id!==source)await exclusive(id,async()=>{const merged=await commit(id,board.content,board.assets);await persistSource(id,merged,board.content)})
      }
      return {content:await commit(source,prepared),pending:false}
    } catch(error){
      const current=(await linkBinding(source))!
      await (await deviceDB).put('meta',{...current,pending:true,...(error instanceof LinkError&&[401,403].includes(error.status)?{denied:true}:{})},bindingKey(source))
      if(error instanceof LinkError&&[401,403].includes(error.status)){window.dispatchEvent(new CustomEvent('pizarra:link-error',{detail:error.message}));return {content,pending:true}}
      if(error instanceof TypeError || error instanceof DOMException || navigator.onLine===false || (error instanceof LinkError&&error.status>=500))return {content,pending:true}
      throw error
    }
  })
}
export async function shareBoardLink(source:string) {
  if(isLinkGuest())throw new Error('Solo el creador puede administrar el enlace.')
  await linkSession()
  const board=await sourceBoard(source), chain=await discover(source,board.content)
  for(const [id,value] of [...chain].reverse())await exclusive(id,async()=>{const merged=await commit(id,value.content,value.assets);if(id!==source)await persistSource(id,merged,value.content)})
  const binding=(await linkBinding(source))!
  const result=await linkRequest<{token:string}>(`/boards/${binding.id}/link`,'POST',{})
  if(source.startsWith('local:important-')) {
    const root=(await workspaceRoot())!,path=`progreso/pizarras/${source.slice('local:important-'.length)}.json`
    await withWorkspaceFileLock(path,async()=>{const snapshot=JSON.parse(await(await readFile(root,path)).text());snapshot.sharedBoard=await portableBoardLinkBinding(source);let directory=root;const parts=path.split('/');for(const part of parts.slice(0,-1))directory=await directory.getDirectoryHandle(part);const writer=await(await directory.getFileHandle(parts.at(-1)!)).createWritable();await writer.write(JSON.stringify(snapshot));await writer.close()})
  }
  return `${location.origin}/pizarra/?link=${encodeURIComponent(result.token)}`
}
export async function disableBoardLink(source:string){await linkSession();const binding=await linkBinding(source);if(binding)await linkRequest(`/boards/${binding.id}/link`,'DELETE')}
export async function linkedSocketUrl(source:string){await linkSession();const binding=(await linkBinding(source))!;return (await linkRequest<{url:string}>(`/boards/${binding.id}/ticket`,'POST',{})).url}
export async function peekLinkedBoard(source:string){const binding=await linkBinding(source);if(!binding)return null;await linkSession();const latest=await linkRequest<Remote>(`/boards/${binding.id}`);if(binding.denied)await (await deviceDB).put('meta',{...binding,denied:false},bindingKey(source));if(!latest.content)return null;return {...latest,content:await decode(latest.content)}}
export async function acknowledgeLinkedBoard(source:string,remote:Remote){const binding=(await linkBinding(source))!;await (await deviceDB).put('meta',{...binding,version:remote.version,base:await encode(remote.content),files:remote.files},bindingKey(source))}
export async function cacheLinkedMedia(source:string,content:BoardContentWithExtras){const db=await deviceDB;for(const media of content.media){const key=linkAssetCacheKey(source,media.assetId);if(await db.get('assets',key))continue;const blob=await linkedAsset(source,media.assetId);if(!blob)throw new Error('Falta una imagen compartida.');await db.put('assets',blob,key)}}
export async function linkedAsset(source:string,id:string) {
  const binding=await linkBinding(source);if(!binding?.files[id])return undefined
  const response=await fetch(sharedFileUrl(binding.id,id),{credentials:'include',signal:AbortSignal.timeout(30000)})
  if(!response.ok)throw new LinkError(response.status,'No se pudo abrir el archivo compartido.')
  return response.blob()
}
export function sharedFileUrl(boardId:string,fileId:string){const url=new URL(`${apiRoot}/boards/${boardId}/files/${encodeURIComponent(fileId)}`);if(linkToken)url.searchParams.set('link',linkToken);return url.href}
export async function sharedPdfUrl(source:string,reference:BoardPdfReference){const binding=await linkBinding(source);if(!binding||!reference.sharedFileId)throw new Error('Este PDF no está publicado.');return sharedFileUrl(binding.id,reference.sharedFileId)}
