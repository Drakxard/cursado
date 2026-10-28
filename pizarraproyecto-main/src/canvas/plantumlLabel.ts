import { getFontEmbedCSS, toCanvas } from 'html-to-image'
import { mathMarkup, messageParts } from '../assistant/messageFormat'
import 'katex/dist/katex.min.css'

export function plantumlLabelRows(text:string) {
  return messageParts(text.replace(/<latex>([\s\S]*?)<\/latex>/gi,'\\[$1\\]'))
    .filter(part=>part.text.trim())
    .map(part=>({kind:part.kind==='math'?'math' as const:'text' as const,text:part.text.trim(),raw:part.raw??part.text}))
}

export type PlantumlLabel={canvas:HTMLCanvasElement;width:number;height:number}

/** Temporary labels belong only to image generation, never to the board's objects. */
export async function rasterPlantumlLabels(texts:string[]):Promise<PlantumlLabel[]> {
  const labels:PlantumlLabel[]=[]
  let pixels=0
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
      try {
        // Trigger loading before waiting: KaTeX fonts are lazy browser resources.
        node.getBoundingClientRect()
        await document.fonts.ready
        const formulaWidth=Math.max(0,...Array.from(node.querySelectorAll<HTMLElement>('.katex-html'),item=>item.getBoundingClientRect().width))
        node.style.maxWidth=`${Math.min(4096,Math.max(520,Math.ceil(formulaWidth)))}px`
        const bounds=node.getBoundingClientRect(),width=Math.max(1,Math.ceil(Math.max(bounds.width,node.scrollWidth))),height=Math.max(1,Math.ceil(bounds.height))
        if(width>4096||height>4096)throw new Error('Una etiqueta del mapa es demasiado grande para generar la imagen.')
        const math=!!node.querySelector('.katex')
        const fontCSS=math?await getFontEmbedCSS(node):''
        const ratio=Math.min(2,4096/Math.max(width,height))
        pixels+=Math.ceil(width*ratio)*Math.ceil(height*ratio)
        if(pixels>16000000)throw new Error('El mapa supera el tamaño admitido para generar la imagen.')
        const canvas=await toCanvas(node,{width,height,pixelRatio:ratio,fontEmbedCSS:fontCSS,
          style:{position:'static',left:'auto',top:'auto',width:`${width}px`,maxWidth:`${width}px`}})
        labels.push({canvas,width,height})
      }finally {node.remove()}
    }
    return labels
  }catch(error){
    for(const label of labels)label.canvas.width=label.canvas.height=0
    throw error
  }
}
