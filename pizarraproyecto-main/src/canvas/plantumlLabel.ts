import { getFontEmbedCSS } from 'html-to-image'
import { mathMarkup, messageParts } from '../assistant/messageFormat'
import 'katex/dist/katex.min.css'
import katexStyles from 'katex/dist/katex.min.css?inline'

export function plantumlLabelRows(text:string) {
  return messageParts(text.replace(/<latex>([\s\S]*?)<\/latex>/gi,'\\[$1\\]'))
    .filter(part=>part.text.trim())
    .map(part=>({kind:part.kind==='math'?'math' as const:'text' as const,text:part.text.trim(),raw:part.raw??part.text}))
}

export type PlantumlLabel={canvas:HTMLCanvasElement;width:number;height:number}

// html-to-image's toCanvas waits for requestAnimationFrame per label. Browsers
// throttle frames in the offscreen renderer iframe, turning large maps into
// dozens of sequential frame waits. Image.decode is sufficient for drawing.
async function labelCanvas(node:HTMLElement,width:number,height:number,ratio:number,fontCSS:string) {
  // Labels contain only our inline styles and trusted KaTeX markup. Preserve
  // those directly instead of copying hundreds of computed styles per span.
  const clone=node.cloneNode(true) as HTMLElement
  Object.assign(clone.style,{position:'relative',left:'0',top:'0',width:`${width}px`,height:`${height}px`,maxWidth:`${width}px`})
  const styles=document.createElement('style')
  styles.textContent=katexStyles.replace(/@font-face\s*\{[^}]*\}/g,'')+'\n'+fontCSS
  clone.prepend(styles)
  const svg=document.createElementNS('http://www.w3.org/2000/svg','svg')
  svg.setAttribute('width',String(width));svg.setAttribute('height',String(height))
  const content=document.createElementNS(svg.namespaceURI,'foreignObject')
  content.setAttribute('width','100%');content.setAttribute('height','100%')
  content.append(clone);svg.append(content)
  const source='data:image/svg+xml;charset=utf-8,'+encodeURIComponent(new XMLSerializer().serializeToString(svg))
  const image=new Image()
  const canvas=document.createElement('canvas')
  try {
    image.src=source
    await image.decode()
    canvas.width=Math.ceil(width*ratio);canvas.height=Math.ceil(height*ratio)
    const context=canvas.getContext('2d')
    if(!context)throw new Error('No se pudo preparar una etiqueta del mapa.')
    context.drawImage(image,0,0,canvas.width,canvas.height)
    return canvas
  }catch(error){canvas.width=canvas.height=0;throw error}
  finally {image.src=''}
}

/** Temporary labels belong only to image generation, never to the board's objects. */
export async function rasterPlantumlLabels(texts:string[]):Promise<PlantumlLabel[]> {
  const labels:PlantumlLabel[]=[]
  const nodes:HTMLDivElement[]=[]
  const atlas=document.createElement('div')
  Object.assign(atlas.style,{position:'fixed',left:'-100000px',top:'0',margin:'0',padding:'0'})
  let sheet:HTMLCanvasElement|undefined
  try {
    for(const text of texts) {
      const node=document.createElement('div')
      node.dataset.plantumlLabel='true'
      Object.assign(node.style,{position:'fixed',left:'-100000px',top:'0',width:'max-content',maxWidth:'520px',
        font:'17px Arial,sans-serif',lineHeight:'1.35',color:'#202020',whiteSpace:'pre-wrap',overflowWrap:'anywhere'})
      for(const part of plantumlLabelRows(text)) {
        const row=document.createElement('div')
        row.dataset.plantumlRow=part.kind
        const markup=part.kind==='math'?mathMarkup(part.text,true):null
        if(markup) {
          row.innerHTML=markup
          const display=row.querySelector<HTMLElement>('.katex-display')!
          Object.assign(display.style,{margin:'6px 0',textAlign:'center'})
        }else row.textContent=part.kind==='math'?part.raw:part.text
        node.append(row)
      }
      document.body.append(node)
      nodes.push(node)
    }
    if(!nodes.length)return labels
    // Mount every formula before waiting, so fonts load together rather than
    // starting a separate font/layout cycle for each node.
    document.body.getBoundingClientRect()
    await document.fonts.ready
    const sizes=nodes.map(node=>{
      const formulaWidth=Math.max(0,...Array.from(node.querySelectorAll<HTMLElement>('.katex-html'),item=>item.getBoundingClientRect().width))
      node.style.maxWidth=`${Math.min(4096,Math.max(520,Math.ceil(formulaWidth)))}px`
      const bounds=node.getBoundingClientRect(),width=Math.max(1,Math.ceil(Math.max(bounds.width,node.scrollWidth))),height=Math.max(1,Math.ceil(bounds.height))
      if(width>4096||height>4096)throw new Error('Una etiqueta del mapa es demasiado grande para generar la imagen.')
      return {width,height,x:0,y:0}
    })
    // Pack labels into one sheet. Rasterizing once embeds/decodes the fonts
    // once, then each label is a cheap canvas crop with its original dimensions.
    const columnHeight=Math.max(2048,...sizes.map(size=>size.height+2))
    let x=0,y=0,columnWidth=0,width=0,height=0,pixels=0
    sizes.forEach((size,index)=>{
      if(y+size.height+2>columnHeight&&y>0){x+=columnWidth;y=0;columnWidth=0}
      size.x=x;size.y=y
      y+=size.height+2;columnWidth=Math.max(columnWidth,size.width+2)
      width=Math.max(width,x+size.width);height=Math.max(height,y-2)
      const ratio=Math.min(2,4096/Math.max(size.width,size.height))
      pixels+=Math.ceil(size.width*ratio)*Math.ceil(size.height*ratio)
      const node=nodes[index]
      Object.assign(node.style,{position:'absolute',left:`${size.x}px`,top:`${size.y}px`,width:`${size.width}px`,maxWidth:`${size.width}px`})
      atlas.append(node)
    })
    if(pixels>16000000||width>8192||height>8192)throw new Error('El mapa supera el tamaño admitido para generar la imagen.')
    Object.assign(atlas.style,{width:`${width}px`,height:`${height}px`})
    document.body.append(atlas)
    const fontCSS=atlas.querySelector('.katex')?await getFontEmbedCSS(atlas,{preferredFontFormat:'woff2'}):''
    const ratio=Math.min(2,8192/Math.max(width,height),Math.sqrt(16000000/(width*height)))
    sheet=await labelCanvas(atlas,width,height,ratio,fontCSS)
    const scaleX=sheet.width/width,scaleY=sheet.height/height
    for(const size of sizes) {
      const canvas=document.createElement('canvas')
      canvas.width=Math.max(1,Math.ceil(size.width*scaleX));canvas.height=Math.max(1,Math.ceil(size.height*scaleY))
      labels.push({canvas,width:size.width,height:size.height})
      const context=canvas.getContext('2d')
      if(!context)throw new Error('No se pudo preparar una etiqueta del mapa.')
      context.drawImage(sheet,size.x*scaleX,size.y*scaleY,size.width*scaleX,size.height*scaleY,0,0,canvas.width,canvas.height)
    }
    return labels
  }catch(error){
    for(const label of labels)label.canvas.width=label.canvas.height=0
    throw error
  }finally {
    atlas.remove()
    for(const node of nodes)node.remove()
    if(sheet)sheet.width=sheet.height=0
  }
}
