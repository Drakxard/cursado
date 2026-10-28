import { useEffect, useLayoutEffect, useRef, useState, type MutableRefObject } from 'react'
import type { ShapeItem, ShapeKind } from '../canvas/visualObjects'
import { beforeHome } from '../homeNavigation'
import { labelFont, labelLines } from '../canvas/labelLayout'
import './AdvancedObjectToolbar.css'

export type ObjectToolbarHandle = { layout: () => void }
type Rect = { x: number; y: number; width: number; height: number; viewportWidth: number; viewportHeight: number;editor?:{x:number;y:number;width:number;height:number} }
const colors = ['#202020','#777777','#fa4f26','#ffa43b','#ffd447','#6bd079','#60d6ce','#38a8f8','#9747ff','#fa52b8','#ffffff','#b3b3b3','#dddddd','#ffc6c2','#ffe1c2','#ffedbb','#ccf1d3','#c1f5ef','#c2e8ff','#e5ccff','#ffc1eb']
const kinds: [ShapeKind,string][] = [['rectangle','Rectángulo'],['rounded','Redondeado'],['ellipse','Elipse'],['circle','Círculo'],['diamond','Rombo'],['triangle','Triángulo'],['hexagon','Hexágono'],['line','Línea'],['arrow','Flecha'],['double-arrow','Doble flecha'],['cylinder','Cilindro']]
export default function AdvancedObjectToolbar({ item, patch, bounds, layoutRef, editing, onEdit, onEndEdit }: {
  item: ShapeItem; patch: (patch: Partial<ShapeItem>) => void; bounds: () => Rect | null
  layoutRef: MutableRefObject<ObjectToolbarHandle | null>; editing: boolean; onEdit: () => void; onEndEdit: () => void
}) {
  const root = useRef<HTMLDivElement>(null), editor = useRef<HTMLTextAreaElement>(null), popup = useRef<HTMLDivElement>(null)
  const [menu, setMenu] = useState<'shape'|'fill'|'border'|'text'|'link'|null>(null), [draft, setDraft] = useState(item.label || '')
  const dirtyRef = useRef(false)
  const draftRef = useRef(draft), itemRef = useRef(item), patchRef = useRef(patch)
  const endRef=useRef(onEndEdit)
  endRef.current=onEndEdit
  itemRef.current = item; patchRef.current = patch
  const save = () => { if (dirtyRef.current && draftRef.current !== (itemRef.current.label || '')) patchRef.current({ label: draftRef.current }); dirtyRef.current=false }
  useEffect(() => { if (editing) { setDraft(item.label || ''); draftRef.current = item.label || ''; editor.current?.focus() } }, [editing])
  useEffect(() => beforeHome(async () => { save() }), [])
  useEffect(() => () => { save();endRef.current() }, [])
  const layout = () => {
    const rect = bounds(), node = root.current
    if (!rect || !node) return
    const { x,y,width,height,viewportWidth:vw,viewportHeight:vh } = rect
    node.style.visibility = x+width<0 || y+height<0 || x>vw || y>vh ? 'hidden' : 'visible'
    const w = node.offsetWidth, h = node.offsetHeight
    const above = y-h-14 >= 8
    node.style.left = `${Math.max(8,Math.min(x+width/2-w/2,vw-w-8))}px`
    node.style.top = `${Math.max(8,Math.min(above?y-h-14:y+height+14,vh-h-8))}px`
    if (popup.current) {
      const p = popup.current, left = parseFloat(node.style.left), top = parseFloat(node.style.top)
      p.style.maxWidth = `${Math.max(1,vw-16)}px`
      p.style.left = `${Math.max(8,Math.min(left,vw-p.offsetWidth-8))-left}px`
      p.style.top = `${Math.max(8,Math.min(top+h+8+p.offsetHeight<=vh-8?top+h+8:top-p.offsetHeight-8,vh-p.offsetHeight-8))-top}px`
    }
    if (editor.current) {
      const box=rect.editor??rect,scale=box.width/Math.max(1,item.width),font=item.labelFontSize??16
      const measure=document.createElement('canvas').getContext('2d')!
      measure.font=labelFont(item)
      const lines=labelLines(measure,draftRef.current,Math.max(1,item.width-24))
      Object.assign(editor.current.style, { left: `${box.x}px`, top: `${box.y}px`, width: `${box.width}px`, height: `${box.height}px`, fontSize: `${font*scale}px`,
        padding:`${Math.max(4,(item.height-lines.length*font*1.25)/2)*scale}px ${12*scale}px ${4*scale}px`,transform: `rotate(${item.rotation||0}rad)` })
    }
  }
  useLayoutEffect(() => { layoutRef.current = { layout }; layout(); const resize = new ResizeObserver(layout); if(root.current)resize.observe(root.current); if(popup.current)resize.observe(popup.current); window.addEventListener('resize',layout); return () => { resize.disconnect(); window.removeEventListener('resize',layout); layoutRef.current=null } })
  useEffect(() => { const close = (e: PointerEvent) => { if (!root.current?.contains(e.target as Node)) setMenu(null) }; window.addEventListener('pointerdown',close); return () => window.removeEventListener('pointerdown',close) }, [])
  const toggle = (name: typeof menu) => setMenu(menu===name?null:name)
  return <>
    {editing && <textarea ref={editor} aria-label="Texto de la figura" className="shape-inline-editor" value={draft} placeholder="Agregar texto" spellCheck={false} style={{ color:item.labelColor||item.color, fontFamily:item.labelFontFamily||'system-ui',fontWeight:item.labelBold?700:400,fontStyle:item.labelItalic?'italic':'normal',textAlign:item.labelAlign||'center',textDecoration:item.labelStrike?'line-through':'none' }} onPointerDown={e=>e.stopPropagation()} onChange={e=>{dirtyRef.current=true;setDraft(e.target.value);draftRef.current=e.target.value}} onBlur={e=>{save();if(root.current?.contains(e.relatedTarget as Node))return;onEndEdit()}} onKeyDown={e=>{e.stopPropagation();if(e.nativeEvent.isComposing)return;if(e.key==='Escape'){e.preventDefault();save();onEndEdit()}else if(e.key==='Enter'&&(e.ctrlKey||e.metaKey)){e.preventDefault();save();onEndEdit()}}} />}
    <div ref={root} className="advanced-object-toolbar" role="toolbar" aria-label="Propiedades de la figura" onPointerDown={e=>e.stopPropagation()} onKeyDown={e=>e.stopPropagation()}>
      <button aria-label="Tipo de figura" aria-expanded={menu==='shape'} onClick={()=>toggle('shape')}>▢⌄</button>
      <button aria-label="Relleno" aria-expanded={menu==='fill'} onClick={()=>toggle('fill')}><span className="object-fill-swatch" style={{background:item.fill||'transparent'}}/>⌄</button>
      <button aria-label="Borde" aria-expanded={menu==='border'} onClick={()=>toggle('border')}>☰⌄</button>
      <button aria-label="Editar texto de la figura" onClick={onEdit}>Aa</button>
      {(editing || item.label) && <><button aria-label="Tipografía" onClick={()=>toggle('text')}>Texto⌄</button><button aria-label="Negrita" aria-pressed={!!item.labelBold} onClick={()=>patch({labelBold:!item.labelBold})}><b>B</b></button><button aria-label="Tachado" aria-pressed={!!item.labelStrike} onClick={()=>patch({labelStrike:!item.labelStrike})}><s>S</s></button><button aria-label="Enlace" onClick={()=>toggle('link')}>↗</button><button aria-label="Lista" aria-pressed={!!item.labelList} onClick={()=>patch({labelList:!item.labelList})}>☷</button><button aria-label="Alineación" onClick={()=>patch({labelAlign:item.labelAlign==='left'?'center':item.labelAlign==='center'?'right':'left'})}>≡</button></>}
      {menu && <div ref={popup} className="object-toolbar-popup">
        {menu==='shape' && <label>Figura<select value={item.kind} onChange={e=>patch({kind:e.target.value as ShapeKind})}>{kinds.map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></label>}
        {menu==='fill' && <><div className="object-fill-modes"><button aria-pressed={!!item.fill && item.fillOpacity!==.35} onClick={()=>patch({fill:item.fill||'#ffe1c2',fillOpacity:1})}>Relleno</button><button aria-pressed={item.fillOpacity===.35} onClick={()=>patch({fill:item.fill||'#ffe1c2',fillOpacity:.35})}>Transparente</button><button aria-pressed={!item.fill} onClick={()=>patch({fill:undefined})}>Sin relleno</button></div><div className="object-color-grid">{colors.map(color=><button key={color} aria-label={`Relleno ${color}`} aria-pressed={item.fill===color} style={{background:color}} onClick={()=>patch({fill:color})}/>) }<input aria-label="Color personalizado de relleno" type="color" value={item.fill||'#ffe1c2'} onChange={e=>patch({fill:e.target.value})}/></div></>}
        {menu==='border' && <><label>Color<input type="color" value={/^#[0-9a-f]{6}$/i.test(item.color)?item.color:'#202020'} onChange={e=>patch({color:e.target.value})}/></label><label>Grosor<input type="number" min="0" max="32" value={item.strokeWidth} onChange={e=>patch({strokeWidth:Math.max(0,Math.min(32,Number(e.target.value)))})}/></label><label>Trazo<select value={item.strokeStyle||'solid'} onChange={e=>patch({strokeStyle:e.target.value as ShapeItem['strokeStyle']})}><option value="solid">Continuo</option><option value="dash">Discontinuo</option><option value="dot">Punteado</option></select></label></>}
        {menu==='link' && <><label>Enlace<input aria-label="Enlace de la figura" type="url" placeholder="https://" defaultValue={item.labelHref||''} onBlur={e=>{try{const url=new URL(e.target.value);if(['https:','http:'].includes(url.protocol))patch({labelHref:url.href})}catch{if(!e.target.value)patch({labelHref:undefined})}}}/></label>{item.labelHref&&/^https?:/.test(item.labelHref)&&<a href={item.labelHref} target="_blank" rel="noopener noreferrer">Abrir enlace ↗</a>}</>}
        {menu==='text' && <><label>Fuente<select value={item.labelFontFamily||'system-ui'} onChange={e=>patch({labelFontFamily:e.target.value})}><option value="system-ui">Sans serif</option><option value="Georgia">Serif</option><option value="monospace">Monoespaciada</option></select></label><label>Tamaño<input type="number" min="8" max="144" value={item.labelFontSize||16} onChange={e=>patch({labelFontSize:Math.max(8,Math.min(144,Number(e.target.value)))})}/></label><label>Color<input aria-label="Color del texto" type="color" value={item.labelColor||'#202020'} onChange={e=>patch({labelColor:e.target.value})}/></label><button aria-pressed={!!item.labelItalic} onClick={()=>patch({labelItalic:!item.labelItalic})}>Cursiva</button></>}
      </div>}
    </div>
  </>
}
