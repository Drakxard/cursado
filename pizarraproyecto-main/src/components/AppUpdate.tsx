import {useEffect,useRef,useState} from 'react'
import {applyAppUpdate,offlineUpdateReady} from '../pwa'
import './appUpdate.css'

export default function AppUpdate(){
  const [available,setAvailable]=useState(offlineUpdateReady),[error,setError]=useState('')
  const [retry,setRetry]=useState(0)
  const busy=useRef(false)
  useEffect(()=>{const refresh=()=>setAvailable(offlineUpdateReady());window.addEventListener('pizarra-offline-ready',refresh);refresh();return()=>window.removeEventListener('pizarra-offline-ready',refresh)},[])
  useEffect(()=>{
    if(!available)return
    // The next opening receives the new version without restarting an open topic.
    if(window.parent!==window && new URLSearchParams(location.search).has('topicBoard'))return
    let timer:ReturnType<typeof setTimeout>,disposed=false,blocked=false,revision=0
    const pointers=new Set<number>()
    const idle=()=>!disposed&&document.visibilityState==='visible'&&!pointers.size&&
      !(document.activeElement instanceof HTMLIFrameElement)&&
      !document.activeElement?.closest('input,textarea,select,[contenteditable="true"]')&&
      !document.querySelector('[role="dialog"],.math-panel,.code-workspace,.visual-inspector,.binary-tree-panel')
    const schedule=()=>{clearTimeout(timer);if(!disposed&&!blocked)timer=setTimeout(()=>void update(),2000)}
    async function update(){
      if(busy.current||!idle()){schedule();return}
      const start=revision
      busy.current=true
      let reloading=false
      try{reloading=await applyAppUpdate(()=>idle()&&revision===start)}
      catch{blocked=true;clearTimeout(timer);setError('No se pudo guardar. La app no se actualizó para conservar tus cambios.');return}
      finally{busy.current=false}
      if(!reloading)schedule()
    }
    const activity=(event:Event)=>{
      if(event instanceof PointerEvent){
        if(event.type==='pointerdown')pointers.add(event.pointerId)
        if(event.type==='pointerup'||event.type==='pointercancel')pointers.delete(event.pointerId)
      }
      if(event.type==='visibilitychange'&&document.visibilityState==='hidden')pointers.clear()
      revision++;schedule()
    }
    const events=['pointerdown','pointermove','pointerup','pointercancel','keydown','input','wheel','focusin','focusout','visibilitychange']
    for(const event of events)document.addEventListener(event,activity,true)
    schedule()
    return()=>{disposed=true;clearTimeout(timer);for(const event of events)document.removeEventListener(event,activity,true)}
  },[available,retry])
  if(!error)return null
  return <aside className="app-update" aria-label="No se pudo actualizar la app">
    <p role="alert">{error}</p><button onClick={()=>{setError('');setRetry(value=>value+1)}}>Reintentar actualización</button>
  </aside>
}
