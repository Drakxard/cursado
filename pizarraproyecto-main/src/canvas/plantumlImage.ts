import engineUrl from '@plantuml/core/plantuml.js?url'
import vizUrl from '@plantuml/core/viz-global.js?url'
import type { MindmapNode } from './mindmap'
import { rasterPlantumlLabels, type PlantumlProgress } from './plantumlLabel'

type Engine = { renderToString:(lines:string[],success:(svg:string)=>void,error:(message:string)=>void)=>void }
let engine:Promise<Engine>|undefined
let queue:Promise<unknown>=Promise.resolve()

function loadEngine() {
  return engine??=new Promise<void>((resolve,reject)=>{
    const script=document.createElement('script')
    const timer=setTimeout(()=>{script.remove();reject(new Error('PlantUML tardó demasiado en cargar.'))},30000)
    script.src=vizUrl
    script.onload=()=>{clearTimeout(timer);resolve()}
    script.onerror=()=>{clearTimeout(timer);script.remove();reject(new Error('No se pudo cargar PlantUML.'))}
    document.head.append(script)
  }).then(()=>import(/* @vite-ignore */ engineUrl) as Promise<Engine>).catch(error=>{engine=undefined;throw error})
}

/** PlantUML lays out measured labels; KaTeX and text are baked into one PNG. */
export function plantumlImage(root:MindmapNode,onProgress?:PlantumlProgress):Promise<Blob> {
  const job=queue.catch(()=>{}).then(async()=>{
    onProgress?.(15,'Cargando PlantUML…')
    const renderer=await loadEngine()
    onProgress?.(28,'Preparando el árbol…')
    await new Promise(resolve=>setTimeout(resolve,0))
    const entries:{text:string;depth:number}[]=[]
    function visit(node:MindmapNode,depth:number) {
      entries.push({text:node.text,depth})
      node.children.forEach(child=>visit(child,depth+1))
    }
    visit(root,0)
    const pixelRatio=entries.length>32?4:entries.length>12?3:2
    const labels=await rasterPlantumlLabels(entries.map(entry=>entry.text),pixelRatio,onProgress)
    let image:HTMLImageElement|undefined,url:string|undefined,canvas:HTMLCanvasElement|undefined
    try {
      let layoutScale=1,svg=''
      for(let attempt=0;attempt<4;attempt++) {
        onProgress?.(70+attempt*3,'Distribuyendo las ramas…')
        await new Promise(resolve=>setTimeout(resolve,0))
        // Only placeholder boxes reach PlantUML. Original text cannot inject directives.
        const lines=['@startmindmap','<style>','mindmapDiagram {','node {','FontName monospace','FontSize 17','Padding 12','Margin 12','RoundCorner 12','BackgroundColor #f5f5f5','LineColor #555555','}','}','</style>']
        entries.forEach((entry,index)=>{
          const label=labels[index]
          // The pinned engine measures monospace M at 9.347 px and rows at 20 px.
          const row='M'.repeat(Math.ceil(label.width*layoutScale/9.34))
          lines.push(`${'*'.repeat(entry.depth+1)} ${Array.from({length:Math.ceil(label.height*layoutScale/20)},()=>row).join('\\n')}`)
        })
        lines.push('@endmindmap')
        try {
          svg=await new Promise<string>((resolve,reject)=>{
            const timer=setTimeout(()=>reject(new Error('PlantUML tardó demasiado en distribuir el mapa.')),30000)
            try {
              renderer.renderToString(lines,value=>{clearTimeout(timer);resolve(value)},message=>{clearTimeout(timer);reject(new Error(message))})
            }catch(error){clearTimeout(timer);reject(error)}
          })
          break
        }catch(error) {
          // The browser engine rejects layouts over 4096 px before PNG scaling.
          // Retry measured boxes at a smaller scale, preserving every label.
          if(attempt===3||!/Diagram too large for browser rendering/i.test(String(error)))throw error
          layoutScale*=0.8
        }
      }
      const doc=new DOMParser().parseFromString(svg,'image/svg+xml')
      const boxes=Array.from(doc.querySelectorAll('rect[rx]'),rect=>({x:Number(rect.getAttribute('x')),y:Number(rect.getAttribute('y')),width:Number(rect.getAttribute('width')),height:Number(rect.getAttribute('height'))}))
      if(doc.querySelector('parsererror')||doc.documentElement.localName!=='svg'||boxes.length!==labels.length||boxes.some(box=>!Object.values(box).every(Number.isFinite)))
        throw new Error('PlantUML no devolvió una imagen válida.')
      doc.querySelectorAll('text').forEach(node=>node.remove())
      const width=Number(doc.documentElement.getAttribute('width')),height=Number(doc.documentElement.getAttribute('height'))
      if(!Number.isFinite(width)||!Number.isFinite(height)||width<=0||height<=0)throw new Error('El mapa no tiene dimensiones válidas.')
      onProgress?.(84,'Generando la imagen en alta resolución…')
      await new Promise(resolve=>setTimeout(resolve,0))
      url=URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(doc)],{type:'image/svg+xml'}))
      image=new Image()
      image.src=url
      await image.decode()
      const scale=Math.min(pixelRatio/layoutScale,8192/Math.max(width,height),Math.sqrt(32000000/(width*height)))
      canvas=document.createElement('canvas')
      canvas.width=Math.max(1,Math.floor(width*scale));canvas.height=Math.max(1,Math.floor(height*scale))
      const ctx=canvas.getContext('2d')
      if(!ctx)throw new Error('No se pudo preparar la imagen del mapa.')
      ctx.scale(scale,scale);ctx.fillStyle='white';ctx.fillRect(0,0,width,height);ctx.drawImage(image,0,0,width,height)
      labels.forEach((label,index)=>{
        const box=boxes[index]
        const labelWidth=label.width*layoutScale,labelHeight=label.height*layoutScale
        if(box.width<labelWidth+23||box.height<labelHeight+23)throw new Error('Una etiqueta no cabe en el mapa generado.')
        ctx.drawImage(label.canvas,box.x+(box.width-labelWidth)/2,box.y+(box.height-labelHeight)/2,labelWidth,labelHeight)
      })
      onProgress?.(95,'Exportando PNG…')
      const blob=await new Promise<Blob>((resolve,reject)=>canvas!.toBlob(blob=>blob?resolve(blob):reject(new Error('No se pudo generar el PNG del mapa.')),'image/png'))
      onProgress?.(100,'Diagrama listo')
      return blob
    }finally {
      if(url)URL.revokeObjectURL(url)
      if(image)image.src=''
      if(canvas)canvas.width=canvas.height=0
      for(const label of labels)label.canvas.width=label.canvas.height=0
    }
  })
  queue=job
  return job
}
