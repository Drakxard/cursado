import type { MediaItem, Point } from './storage/database'

export const AUDIO_SIZE = 56
export const audioMimeType = () => ['audio/webm;codecs=opus','audio/ogg;codecs=opus','audio/webm','audio/mp4'].find(type => MediaRecorder.isTypeSupported(type))
export type AudioDraft = { item: MediaItem; phase: 'permission'|'recording'|'saving'|'error'; placed: boolean; seconds: number; blob?: Blob; error?: string }
type Options = {
  boardId: () => string
  load: (id: string) => Promise<Blob | undefined>
  commit: (item: MediaItem, blob: Blob) => Promise<void>
  changed: () => void
}

/** One microphone and one lazy player per board. No playback clock or render loop. */
export class BoardAudio {
  draft: AudioDraft | null = null
  error = ''
  playingId: string | null = null
  private stream: MediaStream | null = null
  private recorder: MediaRecorder | null = null
  private chunks: Blob[] = []
  private timer: ReturnType<typeof setInterval> | undefined
  private started = 0
  private epoch = 0
  private draftBoard = ''
  private starting: Promise<void> | null = null
  private finishing: Promise<void> | null = null
  private stopped: Promise<void> | null = null
  private resolveStopped: (() => void) | null = null
  private player: HTMLAudioElement | null = null
  private playerId: string | null = null
  private playerUrl: string | null = null
  private playbackEpoch = 0
  private positions = new Map<string,number>()
  options: Options
  constructor(options: Options) { this.options=options }
  private changed() { this.options.changed() }
  start(point: Point) {
    if (this.draft || this.starting) return
    const epoch = ++this.epoch
    this.error = ''
    this.draftBoard = this.options.boardId()
    this.draft = {item:{id:crypto.randomUUID(),assetId:crypto.randomUUID(),kind:'audio',name:'Nota de audio',x:point.x-AUDIO_SIZE/2,y:point.y-AUDIO_SIZE/2,width:AUDIO_SIZE,height:AUDIO_SIZE},phase:'permission',placed:false,seconds:0}
    this.changed()
    this.starting = (async () => {
      let stream: MediaStream | undefined
      try {
        if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') throw new Error('Este navegador no permite grabar audio. Abrí la pizarra con HTTPS y un micrófono.')
        stream = await navigator.mediaDevices.getUserMedia({audio:{channelCount:1,echoCancellation:true,noiseSuppression:true}})
        if (epoch !== this.epoch) { stream.getTracks().forEach(track=>track.stop()); return }
        this.stream = stream
        const mimeType = audioMimeType()
        const recorder = new MediaRecorder(stream,{...(mimeType?{mimeType}:{}),audioBitsPerSecond:32000})
        this.recorder = recorder
        this.chunks = []
        let stopped!: () => void
        this.stopped = new Promise(resolve=>{stopped=resolve;this.resolveStopped=resolve})
        recorder.ondataavailable = event => { if(epoch===this.epoch && event.data.size) this.chunks.push(event.data) }
        recorder.onstop = () => { if(this.recorder===recorder){this.releaseMicrophone();this.resolveStopped=null} stopped() }
        recorder.onerror = () => { if(epoch===this.epoch) void this.finish().catch(()=>{}) }
        recorder.start(1000)
        this.started = performance.now()
        this.draft!.phase = 'recording'
        this.timer = setInterval(()=>{if(this.draft){this.draft.seconds=Math.floor((performance.now()-this.started)/1000);this.changed()}},1000)
        this.changed()
      } catch (error) {
        stream?.getTracks().forEach(track=>track.stop())
        if(epoch===this.epoch){this.releaseMicrophone();this.draft=null;this.error=error instanceof Error?error.message:'No se pudo abrir el micrófono.';this.changed()}
      }
    })().finally(()=>{this.starting=null})
  }
  move(point: Point) {
    if (!this.draft || this.draft.placed) return false
    this.draft.item.x = point.x-AUDIO_SIZE/2; this.draft.item.y = point.y-AUDIO_SIZE/2
    return true
  }
  place() { if(this.draft){this.draft.placed=true;this.changed()} }
  finish(): Promise<void> {
    if(this.finishing)return this.finishing
    this.finishing=this.finishDraft().finally(()=>{this.finishing=null})
    return this.finishing
  }
  private async finishDraft() {
    await this.starting
    const draft=this.draft,epoch=this.epoch
    if(!draft)return
    draft.placed=true
    if(!draft.blob){
      draft.item.durationMs=Math.max(0,Math.round(performance.now()-this.started))
      const recorder=this.recorder
      if(recorder && recorder.state!=='inactive')recorder.stop()
      await this.stopped
      if(epoch!==this.epoch)return
      this.releaseMicrophone()
      draft.blob=new Blob(this.chunks,{type:recorder?.mimeType || this.chunks[0]?.type || 'audio/webm'})
      draft.item.mimeType=draft.blob.type
      this.chunks=[];this.recorder=null
    }
    try {
      if(this.draftBoard!==this.options.boardId())throw new Error('La pizarra cambió antes de guardar la nota.')
      if(!draft.blob.size)throw new Error('La grabación está vacía. Descartala y volvé a grabar.')
      draft.phase='saving';draft.error=undefined;this.changed()
      await this.options.commit(draft.item,draft.blob)
      if(epoch===this.epoch){this.draft=null;this.changed()}
    } catch(error) {
      if(epoch===this.epoch){draft.phase='error';draft.error=error instanceof Error?error.message:'No se pudo guardar el audio.';this.changed()}
      throw error
    }
  }
  private releaseMicrophone() {
    clearInterval(this.timer);this.timer=undefined
    this.stream?.getTracks().forEach(track=>track.stop());this.stream=null
  }
  cancel() {
    if(this.draft?.phase==='saving')return
    ++this.epoch
    const recorder=this.recorder
    if(recorder && recorder.state!=='inactive')recorder.stop()
    this.releaseMicrophone();this.resolveStopped?.();this.resolveStopped=null
    this.recorder=null;this.chunks=[];this.draft=null;this.changed()
  }
  private releasePlayer() {
    ++this.playbackEpoch
    if(this.player){this.positions.set(this.playerId!,this.player.currentTime);this.player.onended=null;this.player.onpause=null;this.player.onerror=null;this.player.onloadedmetadata=null;this.player.pause();this.player.removeAttribute('src');this.player.load()}
    if(this.playerUrl)URL.revokeObjectURL(this.playerUrl)
    this.player=null;this.playerUrl=null;this.playerId=null;this.playingId=null
  }
  async toggle(item: MediaItem) {
    if(this.playerId===item.id && this.player){
      if(!this.player.paused){this.player.pause();this.playingId=null;this.changed();return}
      const player=this.player
      try{await player.play();if(this.player===player){this.playingId=item.id;this.changed()}}catch{if(this.player===player){this.error='No se pudo reproducir el audio.';this.changed()}}
      return
    }
    this.releasePlayer()
    const epoch=this.playbackEpoch,board=this.options.boardId()
    try{
      const blob=await this.options.load(item.assetId)
      if(epoch!==this.playbackEpoch || board!==this.options.boardId())return
      if(!blob)throw new Error('Falta el archivo de esta nota. Esperá a que termine la sincronización y reintentá.')
      const player=new Audio()
      this.player=player;this.playerId=item.id
      this.playerUrl=URL.createObjectURL(item.mimeType?new Blob([blob],{type:item.mimeType}):blob)
      player.src=this.playerUrl
      player.onloadedmetadata=()=>{if(this.positions.has(item.id))player.currentTime=Math.min(this.positions.get(item.id)!,this.duration(item,player))}
      player.onended=()=>{player.currentTime=0;this.positions.set(item.id,0);this.playingId=null;this.changed()}
      player.onpause=()=>{if(this.player===player){this.positions.set(item.id,player.currentTime);this.playingId=null;this.changed()}}
      player.onerror=()=>{if(this.player===player){this.error='No se pudo reproducir el archivo de audio.';this.releasePlayer();this.changed()}}
      await player.play()
      if(epoch!==this.playbackEpoch)return
      this.playingId=item.id;this.error='';this.changed()
    }catch(error){if(epoch===this.playbackEpoch){this.releasePlayer();this.error=error instanceof Error?error.message:'No se pudo reproducir el audio.';this.changed()}}
  }
  private duration(item: MediaItem, player: HTMLAudioElement) { return Number.isFinite(player.duration)?player.duration:(item.durationMs??0)/1000 }
  seek(item: MediaItem, delta: number) {
    if(this.playerId===item.id && this.player){const target=Math.max(0,Math.min(this.duration(item,this.player),(this.player.readyState?this.player.currentTime:this.positions.get(item.id)??0)+delta));this.positions.set(item.id,target);if(this.player.readyState)this.player.currentTime=target}
    else this.positions.set(item.id,Math.max(0,Math.min((item.durationMs??0)/1000,(this.positions.get(item.id)??0)+delta)))
  }
  reconcile(items: MediaItem[]) {
    if(this.playerId && !items.some(item=>item.id===this.playerId && item.kind==='audio'))this.releasePlayer()
    for(const id of this.positions.keys())if(!items.some(item=>item.id===id))this.positions.delete(id)
  }
  dispose() { this.cancel();++this.epoch;this.draft=null;this.releaseMicrophone();this.releasePlayer();this.positions.clear() }
}
