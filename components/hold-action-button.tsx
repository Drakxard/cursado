"use client"
import { useEffect, useRef, type ButtonHTMLAttributes } from 'react'
export function HoldActionButton({onHold,onClick,...props}:ButtonHTMLAttributes<HTMLButtonElement>&{onHold:()=>void}) {
  const timer=useRef<ReturnType<typeof setTimeout>|null>(null),held=useRef(false),start=useRef({x:0,y:0})
  const pointer=useRef<number|null>(null)
  const cancel=()=>{if(timer.current)clearTimeout(timer.current);timer.current=null}
  useEffect(()=>cancel,[])
  return <button {...props} onPointerDown={event=>{
    if(event.button!==0)return
    cancel();pointer.current=event.pointerId;held.current=false;start.current={x:event.clientX,y:event.clientY}
    event.currentTarget.setPointerCapture(event.pointerId)
    timer.current=setTimeout(()=>{timer.current=null;held.current=true;onHold()},600)
  }} onPointerMove={event=>{if(pointer.current===event.pointerId&&Math.hypot(event.clientX-start.current.x,event.clientY-start.current.y)>5){cancel();held.current=true}}}
  onPointerUp={()=>{cancel();pointer.current=null}} onPointerCancel={()=>{cancel();pointer.current=null;held.current=true}}
  onLostPointerCapture={cancel} onBlur={cancel}
  onKeyDown={event=>{if(event.key==='Enter'&&event.shiftKey){event.preventDefault();onHold()}}}
  onContextMenu={event=>event.preventDefault()} onClick={event=>{if(held.current){event.preventDefault();held.current=false;return}onClick?.(event)}} />
}
