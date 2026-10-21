import type { MediaItem } from '../storage/database'

const headphones='M18 31v-4a10 10 0 0 1 20 0v4 M18 30v9 M38 30v9'
const pause='M23 20v16 M33 20v16'
export function AudioNoteIcon({playing=false}:{playing?:boolean}) {
  return <svg viewBox="0 0 56 56" fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round" aria-hidden="true">
    <circle cx="28" cy="28" r="25" fill="white"/><path d={playing?pause:headphones}/>
    {!playing&&<><ellipse cx="18" cy="35" rx="3" ry="5" fill="currentColor"/><ellipse cx="38" cy="35" rx="3" ry="5" fill="currentColor"/></>}
  </svg>
}
export function paintAudioNote(ctx:CanvasRenderingContext2D,item:MediaItem,playing=false) {
  ctx.save();ctx.translate(item.x+item.width/2,item.y+item.height/2);ctx.rotate((item as MediaItem & {rotation?:number}).rotation??0)
  ctx.scale(item.width/56,item.height/56);ctx.translate(-28,-28)
  ctx.strokeStyle='#111';ctx.fillStyle='#fff';ctx.lineWidth=4;ctx.lineCap='round'
  ctx.beginPath();ctx.arc(28,28,25,0,Math.PI*2);ctx.fill();ctx.stroke()
  ctx.stroke(new Path2D(playing?pause:headphones))
  if(!playing){ctx.fillStyle='#111';for(const x of [18,38]){ctx.beginPath();ctx.ellipse(x,35,3,5,0,0,Math.PI*2);ctx.fill()}}
  ctx.restore()
}
