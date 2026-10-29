"use client"
// Reused from the current board, including playback sync and segment controls.
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react"
type Tool = string
// Los videos son referencias a YouTube, no archivos descargados ni HTML arbitrario.
export type YouTubeItem = { id: string; videoId: string; x: number; y: number; width: number; height: number; start?: number; end?: number; groupId?:string; zIndex?:number }
export type VideoSync = { video_id: string; position: number; playing: boolean; start: number; end: number | null; at: number; serial: number }
type YoutubeAPIPlayer = {
  playVideo(): void; pauseVideo(): void; seekTo(seconds: number, allowSeekAhead: boolean): void
  getCurrentTime(): number; getPlayerState(): number; destroy(): void
}
type YoutubeAPI = { Player: new (element: HTMLElement, options: {
  host?: string; videoId: string; playerVars: Record<string, number | string>
  events: {onReady: () => void; onStateChange: (event: {data:number}) => void}
}) => YoutubeAPIPlayer }
let youtubeAPIWait: Promise<YoutubeAPI> | null = null
function loadYouTubePlayerAPI(): Promise<YoutubeAPI> {
  const host = window as Window & {YT?:YoutubeAPI;onYouTubeIframeAPIReady?:()=>void}
  if (host.YT?.Player) return Promise.resolve(host.YT)
  if (!youtubeAPIWait) youtubeAPIWait = new Promise((resolve,reject)=>{
    const existing = host.onYouTubeIframeAPIReady
    host.onYouTubeIframeAPIReady = () => { existing?.(); if (host.YT?.Player) resolve(host.YT); else reject(new Error('YouTube no respondió')) }
    if (!document.querySelector('script[data-board-youtube-api]')) {
      const script=document.createElement('script')
      script.src='https://www.youtube.com/iframe_api'
      script.dataset.boardYoutubeApi='true'
      script.onerror=()=>{youtubeAPIWait=null;reject(new Error('No se pudo cargar la API de YouTube'))}
      document.head.appendChild(script)
    }
  })
  return youtubeAPIWait
}
function videoTime(seconds: number): string {
  const n=Math.max(0,Math.floor(seconds))
  return `${Math.floor(n/60)}:${String(n%60).padStart(2,'0')}`
}
function parseVideoTime(text: string): number | null {
  const parts=text.trim().split(':')
  if (!parts.length || parts.length>3 || !parts.every(x=>/^\d+$/.test(x))) return null
  const values=parts.map(Number)
  if(values.slice(1).some(value=>value>=60))return null
  let total=0
  for (const value of values) total=total*60+value
  return Number.isSafeInteger(total) && total<=86400 ? total : null
}

