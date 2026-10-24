import { useEffect, useState } from 'react'
import App from './App'
import { selectBoard } from './biblioteca'
import { openBoardLink } from './linkSharing'

export default function SharedBoardGate(){
  const [ready,setReady]=useState(false),[error,setError]=useState(''),[attempt,setAttempt]=useState(0)
  useEffect(()=>{let alive=true;setError('');void openBoardLink().then(id=>{if(alive){selectBoard(id,false);setReady(true)}}).catch(error=>{if(alive)setError(error.message)});return()=>{alive=false}},[attempt])
  if(error)return <main style={{padding:24}}><p role="alert">{error}</p><button onClick={()=>setAttempt(n=>n+1)}>Reintentar</button></main>
  return ready?<App/>:<p role="status">Abriendo pizarra compartida…</p>
}
