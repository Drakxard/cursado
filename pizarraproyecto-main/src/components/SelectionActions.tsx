import { useLayoutEffect, useRef, type MutableRefObject, type ReactNode } from 'react'
import type { ObjectToolbarHandle } from './AdvancedObjectToolbar'
import './AdvancedObjectToolbar.css'
export default function SelectionActions({ children, bounds, layoutRef }: { children: ReactNode; bounds:()=>{x:number;y:number;width:number;height:number;viewportWidth:number;viewportHeight:number}|null;layoutRef:MutableRefObject<ObjectToolbarHandle|null> }) {
  const root=useRef<HTMLDivElement>(null)
  useLayoutEffect(()=>{
    const layout=()=>{
      const rect=bounds(),node=root.current
      if(!rect||!node)return
      node.style.left=`${Math.max(8,Math.min(rect.x+rect.width/2-node.offsetWidth/2,rect.viewportWidth-node.offsetWidth-8))}px`
      node.style.top=`${Math.max(8,Math.min(rect.y-node.offsetHeight-14>=8?rect.y-node.offsetHeight-14:rect.y+rect.height+14,rect.viewportHeight-node.offsetHeight-8))}px`
      node.style.visibility=rect.x+rect.width<0||rect.y+rect.height<0||rect.x>rect.viewportWidth||rect.y>rect.viewportHeight?'hidden':'visible'
    }
    layoutRef.current={layout};layout();window.addEventListener('resize',layout)
    return()=>{window.removeEventListener('resize',layout);layoutRef.current=null}
  })
  return <div ref={root} role="toolbar" aria-label="Propiedades de la selección" className="advanced-object-toolbar" onPointerDown={e=>e.stopPropagation()} onKeyDown={e=>e.stopPropagation()}>{children}</div>
}
