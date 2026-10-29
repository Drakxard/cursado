"use client"
// Existing board table editor, reused with its formula bar, ranges and keyboard behavior.
import { Fragment, useEffect, useMemo, useRef, useState, type Ref, type CSSProperties, type PointerEvent as ReactPointerEvent, type MouseEvent as ReactMouseEvent, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { createFormulaEvaluator } from '../pizarraproyecto-main/src/formulas_excel'
import { tableChrome, tableFontSize, labelColumn, type SheetItem, type SheetCell } from '../pizarraproyecto-main/src/components/StaticTable'
import '../pizarraproyecto-main/src/formas_excel.css'
type Point = {x:number;y:number}
type Camera = {x:number;y:number;zoom:number}
type SheetRange = {r0:number;c0:number;r1:number;c1:number}
const MAX_EXCEL_ROWS=180, MAX_EXCEL_COLS=32
function rotationOffset(width: number, height: number, rotation: number): Point {
  const center = { x: width / 2, y: height / 2 }
  const moved = rotateAround(center, { x: 0, y: 0 }, rotation)
  return { x: center.x - moved.x, y: center.y - moved.y }
}
export function InlineTableEditor({ table, camera, anchorRef, onChange, onCellChange, onPasteCells,
  onAddRow, onAddColumn, onCopyRange, onExport, onMoveStart, onMove, onMoveEnd, onContextMenu, notice }:{
  key?:string; table:SheetItem; camera:Camera; anchorRef:Ref<HTMLDivElement>;
  onChange:(update:(current:SheetItem)=>SheetItem)=>void;
  onCellChange:(row:number,col:number,value:string)=>void;
  onPasteCells:(row:number,col:number,value:string)=>void;
  onAddRow:()=>void;onAddColumn:()=>void;onCopyRange:(range:SheetRange)=>void;onExport:()=>void;
  onMoveStart:()=>void;onMove:(x:number,y:number)=>void;onMoveEnd:()=>void;notice:string;
  onContextMenu?:(event:ReactMouseEvent<HTMLElement>)=>void;
}) {
  const [active,setActive] = useState({r:0,c:0})
  const [range,setRange] = useState<SheetRange>({r0:0,c0:0,r1:0,c1:0})
  const [referenceRange,setReferenceRange] = useState<SheetRange|null>(null)
  const [editing,setEditing] = useState(false)
  const [editingField,setEditingField] = useState<'cell'|'bar'>('cell')
  const [draft,setDraft] = useState('')
  const draftRef = useRef('')
  const originalRef = useRef('')
  const gridRef = useRef<HTMLDivElement>(null)
  const cellInputRef = useRef<HTMLInputElement>(null)
  const formulaInputRef = useRef<HTMLInputElement>(null)
  const dragRef = useRef<{kind:'selection'|'reference';startR:number;startC:number}|null>(null)
  const referenceInsertRef = useRef<{before:string;after:string;startR:number;startC:number}|null>(null)
  const lastReferenceRef = useRef<{before:string;after:string;startR:number;startC:number}|null>(null)
  const rangeAnchorRef = useRef({r:0,c:0})
  const tableDragRef = useRef<{id:number;startClientX:number;startClientY:number;startX:number;startY:number;moved:boolean}|null>(null)
  const startTableDrag=(e:ReactPointerEvent<HTMLDivElement>)=>{
    if(e.button!==0)return
    e.preventDefault();e.stopPropagation()
    tableDragRef.current={id:e.pointerId,startClientX:e.clientX,startClientY:e.clientY,
      startX:table.x,startY:table.y,moved:false}
    e.currentTarget.setPointerCapture(e.pointerId)
  }
  const moveTableDrag=(e:ReactPointerEvent<HTMLDivElement>)=>{
    const d=tableDragRef.current
    if(!d||d.id!==e.pointerId)return
    e.preventDefault();e.stopPropagation()
    const dx=e.clientX-d.startClientX,dy=e.clientY-d.startClientY
    if(!d.moved&&Math.hypot(dx,dy)<4)return
    if(!d.moved){d.moved=true;onMoveStart()}
    onMove(d.startX+dx/Math.max(.01,camera.zoom),d.startY+dy/Math.max(.01,camera.zoom))
  }
  const stopTableDrag=(e:ReactPointerEvent<HTMLDivElement>)=>{
    const d=tableDragRef.current
    if(!d||d.id!==e.pointerId)return
    e.preventDefault();e.stopPropagation()
    if(e.currentTarget.hasPointerCapture(e.pointerId))e.currentTarget.releasePointerCapture(e.pointerId)
    tableDragRef.current=null
    if(d.moved)onMoveEnd()
  }
  const rows=table.cells.length
  const cols=table.cells[0]?.length??0
  const evaluate = useMemo(()=>createFormulaEvaluator(table.cells),[table.cells])
  const selectedRange=referenceRange??range
  const inside=(r:number,c:number,box:SheetRange=range)=>
    r>=Math.min(box.r0,box.r1)&&r<=Math.max(box.r0,box.r1)&&
    c>=Math.min(box.c0,box.c1)&&c<=Math.max(box.c0,box.c1)
  const selected=table.cells.flatMap((row,r)=>row.filter((_,c)=>inside(r,c)))
  const same=(key:'backgroundColor'|'textColor',fallback:string)=>
    selected.length&&selected.every(v=>(v[key]||fallback)===(selected[0][key]||fallback))
      ?(selected[0][key]||fallback):fallback
  const selectedCell=table.cells[active.r]?.[active.c]
  const activeAddress=`${labelColumn(active.c)}${active.r+1}`
  const value=selectedCell?.input??''
  const setDraftValue=(next:string)=>{
    draftRef.current=next;setDraft(next);onCellChange(active.r,active.c,next)
  }
  const beginEditing=(field:'cell'|'bar',initial=value)=>{
    if(!editing){originalRef.current=value;draftRef.current=initial;setDraft(initial);lastReferenceRef.current=null}
    setEditing(true);setEditingField(field)
    if(initial!==value)onCellChange(active.r,active.c,initial)
    if(field==='cell')requestAnimationFrame(()=>cellInputRef.current?.focus())
  }
  const finishEditing=(restore=false)=>{
    if(restore)onCellChange(active.r,active.c,originalRef.current)
    setEditing(false);setReferenceRange(null);referenceInsertRef.current=null;lastReferenceRef.current=null
    dragRef.current=null
  }
  const selectAddress=(r:number,c:number,shift=false)=>{
    if(editing)finishEditing()
    if(!shift)rangeAnchorRef.current={r,c}
    const anchor=rangeAnchorRef.current
    setRange({r0:anchor.r,c0:anchor.c,r1:r,c1:c})
    setActive({r,c});setReferenceRange(null)
    requestAnimationFrame(()=>gridRef.current?.focus())
  }
  // Mientras se edita una fórmula, el mouse marca referencias en vez de
  // cambiar la celda activa. Una selección B1:C4 se inserta como rango.
  const writeReference=(r:number,c:number)=>{
    const state=referenceInsertRef.current
    if(!state)return
    const addr=(row:number,col:number)=>`${labelColumn(col)}${row+1}`
    const start=addr(state.startR,state.startC)
    const end=addr(r,c)
    const fragment=start===end?start:`${start}:${end}`
    const next=state.before+fragment+state.after
    setDraftValue(next)
    lastReferenceRef.current=state
    setReferenceRange({r0:state.startR,c0:state.startC,r1:r,c1:c})
    requestAnimationFrame(()=>{
      const field=editingField==='bar'?formulaInputRef.current:cellInputRef.current
      if(field){field.focus();const pos=state.before.length+fragment.length;field.setSelectionRange(pos,pos)}
    })
  }
  const cellDown=(event:ReactPointerEvent<HTMLDivElement>,r:number,c:number)=>{
    event.stopPropagation()
    if(event.button!==0)return
    if(editing&&!(r===active.r&&c===active.c)){
      const field=editingField==='bar'?formulaInputRef.current:cellInputRef.current
      const beginning=field?.selectionStart??draftRef.current.length
      const ending=field?.selectionEnd??beginning
      const before=draftRef.current.slice(0,beginning)
      // Excel permite señalar celdas mientras se escribe una referencia, no
      // después de una referencia terminada. Fuera de ese contexto, un clic
      // confirma el valor y selecciona la nueva celda normalmente.
      const wantsReference=draftRef.current.trimStart().startsWith('=') &&
        /(?:[=+\-*/^(:,;]|[<>]=?)\s*$/.test(before)
      if(wantsReference){
        event.preventDefault()
        referenceInsertRef.current={before,after:draftRef.current.slice(ending),startR:r,startC:c}
        dragRef.current={kind:'reference',startR:r,startC:c}
        writeReference(r,c)
        return
      }
      finishEditing()
    }

    dragRef.current={kind:'selection',startR:event.shiftKey?rangeAnchorRef.current.r:r,startC:event.shiftKey?rangeAnchorRef.current.c:c}
    selectAddress(r,c,event.shiftKey)
  }
  const cellOver=(event:ReactPointerEvent<HTMLDivElement>,r:number,c:number)=>{
    const dragging=dragRef.current
    if(!dragging||event.buttons!==1)return
    if(dragging.kind==='reference')writeReference(r,c)
    else setRange({r0:dragging.startR,c0:dragging.startC,r1:r,c1:c})
  }
  useEffect(()=>{
    const release=()=>{dragRef.current=null;referenceInsertRef.current=null}
    window.addEventListener('pointerup',release)
    window.addEventListener('pointercancel',release)
    return ()=>{window.removeEventListener('pointerup',release);window.removeEventListener('pointercancel',release)}
  },[])
  const setRangeColor=(property:'backgroundColor'|'textColor',newValue:string)=>{
    onChange(current=>({...current,cells:current.cells.map((row,r)=>row.map((cell,c)=>
      inside(r,c)?{...cell,[property]:newValue}:cell))}))
  }
  const clearRange=()=>onChange(current=>({...current,cells:current.cells.map((row,r)=>row.map((cell,c)=>
    inside(r,c)?{...cell,input:'',display:undefined}:cell))}))
  const move=(r:number,c:number)=>selectAddress(Math.max(0,Math.min(rows-1,r)),Math.max(0,Math.min(cols-1,c)))
  const keyHandler=(event:ReactKeyboardEvent<HTMLDivElement>)=>{
    event.stopPropagation() // Los atajos de la pizarra no deben borrar tablas.
    if(event.ctrlKey||event.metaKey){
      if(event.key.toLowerCase()==='c'&&!editing){event.preventDefault();onCopyRange(range)}
      if(event.key.toLowerCase()==='a'&&!editing){event.preventDefault();setRange({r0:0,c0:0,r1:rows-1,c1:cols-1})}
      return
    }
    if(editing){
      if(event.key==='Escape'){event.preventDefault();finishEditing(true);requestAnimationFrame(()=>gridRef.current?.focus())}
      else if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();finishEditing();move(active.r+1,active.c)}
      else if(event.key==='Tab'){event.preventDefault();finishEditing();move(active.r,active.c+(event.shiftKey?-1:1))}
      return
    }
    if(event.key==='F2'){event.preventDefault();beginEditing('cell');return}
    if(event.key==='Enter'){event.preventDefault();move(active.r+1,active.c);return}
    if(event.key==='Tab'){event.preventDefault();move(active.r,active.c+(event.shiftKey?-1:1));return}
    if(event.shiftKey&&['ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(event.key)){
      event.preventDefault()
      const dr=event.key==='ArrowUp'?-1:event.key==='ArrowDown'?1:0
      const dc=event.key==='ArrowLeft'?-1:event.key==='ArrowRight'?1:0
      const r=Math.max(0,Math.min(rows-1,range.r1+dr)),c=Math.max(0,Math.min(cols-1,range.c1+dc))
      setRange({...range,r1:r,c1:c});return
    }
    if(event.key==='ArrowUp'){event.preventDefault();move(active.r-1,active.c);return}
    if(event.key==='ArrowDown'){event.preventDefault();move(active.r+1,active.c);return}
    if(event.key==='ArrowLeft'){event.preventDefault();move(active.r,active.c-1);return}
    if(event.key==='ArrowRight'){event.preventDefault();move(active.r,active.c+1);return}
    if(event.key==='Delete'||event.key==='Backspace'){event.preventDefault();clearRange();return}
    if(event.key.length===1&&!event.altKey){
      event.preventDefault();beginEditing('cell',event.key)
    }
  }
  const chrome=tableChrome(table)
  const gridWidth=chrome.rowHeader+cols*table.cellWidth
  const gridHeight=chrome.title+chrome.colHeader+rows*table.cellHeight
  // La barra de herramientas mantiene tamaño legible incluso con zoom bajo.
  const toolbarScale=Math.min(Math.max(1/Math.max(camera.zoom,.1),chrome.factor),1.3/Math.max(camera.zoom,.1))
  return <div className="sheet-inline-anchor" ref={anchorRef}
    onContextMenu={onContextMenu}
    style={{left:table.x*camera.zoom+camera.x,top:table.y*camera.zoom+camera.y,
      transform:`translate(${rotationOffset(gridWidth,gridHeight,table.rotation||0).x*camera.zoom}px,${rotationOffset(gridWidth,gridHeight,table.rotation||0).y*camera.zoom}px) rotate(${table.rotation||0}rad) scale(${camera.zoom})`,width:gridWidth,height:gridHeight,
      '--sheet-toolbar-scale': toolbarScale} as CSSProperties}
    onPointerDown={e=>e.stopPropagation()} onClick={e=>e.stopPropagation()}>
    <div className="sheet-inline-toolbar"
      // Si la tabla está junto al borde superior, el menú aparece dentro del
      // encabezado, no recortado por fuera de la pantalla.
      style={table.y*camera.zoom+camera.y<110
        ? {bottom:'auto',top:Math.max(8,12/Math.max(camera.zoom,.1))}
        : undefined}
      onPointerDown={e=>e.stopPropagation()}>
      <input className="sheet-inline-name" title="Nombre de la hoja" aria-label="Nombre de tabla" value={table.name}
        onChange={e=>onChange(t=>({...t,name:e.target.value.slice(0,100)}))}/>
      <span className="sheet-address" title="Celda activa">{activeAddress}</span>
      <span className="sheet-fx" aria-hidden="true">ƒx</span>
      <input ref={formulaInputRef} className="sheet-formula-bar" aria-label={`Fórmula o valor de ${activeAddress}`}
        title="Escribí una fórmula; seleccioná celdas con el mouse para insertar referencias"
        value={editing?draft:value}
        onFocus={()=>beginEditing('bar')}
        onChange={e=>{lastReferenceRef.current=null;setDraftValue(e.target.value)}}
        onKeyDown={e=>{
          e.stopPropagation()
          if(e.key==='Enter'){e.preventDefault();finishEditing();move(active.r+1,active.c)}
          if(e.key==='Escape'){e.preventDefault();finishEditing(true);gridRef.current?.focus()}
          if(e.key==='Tab'){e.preventDefault();finishEditing();move(active.r,active.c+(e.shiftKey?-1:1))}
        }}
      />
      <label title="Color de fondo de las celdas seleccionadas"><span>Fondo</span>
        <input type="color" aria-label="Color de fondo de celda" value={same('backgroundColor','#ffffff')}
          onChange={e=>setRangeColor('backgroundColor',e.target.value)}/></label>
      <label title="Color de las letras o números seleccionados"><span>Texto</span>
        <input type="color" aria-label="Color del texto de celda" value={same('textColor','#1f2937')}
          onChange={e=>setRangeColor('textColor',e.target.value)}/></label>
      <button type="button" title="Copiar celdas seleccionadas para Excel" onClick={()=>onCopyRange(range)}>Copiar</button>
      <button type="button" title="Exportar con fórmulas" onClick={onExport}>XLSX</button>
    </div>
    <div className="sheet-inline-viewport" style={{width:gridWidth,height:gridHeight}}>
      <div className="sheet-inline-title sheet-inline-drag-handle" style={{height:chrome.title,fontSize:Math.max(14,chrome.chromeFont*1.15)}}
        title="Arrastrá este encabezado para mover la tabla"
        onPointerDown={startTableDrag} onPointerMove={moveTableDrag}
        onPointerUp={stopTableDrag} onPointerCancel={stopTableDrag}>
        {table.name||'Tabla'}
      </div>
      <div ref={gridRef} className="sheet-inline-cells" role="grid" tabIndex={0} aria-label="Hoja de cálculo editable"
        onKeyDown={keyHandler}
        onPaste={event=>{
          const raw=event.clipboardData.getData('text/plain')
          if(raw.includes('\t')||raw.includes('\n')){
            event.preventDefault();onPasteCells(active.r,active.c,raw);finishEditing()
          }else if(!editing){event.preventDefault();onCellChange(active.r,active.c,raw)}
        }}
        style={{gridTemplateColumns:`${chrome.rowHeader}px repeat(${cols},${table.cellWidth}px)`,gridTemplateRows:`${chrome.colHeader}px repeat(${rows},${table.cellHeight}px)`, "--sheet-font-size": `${tableFontSize(table)}px`, "--sheet-chrome-font-size": `${chrome.chromeFont}px`} as CSSProperties}>
        <div className="sheet-inline-corner" />
        {Array.from({length:cols},(_,c)=><div className="sheet-inline-heading" key={'h'+c}>{labelColumn(c)}</div>)}
        {table.cells.map((row,r)=><Fragment key={r}>
          <div className="sheet-inline-heading sheet-inline-rowheading" style={{gridColumn:1,gridRow:r+2}}>{r+1}</div>
          {row.map((cell,c)=><div key={`${r}:${c}`} data-row={r} data-col={c}
            role="gridcell" aria-selected={inside(r,c)} aria-label={`Celda ${labelColumn(c)}${r+1}`}
            title={cell.display?`Último valor importado: ${cell.display}`:undefined}
            className={`sheet-display-cell ${inside(r,c)?'sheet-inline-selected':''} ${referenceRange&&inside(r,c,selectedRange)?'sheet-reference-cell':''} ${active.r===r&&active.c===c?'sheet-active-cell':''}`}
            style={{gridColumn:c+2,gridRow:r+2,backgroundColor:cell.backgroundColor||'#ffffff',color:cell.textColor||'#1f2937'}}
            onPointerDown={event=>cellDown(event,r,c)}
            onPointerEnter={event=>cellOver(event,r,c)}
            onDoubleClick={event=>{event.stopPropagation();selectAddress(r,c);beginEditing('cell',table.cells[r]?.[c]?.input??'')}}>
            {editing&&editingField==='cell'&&active.r===r&&active.c===c
              ?<input ref={cellInputRef} className="sheet-edit-input" value={draft} spellCheck={false}
                  onChange={event=>{lastReferenceRef.current=null;setDraftValue(event.target.value)}}
                  onPointerDown={event=>event.stopPropagation()}
                  onPaste={event=>{const raw=event.clipboardData.getData('text/plain');if(raw.includes('\t')||raw.includes('\n')){event.preventDefault();event.stopPropagation();onPasteCells(r,c,raw);finishEditing()}}}/>
              :<span className="sheet-display-value">{evaluate(r,c)}</span>}
          </div>)}
        </Fragment>)}
      </div>
    </div>
    <button className="sheet-inline-add-col" type="button" disabled={cols>=MAX_EXCEL_COLS}
      title="Agregar columna a la derecha" aria-label="Agregar columna" onClick={onAddColumn}>+</button>
    <button className="sheet-inline-add-row" type="button" disabled={rows>=MAX_EXCEL_ROWS}
      title="Agregar fila debajo" aria-label="Agregar fila" onClick={onAddRow}>+</button>
    {notice&&<div className="sheet-inline-notice" role="status">{notice}</div>}
  </div>
}

/** Vista pasiva de las tablas: usa la misma grilla HTML que el editor.
 * Al cambiar entre selección y no selección no cambian las medidas ni la tipografía. */


function rotateAround(point: Point, center: Point, angle: number): Point {
  const x = point.x - center.x, y = point.y - center.y
  const cos = Math.cos(angle), sin = Math.sin(angle)
  return { x: center.x + cos * x - sin * y, y: center.y + sin * x + cos * y }
}
