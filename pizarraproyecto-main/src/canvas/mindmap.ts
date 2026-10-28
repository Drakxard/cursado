import type { Point } from '../storage/database'
import { defaultConnector, pointsBounds } from './visualObjects'
import type { ShapeItem } from './visualObjects'

// A URL anywhere in the clipboard preserves the previous paste pipeline.
export const containsUrl = (text:string) => /\b(?:[a-z][a-z\d+.-]*:\/\/|mailto:|www\.)\S+/i.test(text)
export const isMindmap = (text:string) => !containsUrl(text) && /@startmindmap\b/i.test(text)
export type MindmapNode = { text:string; children:MindmapNode[] }

export function parseMindmap(source:string):MindmapNode {
  if(source.length>100000)throw new Error('El árbol admite hasta 100000 caracteres.')
  const text=source.trim().replace(/^```(?:plantuml|puml)?\s*\n([\s\S]*?)\n```$/i,'$1').trim()
  const lines=text.split(/\r?\n/)
  if(lines.shift()?.trim()!=='@startmindmap'||lines.pop()?.trim()!=='@endmindmap')
    throw new Error('El árbol debe comenzar con @startmindmap y terminar con @endmindmap.')
  const stack:MindmapNode[]=[]
  let root:MindmapNode|undefined,count=0
  for(const line of lines) {
    if(!line.trim())continue
    const match=/^\s*(\*+) (.+)$/.exec(line)
    if(!match)throw new Error('Solo se admite la jerarquía por asteriscos: * raíz, ** hijo, *** nieto.')
    const depth=match[1].length,label=match[2].trim()
    if(!label||label.length>2000||++count>127||depth>24)throw new Error('El árbol admite 127 nodos, 24 niveles y 2000 caracteres por nodo.')
    if(depth>stack.length+1)throw new Error('Falta un nivel intermedio del árbol.')
    const node:MindmapNode={text:label,children:[]}
    if(depth===1) {
      if(root)throw new Error('El árbol debe tener una sola raíz.')
      root=node
    }else stack[depth-2].children.push(node)
    stack.length=depth-1;stack.push(node)
  }
  if(!root)throw new Error('El árbol no contiene nodos.')
  return root
}

/** Measure once, then lay out subtrees in linear time, using native board objects. */
export function mindmapShapes(root:MindmapNode,center:Point,id:()=>string,measure:(text:string)=>{width:number;height:number},color='#334155'):ShapeItem[] {
  type Layout={node:MindmapNode;width:number;height:number;span:number;children:Layout[]}
  const columns:number[]=[],nodes:ShapeItem[]=[],edges:ShapeItem[]=[],groupId=id()
  function size(node:MindmapNode,depth:number):Layout {
    const measured=measure(node.text),width=Math.max(140,Math.min(360,measured.width+24)),height=Math.max(52,measured.height+24)
    columns[depth]=Math.max(columns[depth]??0,width)
    const children=node.children.map(child=>size(child,depth+1))
    return {node,width,height,children,span:Math.max(height,children.reduce((sum,child)=>sum+child.span,0)+Math.max(0,children.length-1)*24)}
  }
  const layout=size(root,0),xs=[0]
  for(let i=1;i<columns.length;i++)xs[i]=xs[i-1]+columns[i-1]+72
  function place(branch:Layout,depth:number,top:number,parent?:ShapeItem) {
    const item:ShapeItem={id:id(),groupId,kind:'rounded',label:branch.node.text,labelFontSize:17,labelAlign:'left',
      x:xs[depth],y:top+(branch.span-branch.height)/2,width:branch.width,height:branch.height,color,strokeWidth:2}
    nodes.push(item)
    if(parent) {
      const start={x:parent.x+parent.width,y:parent.y+parent.height/2},end={x:item.x,y:item.y+item.height/2}
      edges.push({id:id(),groupId,kind:'arrow',visualType:'connector',color,strokeWidth:2,...pointsBounds([start,end]),
        connector:{...defaultConnector(),start,end,route:'elbow',from:{object:{kind:'shape',id:parent.id},u:1,v:.5},to:{object:{kind:'shape',id:item.id},u:0,v:.5}}})
    }
    let y=top+(branch.span-branch.children.reduce((sum,child)=>sum+child.span,0)-Math.max(0,branch.children.length-1)*24)/2
    for(const child of branch.children){place(child,depth+1,y,item);y+=child.span+24}
  }
  place(layout,0,0)
  const dx=center.x-(xs.at(-1)!+columns.at(-1)!)/2,dy=center.y-layout.span/2
  return [...edges,...nodes].map(item=>({...item,x:item.x+dx,y:item.y+dy,connector:item.connector?{...item.connector,
    start:{x:item.connector.start.x+dx,y:item.connector.start.y+dy},end:{x:item.connector.end.x+dx,y:item.connector.end.y+dy}}:undefined}))
}
