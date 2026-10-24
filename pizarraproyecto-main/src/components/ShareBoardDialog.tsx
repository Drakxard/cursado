import { useEffect, useRef, useState } from 'react'
import { disableBoardLink, shareBoardLink } from '../linkSharing'
import { getActiveBoardId } from '../biblioteca'
import { flushNavigationSaves } from '../homeNavigation'

export default function ShareBoardDialog({onClose}:{onClose:()=>void}) {
  const [url,setUrl]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState('')
  const started=useRef(false)
  useEffect(()=>{if(!started.current){started.current=true;void share()}},[])
  async function share(){setBusy(true);setError('');setMessage('');try{await flushNavigationSaves();const link=await shareBoardLink(getActiveBoardId());setUrl(link);try{await navigator.clipboard.writeText(link);setMessage('Enlace copiado.')}catch{setMessage('Copiá el enlace de abajo.')}}catch(error){setError(error instanceof Error?error.message:String(error))}finally{setBusy(false)}}
  async function disable(){setBusy(true);setError('');try{await disableBoardLink(getActiveBoardId());setUrl('');setMessage('Enlace desactivado.')}catch(error){setError(String(error))}finally{setBusy(false)}}
  return <div className="anon-modal-backdrop"><section className="anon-modal" role="dialog" aria-modal="true" aria-label="Compartir pizarra por link"><h2>Compartir via link</h2><p>Quien tenga el enlace puede editar esta pizarra y las pizarras vinculadas, y abrir sus PDF.</p><button disabled={busy} onClick={()=>void share()}>{busy?'Preparando…':url?'Copiar enlace':'Crear y copiar enlace'}</button>{url&&<textarea aria-label="Enlace para compartir" readOnly value={url} onFocus={e=>e.currentTarget.select()}/>}<button disabled={busy} onClick={()=>void disable()}>Desactivar enlace</button>{message&&<p role="status">{message}</p>}{error&&<p role="alert">{error}</p>}<button disabled={busy} onClick={onClose}>Cerrar</button></section></div>
}
