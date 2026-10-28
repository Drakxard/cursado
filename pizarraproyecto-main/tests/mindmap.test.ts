import { expect, it } from 'vitest'
import { containsUrl, isMindmap, parseMindmap } from '../src/canvas/mindmap'
import { mindmapExample } from './fixtures/mindmap.mjs'
import { plantumlLabelRows } from '../src/canvas/plantumlLabel'

it.each([
  {name:'complete implication tree',source:mindmapExample,nodes:13},
  {name:'fenced source',source:'```plantuml\n'+mindmapExample+'\n```',nodes:13},
  {name:'URL inside a mindmap',source:'@startmindmap\n* A https://example.com\n@endmindmap',nodes:1},
  {name:'formula source is preserved for image generation',source:String.raw`@startmindmap
* $X'=A(t)X+F(t)$
** <latex>\frac{1}{2}</latex>
@endmindmap`,nodes:2},
  ...['@startmindmap\n* A','@startmindmap\n* A\n*** B\n@endmindmap','@startmindmap\n* A\n* B\n@endmindmap',
    '@startmindmap\nleft side\n* A\n@endmindmap','@startmindmap\n@endmindmap'].map(source=>({name:source,source,nodes:0})),
  ...['https://example.com',String.raw`Texto $x$ https://example.com`].map(source=>({name:'URL: '+source,source,nodes:-1})),
])('$name',({source,nodes})=>{
  if(nodes<0){expect(containsUrl(source)).toBe(true);expect(isMindmap(source)).toBe(false);return}
  expect(isMindmap(source)).toBe(true)
  if(!nodes){expect(()=>parseMindmap(source)).toThrow();return}
  const tree=parseMindmap(source)
  const labels:string[]=[]
  function visit(node:typeof tree){labels.push(node.text);node.children.forEach(visit)}
  visit(tree)
  expect(labels).toHaveLength(nodes)
  expect(labels).toEqual(source.split('\n').filter(line=>/^\*+ /.test(line)).map(line=>line.replace(/^\*+ /,'')))
})

it.each([
  '  @STARTMINDMAP  \r\n\t*\tRaíz\r\n\t**\u00a0Hijo\r\n  @ENDMINDMAP  ',
  'Antes\n```PlantUML\n@startmindmap\n* Raíz\n** Hijo\n@endmindmap\n```\nDespués https://example.com',
  '\uFEFF@start\u200Bmindmap\r* Raíz\r** Hijo\r@endmindmap\u2060',
  '@startmindmap\u2028* Raíz\u2029** Hijo\u2028@endmindmap',
])('recognizes clipboard formatting on the first attempt: %s',source=>{
  expect(isMindmap(source)).toBe(true)
  expect(parseMindmap(source)).toEqual({text:'Raíz',children:[{text:'Hijo',children:[]}]})
})

it('separates text and every math expression into distinct image rows',()=>{
  const rows=plantumlLabelRows(String.raw`Sistema $X'=AX$ con solución \(X=Ke^{\lambda t}\).`)
  expect(rows.map(({kind,text})=>({kind,text}))).toEqual([
    {kind:'text',text:'Sistema'},{kind:'math',text:"X'=AX"},{kind:'text',text:'con solución'},
    {kind:'math',text:String.raw`X=Ke^{\lambda t}`},{kind:'text',text:'.'},
  ])
})

it('accepts display and PlantUML latex delimiters, preserving invalid formula source',()=>{
  const rows=plantumlLabelRows(String.raw`$$\frac{1}{2}$$ <latex>\lambda=\alpha+i\beta</latex> \[x^2\] $\invalid{a}$`)
  expect(rows.map(row=>row.kind)).toEqual(['math','math','math','math'])
  expect(rows.map(row=>row.text)).toEqual([String.raw`\frac{1}{2}`,String.raw`\lambda=\alpha+i\beta`,'x^2',String.raw`\invalid{a}`])
  expect(rows.at(-1)?.raw).toBe(String.raw`$\invalid{a}$`)
})
