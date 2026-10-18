export const GRAPH_STYLES = `
*{box-sizing:border-box}body{margin:0;background:#0f172a;color:#f8fafc;font:16px/1.5 system-ui,sans-serif}main{max-width:1200px;margin:auto;padding:20px}header,nav{background:#101b30;border:1px solid #334155;border-radius:16px;padding:14px;display:flex;align-items:center;gap:14px;justify-content:space-between}h1{font-size:20px;margin:0;overflow-wrap:anywhere}.tag{color:#6ee7b7;font-size:13px}#stage{position:relative;margin:16px 0;border:1px solid #334155;border-radius:24px;background-color:#111c31;background-image:radial-gradient(#334155 1px,transparent 1px);background-size:28px 28px;overflow:auto}#scene{display:block;width:100%;min-width:700px;height:auto}.node text{fill:#f8fafc;text-anchor:middle;font:bold 20px ui-monospace,monospace}.shape{fill:#1e293b;stroke:var(--tone,#cbd5e1);stroke-width:3}.subtree{fill:#10b98118;stroke:var(--tone,#34d399);stroke-width:2;stroke-dasharray:8 6}.node[data-state=alerta]{--tone:#f87171}.node[data-state=exito]{--tone:#34d399}.node[data-state=destacado]{--tone:#fbbf24}.node[data-state=atenuado]{opacity:.3}.ring{fill:none;stroke:var(--tone);stroke-width:2;opacity:.6}.node[data-state=normal] .ring,.node[data-state=atenuado] .ring{display:none}.edge{fill:none;stroke:#94a3b8;stroke-width:3}.edge[data-style=animado_verde]{stroke:#34d399;stroke-dasharray:8 6;animation:flow 1.2s linear infinite}.edge[data-style=animado_amarillo]{stroke:#fbbf24;stroke-dasharray:8 6;animation:flow 1.2s linear infinite}@keyframes flow{to{stroke-dashoffset:-28}}.callout{position:absolute;max-width:260px;padding:10px 14px;border:1px solid var(--tone);border-radius:12px;background:#101b30f5;color:#e2e8f0;box-shadow:0 8px 24px #0005;font-size:14px;overflow-wrap:anywhere;pointer-events:none}.callout[data-color=rojo]{--tone:#f87171}.callout[data-color=verde]{--tone:#34d399}.callout[data-color=amarillo]{--tone:#fbbf24}.callout[data-color=azul]{--tone:#38bdf8}#notes{display:grid;gap:10px;margin-bottom:16px}#notes .callout{position:static;max-width:none;pointer-events:auto}#notes:empty{display:none}button{font:inherit;color:#f8fafc;background:#26354e;border:1px solid #475569;border-radius:10px;padding:9px 14px;cursor:pointer}button:disabled{opacity:.35;cursor:default}button:focus-visible{outline:3px solid #fbbf24;outline-offset:3px}#next{background:#047857}#dots{display:flex;flex-wrap:wrap;justify-content:center;gap:6px}#dots button{padding:0;width:12px;height:12px;border-radius:99px}#dots button[aria-current=step]{background:#34d399;width:26px}.controls{display:flex;gap:8px}#counter{white-space:nowrap;color:#94a3b8;font-size:14px}@media(max-width:700px){main{padding:10px}header,nav{flex-wrap:wrap}h1{font-size:18px}#stage{border-radius:14px}#counter{white-space:normal}.callout{font-size:15px}}@media(prefers-reduced-motion:reduce){*{animation:none!important;transition:none!important}}
`

