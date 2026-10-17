import { Fragment, type CSSProperties } from 'react'
import type { Bounds } from '../canvas/visualObjects'
import { createFormulaEvaluator } from '../formulas_excel'
export type SheetCell = { input: string; display?: string; backgroundColor?: string; textColor?: string }
export type SheetItem = { id: string; name: string; x: number; y: number; cellWidth: number; cellHeight: number; cells: SheetCell[][]; rotation?: number }
export const labelColumn = (index: number): string => {
  let name = ''
  for (let value = index + 1; value; value = Math.floor((value - 1) / 26)) name = String.fromCharCode(65 + (value - 1) % 26) + name
  return name
}
export const TABLE_ROW_HEADER = 38
export const TABLE_TITLE_HEIGHT = 32
export const TABLE_COL_HEADER = 27
export function tableChrome(table: SheetItem) {
  // Los encabezados antes eran constantes, incluso cuando la tabla crecía mucho.
  // Usar un mismo factor evita que las columnas y la barra se vean diminutas.
  const widthRatio = Math.max(.25, table.cellWidth / 114)
  const heightRatio = Math.max(.25, table.cellHeight / 33)
  const factor = Math.max(1, Math.min(6, Math.sqrt(widthRatio * heightRatio)))
  return {
    factor,
    rowHeader: Math.round(TABLE_ROW_HEADER * factor),
    title: Math.round(TABLE_TITLE_HEIGHT * factor),
    colHeader: Math.round(TABLE_COL_HEADER * factor),
    chromeFont: Math.round(12 * factor),
  }
}
export function tableFontSize(table: SheetItem): number {
  return Math.max(12, Math.min(90, 13 * tableChrome(table).factor))
}
export function tableSize(table: SheetItem): Bounds {
  const cols = Math.max(1, ...table.cells.map(row => row.length))
  const chrome = tableChrome(table)
  return { x: table.x, y: table.y, width: chrome.rowHeader + cols * table.cellWidth,
    height: chrome.title + chrome.colHeader + table.cells.length * table.cellHeight }
}
// Solo se aceptan enlaces reales de YouTube. El id del video se valida antes de
export default function StaticTable({table}:{table:SheetItem}) {
  const rows=table.cells.length
  const cols=Math.max(1,...table.cells.map(row=>row.length))
  const size=tableSize(table)
  const chrome=tableChrome(table)
  const evaluate=createFormulaEvaluator(table.cells)
  return <div className="sheet-static-table" data-table-id={table.id} style={{left:table.x,top:table.y,width:size.width,height:size.height,zIndex:((table as {zIndex?:number}).zIndex??100000)*2,transform:`rotate(${table.rotation||0}rad)`,transformOrigin:'center center'}}>
    <div className="sheet-inline-title" style={{height:chrome.title,fontSize:Math.max(14,chrome.chromeFont*1.15)}}>{table.name||'Tabla'}</div>
    <div className="sheet-inline-cells" style={{
      gridTemplateColumns:`${chrome.rowHeader}px repeat(${cols},${table.cellWidth}px)`,
      gridTemplateRows:`${chrome.colHeader}px repeat(${rows},${table.cellHeight}px)`,
      "--sheet-font-size": `${tableFontSize(table)}px`,
      "--sheet-chrome-font-size": `${chrome.chromeFont}px`
    } as CSSProperties}>
      <div className="sheet-inline-corner" />
      {Array.from({length:cols},(_,c)=><div className="sheet-inline-heading" key={`head-${c}`}>{labelColumn(c)}</div>)}
      {table.cells.map((row,r)=><Fragment key={r}>
        <div className="sheet-inline-heading sheet-inline-rowheading" style={{gridColumn:1,gridRow:r+2}}>{r+1}</div>
        {Array.from({length:cols},(_,c)=>{
          const cell=row[c]
          return <div key={`${r}:${c}`} className="sheet-display-cell" style={{
            gridColumn:c+2,gridRow:r+2,
            backgroundColor:cell?.backgroundColor||'#fff',color:cell?.textColor||'#1f2937'
          }}><span className="sheet-display-value">{evaluate(r,c)}</span></div>
        })}
      </Fragment>)}
    </div>
  </div>
}