/** Reproductor aislado: los cambios de cámara y presencia no recrean el iframe. */
export function SyncedYouTubePlayer({item,signal,connected,onBroadcast,onRange,onPointer,interactionTool,onInkPointerDown,onInkPointerMove,onInkPointerUp,onInkPointerCancel,onSelectPointerDown,onSelectPointerMove,onSelectPointerUp}:{
  item:YouTubeItem;signal?:VideoSync;connected:boolean
  onBroadcast:(id:string,action:string,position:number)=>void
  onRange:(id:string,start:number,end:number|null)=>void
  onPointer:(x:number,y:number)=>void
  interactionTool:Tool
  onInkPointerDown:(event:ReactPointerEvent<HTMLDivElement>)=>void
  onInkPointerMove:(event:ReactPointerEvent<HTMLDivElement>)=>void
  onInkPointerUp:(event:ReactPointerEvent<HTMLDivElement>)=>void
  onInkPointerCancel:(event:ReactPointerEvent<HTMLDivElement>)=>void
  onSelectPointerDown:(event:ReactPointerEvent<HTMLDivElement>)=>void
  onSelectPointerMove:(event:ReactPointerEvent<HTMLDivElement>)=>void
  onSelectPointerUp:(event:ReactPointerEvent<HTMLDivElement>)=>void
}) {
  const mountRef=useRef<HTMLDivElement>(null)
  const playerRef=useRef<YoutubeAPIPlayer|null>(null)
  const signalRef=useRef(signal)
  const onBroadcastRef=useRef(onBroadcast)
  onBroadcastRef.current=onBroadcast
  signalRef.current=signal
  const [pointMode,setPointMode]=useState(false)
  const [ready,setReady]=useState(false)
  const [failed,setFailed]=useState(false)
  const [startText,setStartText]=useState(videoTime(item.start??0))
  const [endText,setEndText]=useState(item.end===undefined?'':videoTime(item.end))
  const [rangeError,setRangeError]=useState('')
  const [needsGesture,setNeedsGesture]=useState(false)
  const suppressedRef=useRef(0)
  const lastSampleRef=useRef<{time:number;position:number;state:number}|null>(null)
  const lastHeartbeatRef=useRef(0)
  useEffect(()=>{setStartText(videoTime(item.start??0));setEndText(item.end===undefined?'':videoTime(item.end))},[item.start,item.end])
  function applySync(sync:VideoSync) {
    const player=playerRef.current
    if (!player) return
    suppressedRef.current=Date.now()+1600
    const elapsed=sync.playing?Math.max(0,Math.min(1800,Date.now()/1000-sync.at)):0
    const upper=sync.end??86400
    const target=Math.max(sync.start,Math.min(upper,sync.position+elapsed))
    const current=player.getCurrentTime()
    if (!Number.isFinite(current) || Math.abs(current-target)>1.1) player.seekTo(target,true)
    if (sync.playing && target<upper) {
      player.playVideo()
      // Un navegador puede impedir autoplay con sonido sin interacción previa.
      window.setTimeout(()=>{
        if (playerRef.current===player && player.getPlayerState()!==1) setNeedsGesture(true)
      },1400)
    } else {player.pauseVideo();setNeedsGesture(false)}
    lastSampleRef.current={time:Date.now(),position:target,state:sync.playing?1:2}
  }
  const applyRef=useRef(applySync)
  applyRef.current=applySync
  useEffect(()=>{
    if (signal && playerRef.current) applyRef.current(signal)
  },[signal?.serial])
  useEffect(()=>{
    let stopped=false
    let timer:ReturnType<typeof setInterval>|null=null
    const container=mountRef.current
    if(!container)return
    loadYouTubePlayerAPI().then(YT=>{
      if(stopped)return
      const target=document.createElement('div')
      container.appendChild(target)
      const player=new YT.Player(target,{
        host:'https://www.youtube-nocookie.com',videoId:item.videoId,
        playerVars:{playsinline:1,controls:1,rel:0,enablejsapi:1,origin:window.location.origin,start:item.start??0},
        events:{
          onReady:()=>{
            if(stopped)return
            setReady(true)
            const current=signalRef.current
            if(current)applyRef.current(current)
            lastSampleRef.current={time:Date.now(),position:player.getCurrentTime(),state:player.getPlayerState()}
          },
          onStateChange:({data})=>{
            if(stopped || Date.now()<suppressedRef.current)return
            if(data===1||data===2){
              const position=player.getCurrentTime()
              if(data===1)setNeedsGesture(false)
              onBroadcastRef.current(item.id,data===1?'play':'pause',position)
              lastSampleRef.current={time:Date.now(),position,state:data}
            }
          }
        }
      })
      playerRef.current=player
      timer=setInterval(()=>{
        if(stopped || !playerRef.current || !readyRef.current)return
        const position=player.getCurrentTime()
        const status=player.getPlayerState()
        const now=Date.now()
        if (!Number.isFinite(position))return
        const end=rangeRef.current.end
        if(end!==undefined && position>=end-.15 && status===1){
          suppressedRef.current=now+900
          player.pauseVideo();player.seekTo(rangeRef.current.start??0,true)
          onBroadcastRef.current(item.id,'pause',rangeRef.current.start??0)
          return
        }
        const previous=lastSampleRef.current
        if(previous && now>suppressedRef.current && (status===1||status===2)){
          const predicted=previous.position+(previous.state===1?(now-previous.time)/1000:0)
          if(Math.abs(position-predicted)>2.0)onBroadcastRef.current(item.id,'seek',position)
          else if(status===1 && now-lastHeartbeatRef.current>5500){
            lastHeartbeatRef.current=now
            onBroadcastRef.current(item.id,'position',position)
          }
        }
        lastSampleRef.current={time:now,position,state:status}
      },1200)
    }).catch(()=>{if(!stopped)setFailed(true)})
    return()=>{stopped=true;if(timer)clearInterval(timer);playerRef.current?.destroy();playerRef.current=null;container.replaceChildren()}
    // La identidad del video no cambia cuando actualizamos su tamaño o su segmento.
  },[item.id,item.videoId])
  const readyRef=useRef(ready)
  readyRef.current=ready
  const rangeRef=useRef(item)
  rangeRef.current=item
  function issue(action:'play'|'pause'|'seek',position?:number){
    const player=playerRef.current
    if(!player)return
    const current=position??player.getCurrentTime()
    if(action==='play'){player.playVideo();setNeedsGesture(false)}
    if(action==='pause')player.pauseVideo()
    if(action==='seek')player.seekTo(current,true)
    onBroadcast(item.id,action,current)
    lastSampleRef.current={time:Date.now(),position:current,state:action==='play'?1:2}
  }
  function applyRange(){
    const start=parseVideoTime(startText)
    const end=endText.trim()?parseVideoTime(endText):null
    if(start===null || (endText.trim() && end===null) || (end!==null && end<=start)){
      setRangeError('Usá minutos:segundos; el final debe ser mayor que el inicio.');return
    }
    setRangeError('')
    playerRef.current?.pauseVideo();playerRef.current?.seekTo(start,true)
    onRange(item.id,start,end)
  }
  return <>
    <div className="board-video-toolbar" onPointerDown={e=>e.stopPropagation()}>
      <button type="button" title="Reproducir para todos" onClick={()=>issue('play')}>▶</button>
      <button type="button" title="Pausar para todos" onClick={()=>issue('pause')}>Ⅱ</button>
      <label>Desde <input aria-label="Desde minuto" value={startText} onChange={e=>setStartText(e.target.value)} placeholder="0:00" /></label>
      <label>Hasta <input aria-label="Hasta minuto" value={endText} onChange={e=>setEndText(e.target.value)} placeholder="fin" /></label>
      <button type="button" title="Aplicar intervalo a todos" onClick={applyRange}>Aplicar</button>
      <button type="button" title="Mostrar el puntero sobre el video; los controles del video se desactivan mientras señalás"
        className={pointMode?'active':''} onClick={()=>setPointMode(x=>!x)}>{pointMode?'Puntero ✓':'Señalar'}</button>
      <span title={connected?'Sincronización conectada':'Sin conexión en tiempo real'} className="board-video-live">{connected?'●':'○'}</span>
    </div>
    {rangeError&&<div className="board-video-inline-error" role="alert">{rangeError}</div>}
    <div className="board-video-screen">
      <div className="board-video-player" ref={mountRef}/>
      {(['pen','eraser','shape','text'] as Tool[]).includes(interactionTool)&&<div className="board-video-ink-overlay"
        title="Dibujar sobre el video" onPointerDown={onInkPointerDown}
        onPointerMove={onInkPointerMove} onPointerUp={onInkPointerUp} onPointerCancel={onInkPointerCancel} onLostPointerCapture={onInkPointerCancel}/>}
      {interactionTool==='select'&&<div className="board-video-select-overlay" tabIndex={0}
        aria-label="Seleccionar el video para moverlo, copiarlo o borrarlo"
        title="Seleccionar o arrastrar el video"
        onPointerDown={e=>{e.currentTarget.focus();onSelectPointerDown(e)}}
        onPointerMove={onSelectPointerMove} onPointerUp={onSelectPointerUp}
        onPointerCancel={onSelectPointerUp} />}
      {pointMode&&interactionTool==='pan'&&<div className="board-video-point-overlay" aria-label="Señalar sobre el video"
        onPointerMove={e=>{e.stopPropagation();onPointer(e.clientX,e.clientY)}}
        onPointerEnter={e=>onPointer(e.clientX,e.clientY)} onPointerDown={e=>e.stopPropagation()}/>}
      {needsGesture&&<button type="button" className="board-video-join" onClick={()=>issue('play')}>Unirse al video</button>}
      {failed&&<div className="board-video-failed">No se pudo cargar YouTube. Revisá tu conexión.</div>}
    </div>
  </>
}
