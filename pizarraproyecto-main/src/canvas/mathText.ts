import { toCanvas } from 'html-to-image'
import { mathMarkup, messageParts } from '../assistant/messageFormat'
import { containsUrl } from './mindmap'
import 'katex/dist/katex.min.css'

export type TextStyle={fontSize:number;color:string;width?:number;fontFamily?:string;bold?:boolean;italic?:boolean;strike?:boolean;align?:'left'|'center'|'right';lineHeight?:number}
type Entry={width:number;height:number;image?:HTMLCanvasElement;ready:Promise<void>;used:number;done?:boolean}
const cache=new Map<string,Entry>()
let sequence=0,queue=Promise.resolve(),pixels=0,pins=0
const MAX_PIXELS=16000000
export const hasMath=(text:string)=>!containsUrl(text)&&messageParts(text.replace(/<latex>([\s\S]*?)<\/latex>/g,'\\($1\\)')).some(part=>part.kind==='math')

function content(node:HTMLElement,text:string) {
  for(const part of messageParts(text.replace(/<latex>([\s\S]*?)<\/latex>/g,'\\($1\\)'))) {
    const span=document.createElement('span'),markup=part.kind==='math'?mathMarkup(part.text,part.display):null
    if(markup)span.innerHTML=markup
    else span.textContent=part.raw??part.text
    node.append(span)
  }
}
function element(text:string,style:TextStyle,math:boolean) {
  const node=document.createElement('div')
  Object.assign(node.style,{position:'fixed',left:'-100000px',top:'0',pointerEvents:'none',width:style.width?`${style.width}px`:'max-content',maxWidth:'4096px',
    font:`${style.italic?'italic ':''}${style.bold?'700 ':''}${style.fontSize}px ${style.fontFamily||'system-ui,sans-serif'}`,color:style.color,
    lineHeight:String(style.lineHeight??1.25),whiteSpace:'pre-wrap',overflowWrap:'anywhere',textAlign:style.align||'left',textDecoration:style.strike?'line-through':'none'})
  if(math)content(node,text);else node.textContent=text
  document.body.append(node)
  return node
}
function prune() {
  if(pins)return
  for(const [key,value] of [...cache].sort((a,b)=>a[1].used-b[1].used)) {
    if(cache.size<=256&&pixels<=MAX_PIXELS)break
    if(!value.done)continue
    if(value.image){pixels-=value.image.width*value.image.height;value.image=undefined}
    if(cache.size>256)cache.delete(key)
  }
}
export function mathText(text:string,style:TextStyle):Entry|null {
  if(!hasMath(text))return null
  const key=JSON.stringify([text,style]),old=cache.get(key)
  if(old){old.used=++sequence;return old}
  const node=element(text,style,true),bounds=node.getBoundingClientRect()
  const entry:Entry={width:Math.max(1,Math.ceil(bounds.width)),height:Math.max(1,Math.ceil(bounds.height)),used:++sequence,ready:Promise.resolve()}
  node.remove();cache.set(key,entry)
  // Serialize rasterization; camera changes never enqueue duplicate work.
  entry.ready=queue=queue.catch(()=>{}).then(async()=>{
    let render:HTMLElement|undefined
    try {
      await document.fonts.ready
      render=element(text,style,true)
      const measured=render.getBoundingClientRect()
      entry.width=Math.max(1,Math.ceil(measured.width));entry.height=Math.max(1,Math.ceil(measured.height))
      const ratio=Math.min(2,4096/entry.width,4096/entry.height,Math.sqrt(MAX_PIXELS/4/entry.width/entry.height))
      entry.image=await toCanvas(render,{pixelRatio:ratio,width:entry.width,height:entry.height,style:{position:'static',left:'auto',top:'auto'},skipAutoScale:false})
      entry.image.dataset.boardMath='true'
      pixels+=entry.image.width*entry.image.height
    }catch { /* Plain canvas text remains visible if rasterization is unavailable. */ }
    finally {entry.done=true;render?.remove();prune();window.dispatchEvent(new Event('board-math-ready'))}
  })
  return entry
}
export async function withMathImages<T>(prepare:()=>void,render:()=>Promise<T>):Promise<T> {
  pins++
  try {await document.fonts.ready;prepare();await queue;return await render()}
  finally {pins--;prune()}
}
