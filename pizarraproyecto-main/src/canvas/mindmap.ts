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
