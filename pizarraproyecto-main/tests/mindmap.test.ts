import { expect, it } from 'vitest'
import { containsUrl, isMindmap, mindmapShapes, parseMindmap } from '../src/canvas/mindmap'
import { mindmapExample } from './fixtures/mindmap.mjs'

it.each([
  {name:'complete implication tree',source:mindmapExample,nodes:13},
  {name:'fenced source',source:'```plantuml\n'+mindmapExample+'\n```',nodes:13},
  {name:'formulas remain editable',source:String.raw`@startmindmap
* $X'=A(t)X+F(t)$
** <latex>\frac{1}{2}</latex>
@endmindmap`,nodes:2},
  ...['@startmindmap\n* A','@startmindmap\n* A\n*** B\n@endmindmap','@startmindmap\n* A\n* B\n@endmindmap',
    '@startmindmap\nleft side\n* A\n@endmindmap','@startmindmap\n@endmindmap'].map(source=>({name:source,source,nodes:0})),
  ...['https://example.com',String.raw`Texto $x$ https://example.com`,
    '@startmindmap\n* A https://example.com\n@endmindmap'].map(source=>({name:'URL: '+source,source,nodes:-1})),
])('$name',({source,nodes})=>{
  if(nodes<0){expect(containsUrl(source)).toBe(true);expect(isMindmap(source)).toBe(false);return}
  expect(isMindmap(source)).toBe(true)
  if(!nodes){expect(()=>parseMindmap(source)).toThrow();return}
  const tree=parseMindmap(source)
  let index=0
  const shapes=mindmapShapes(tree,{x:500,y:400},()=>`node-${++index}`,text=>({width:Math.min(336,text.length*9),height:Math.ceil(text.length*9/336)*22}))
  const labels=shapes.filter(item=>!item.connector),edges=shapes.filter(item=>item.connector)
  expect(labels).toHaveLength(nodes);expect(edges).toHaveLength(nodes-1)
  expect(labels.map(item=>item.label)).toEqual(source.split('\n').filter(line=>/^\*+ /.test(line)).map(line=>line.replace(/^\*+ /,'')))
  for(const edge of edges){
    const parent=labels.find(item=>item.id===edge.connector!.from!.object.id)!,child=labels.find(item=>item.id===edge.connector!.to!.object.id)!
    expect(child.x).toBeGreaterThan(parent.x+parent.width)
  }
  for(const a of labels)for(const b of labels.filter(b=>a.id!==b.id&&a.x===b.x))
    expect(a.y+a.height<=b.y||b.y+b.height<=a.y).toBe(true)
})
