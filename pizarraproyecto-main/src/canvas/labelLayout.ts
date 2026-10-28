import type { ShapeItem } from './visualObjects'

export function labelFont(item:ShapeItem) {
  return `${item.labelItalic?'italic ':''}${item.labelBold?'700 ':''}${item.labelFontSize??16}px ${item.labelFontFamily||'system-ui,sans-serif'}`
}
export function labelLines(ctx:CanvasRenderingContext2D,text:string,width:number):string[] {
  const lines:string[]=[]
  for(const paragraph of text.split('\n')) {
    let line=''
    for(const token of paragraph.match(/\S+\s*|\s+/g)??['']) {
      if(line&&ctx.measureText(line+token.trimEnd()).width>width){lines.push(line.trimEnd());line=''}
      for(const char of token) {
        if(line&&ctx.measureText(line+char).width>width){lines.push(line);line=''}
        line+=char
      }
    }
    lines.push(line.trimEnd())
  }
  return lines
}
