import type { ShapeItem } from './visualObjects'
import type { TextItem } from '../storage/database'

/** A conservative editable subset. Complex paths keep their appearance via SVG import. */
export function editableClipboardSvg(source: string): { shapes: ShapeItem[]; texts: TextItem[]; width: number; height: number } | null {
  const dom = new DOMParser().parseFromString(source, 'image/svg+xml'), svg = dom.documentElement
  if (svg.localName !== 'svg' || dom.querySelector('parsererror,script,foreignObject,image,use,filter,clipPath,mask,linearGradient,radialGradient,style')) return null
  const view = (svg.getAttribute('viewBox') || '').trim().split(/[\s,]+/).map(Number)
  const number = (node: Element, key: string, fallback = 0) => {
    const raw = node.getAttribute(key)
    if (raw === null) return fallback
    if (!/^-?[\d.]+(?:px)?$/.test(raw.trim())) throw new Error('Non-numeric SVG length')
    const value = parseFloat(raw); if (!Number.isFinite(value)) throw new Error('Invalid SVG length'); return value
  }
  const shapes: ShapeItem[] = [], texts: TextItem[] = []
  try {
    const visit = (node: Element, inherited: Record<string,string>) => {
      if (['title','desc','metadata','defs'].includes(node.localName)) return
      if (node.hasAttribute('transform')) throw new Error('Complex SVG transform')
      const style = { ...inherited }
      for (const property of ['fill','stroke','stroke-width','font-size','opacity','fill-opacity']) if (node.hasAttribute(property)) style[property] = node.getAttribute(property)!
      if (node.hasAttribute('style')) throw new Error('Embedded CSS')
      if (node.localName === 'g' || node.localName === 'svg') { for (const child of node.children) visit(child, style); return }
      const id = crypto.randomUUID(), x = number(node,'x'), y = number(node,'y'), fontSize = Number(style['font-size']) || 16
      if (node.localName === 'text') {
        if (node.children.length) throw new Error('Complex SVG text')
        texts.push({id,x,y:y-fontSize,text:node.textContent || '',fontSize,color:style.fill || '#000000'}); return
      }
      let geometry: Pick<ShapeItem,'kind'|'x'|'y'|'width'|'height'>
      if (node.localName === 'rect') geometry = { kind:number(node,'rx')?'rounded':'rectangle',x,y,width:number(node,'width'),height:number(node,'height') }
      else if (node.localName === 'ellipse' || node.localName === 'circle') {
        const rx=number(node,node.localName==='circle'?'r':'rx'),ry=number(node,node.localName==='circle'?'r':'ry')
        geometry={kind:'ellipse',x:number(node,'cx')-rx,y:number(node,'cy')-ry,width:rx*2,height:ry*2}
      } else throw new Error('Complex SVG geometry')
      if (geometry.width<=0 || geometry.height<=0) return
      const fill=style.fill==='none'?undefined:style.fill||'#000000'
      if ([fill,style.stroke].some(value=>value && !/^(?:#[a-f\d]{3,8}|[a-z]+|rgba?\([\d\s.,%]+\))$/i.test(value))) throw new Error('Complex SVG paint')
      const opacity=(value:string|undefined)=>value===undefined?1:Math.max(0,Math.min(1,Number(value)))
      shapes.push({id,...geometry,color:style.stroke||'#000000',strokeWidth:!style.stroke||style.stroke==='none'?0:Number(style['stroke-width'])||1,fill,fillOpacity:opacity(style.opacity)*opacity(style['fill-opacity'])})
    }
    visit(svg,{})
    if (!shapes.length && !texts.length) return null
    const width=view.length===4?view[2]:number(svg,'width',100),height=view.length===4?view[3]:number(svg,'height',100)
    if(view.length===4){for(const item of [...shapes,...texts]){item.x-=view[0];item.y-=view[1]}}
    return {shapes,texts,width,height}
  } catch { return null }
}