export const GRAPH_RUNTIME = String.raw`
(() => {
  const data=JSON.parse(document.getElementById('graph-data').textContent);
  const stage=document.getElementById('stage'),svg=document.getElementById('scene'),edgeLayer=document.getElementById('edges'),nodeLayer=document.getElementById('nodes'),notes=document.getElementById('notes');
  const reduced=matchMedia('(prefers-reduced-motion: reduce)');
  const make=(tag,attrs,text)=>{const n=document.createElementNS('http://www.w3.org/2000/svg',tag);for(const [key,value] of Object.entries(attrs||{}))n.setAttribute(key,String(value));if(text!==undefined)n.textContent=text;return n;};
  const nodes=new Map(),edges=new Map(),current=new Map();let index=0,frame=0,comments=[],mounted=false;
  document.getElementById('title').textContent=data.titulo;
  for(const element of data.elementos_iniciales){
    const group=make('g',{class:'node','data-node-id':element.id});
    if(element.tipo==='subarbol')group.append(make('polygon',{class:'subtree',points:'0,25 -42,92 42,92'}));
    group.append(make('circle',{class:'ring',r:36}),make('circle',{class:'shape',r:28}),make('title',{},element.etiqueta));
    const label=make('text',{y:7},element.etiqueta.length>10?element.etiqueta.slice(0,9)+'…':element.etiqueta);group.append(label);
    nodeLayer.append(group);nodes.set(element.id,group);
  }
  for(const slide of data.diapositivas)for(const edge of slide.aristas){const key=edge.desde+':'+edge.hacia;if(!edges.has(key)){const path=make('path',{class:'edge','data-edge-id':key});edgeLayer.append(path);edges.set(key,{path,from:edge.desde,to:edge.hacia});}}
  function draw(){
    for(const [id,p]of current)nodes.get(id).setAttribute('transform','translate('+p.x+' '+p.y+')');
    for(const {path,from,to}of edges.values()){
      const a=current.get(from),b=current.get(to);if(!a||!b)continue;
      const dx=b.x-a.x,dy=b.y-a.y,len=Math.hypot(dx,dy)||1;
      path.setAttribute('d',from===to?'M '+(a.x-20)+' '+(a.y-20)+' C '+(a.x-85)+' '+(a.y-100)+' '+(a.x+85)+' '+(a.y-100)+' '+(a.x+20)+' '+(a.y-20):'M '+(a.x+dx/len*30)+' '+(a.y+dy/len*30)+' L '+(b.x-dx/len*30)+' '+(b.y-dy/len*30));
    }
    placeComments();
  }
  function placeComments(){
    // Use a separate readable list when the scene needs horizontal scrolling,
    // or when callouts cannot fit without covering nodes or one another.
    const scale=svg.getBoundingClientRect().width/1000,boxes=[];
    for(const {item,node}of comments){
      const p=current.get(item.anclado_a);stage.append(node);node.style.visibility='hidden';
      const w=node.offsetWidth,h=node.offsetHeight;
      let desiredX=(p.x+item.offset_x)*scale,desiredY=(p.y+item.offset_y)*scale;
      if(item.posicion){
        const side=item.posicion,subtree=data.elementos_iniciales.find(el=>el.id===item.anclado_a).tipo==='subarbol';
        desiredX=side.includes('derecha')?(p.x+54)*scale:side.includes('izquierda')?(p.x-54)*scale-w:p.x*scale-w/2;
        desiredY=side.includes('arriba')?(p.y-48)*scale-h:side.includes('abajo')?(p.y+(subtree?106:48))*scale:p.y*scale-h/2;
      }
      const x=Math.max(8,Math.min(stage.clientWidth-w-8,desiredX));
      const y=Math.max(8,Math.min(stage.clientHeight-h-8,desiredY));
      const box={x,y,w,h};
      const intersects=(a,b)=>a.x<b.x+b.w+6&&a.x+a.w+6>b.x&&a.y<b.y+b.h+6&&a.y+a.h+6>b.y;
      const onNode=data.elementos_iniciales.some(el=>{const n=current.get(el.id),subtree=el.tipo==='subarbol';return intersects(box,{x:(n.x-44)*scale,y:(n.y-38)*scale,w:88*scale,h:(subtree?132:76)*scale});});
      if(stage.clientWidth<700||onNode||w>stage.clientWidth-16||h>stage.clientHeight-16||boxes.some(b=>intersects(box,b))){notes.append(node);node.style.left='';node.style.top='';}
      else{node.style.left=x+'px';node.style.top=y+'px';boxes.push(box);}
      node.style.visibility='';
    }
  }
  const dots=data.diapositivas.map((slide,i)=>{const b=document.createElement('button');b.type='button';b.setAttribute('aria-label','Ir al paso '+slide.paso);b.onclick=()=>go(i);document.getElementById('dots').append(b);return b;});
  function go(target,replay=false){
    cancelAnimationFrame(frame);const previousIndex=index;index=target;
    const slide=data.diapositivas[index];
    const start=replay&&index>0?data.diapositivas[index-1].posiciones:Object.fromEntries(current);
    for(const [id,node]of nodes)node.dataset.state=slide.posiciones[id].estado;
    // SVG elements use display, since the HTML hidden attribute is not universal in SVG.
    for(const edge of edges.values())edge.path.style.display='none';
    for(const edge of slide.aristas){const path=edges.get(edge.desde+':'+edge.hacia).path;path.style.display='';path.dataset.style=edge.estilo;}
    for(const c of comments)c.node.remove();comments=slide.comentarios.map(item=>{const node=document.createElement('div');node.className='callout';node.dataset.color=item.color;node.textContent=item.anclado_a+': '+item.texto;return {item,node};});
    document.getElementById('counter').textContent='Paso '+slide.paso+' de '+data.diapositivas.length;
    document.getElementById('prev').disabled=index===0;document.getElementById('next').disabled=index===data.diapositivas.length-1;
    dots.forEach((dot,i)=>{if(i===index)dot.setAttribute('aria-current','step');else dot.removeAttribute('aria-current');});
    const animate=mounted&&!reduced.matches&&(target!==previousIndex||replay),began=performance.now();mounted=true;
    function tick(now){const t=animate?Math.min(1,(now-began)/850):1,ease=t*t*(3-2*t);for(const [id,end]of Object.entries(slide.posiciones)){const a=start[id]||end;current.set(id,{x:a.x+(end.x-a.x)*ease,y:a.y+(end.y-a.y)*ease});}draw();if(t<1)frame=requestAnimationFrame(tick);}
    tick(began);
  }
  document.getElementById('prev').onclick=()=>{if(index>0)go(index-1);};
  document.getElementById('next').onclick=()=>{if(index<data.diapositivas.length-1)go(index+1);};
  document.getElementById('replay').onclick=()=>go(index,true);
  addEventListener('keydown',event=>{if(event.defaultPrevented||event.altKey||event.ctrlKey||event.metaKey||event.target.closest('input,textarea,select,[contenteditable]'))return;if(event.key==='ArrowRight'&&index<data.diapositivas.length-1){event.preventDefault();go(index+1);}if(event.key==='ArrowLeft'&&index>0){event.preventDefault();go(index-1);}});
  new ResizeObserver(()=>placeComments()).observe(stage);
  reduced.addEventListener('change',()=>go(index));
  go(0);
})();`
