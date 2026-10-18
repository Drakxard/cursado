// General SVG player: geometry and transitions have no domain-specific rules.
export const GRAPH_RUNTIME = String.raw`
(() => {
  const data=JSON.parse(document.getElementById('graph-data').textContent);
  const stage=document.getElementById('stage'),svg=document.getElementById('scene'),edgeLayer=document.getElementById('edges'),nodeLayer=document.getElementById('nodes'),notes=document.getElementById('notes');
  const reduced=matchMedia('(prefers-reduced-motion: reduce)');
  const make=(tag,attrs,text)=>{const n=document.createElementNS('http://www.w3.org/2000/svg',tag);for(const [key,value] of Object.entries(attrs||{}))n.setAttribute(key,String(value));if(text!==undefined)n.textContent=text;return n;};
  const nodes=new Map(),edges=new Map(),current=new Map(),geometry=new Map(),layouts=new Map();
  let index=0,frame=0,comments=[],mounted=false;
  const ruler=make('text',{visibility:'hidden'}),widths=new Map();svg.append(ruler);
  function measure(text,size){const key=size+'|'+text;if(widths.has(key))return widths.get(key);ruler.setAttribute('style','font:'+size+'px ui-monospace,monospace;font-weight:700');ruler.textContent=text;const width=ruler.getComputedTextLength();widths.set(key,width);return width;}
  function wrap(text,size,width){
    const lines=[];let line='';
    for(const char of String(text)){if(char==='\n'){lines.push(line);line='';continue;}if(line&&measure(line+char,size)>width){lines.push(line);line=char;}else line+=char;}
    if(line||!lines.length)lines.push(line);return lines;
  }
  function textRows(element,values){
    const rows=wrap(element.etiqueta,18,240).map(text=>({text,size:18,kind:'node-title'}));
    for(const item of values){
      for(const text of wrap(item.etiqueta,13,240))rows.push({text,size:13,kind:'datum-caption'});
      for(const text of wrap(item.valor,16,240))rows.push({text,size:16,kind:'datum-value'});
    }
    return rows;
  }
  for(const element of data.elementos_iniciales){
    const values=data.diapositivas.map(slide=>slide.posiciones[element.id].datos??element.datos??[]);
    const card=values.some(v=>v.length)||measure(element.etiqueta,20)>44;
    const variants=values.map(v=>textRows(element,v));
    const w=card?Math.max(152,...variants.flatMap(rows=>rows.map(r=>measure(r.text,r.size)+32))):56;
    const h=card?Math.max(...variants.map(rows=>rows.length*22+24)):56;
    const bottom=h/2+(element.tipo==='subarbol'?67:0);
    geometry.set(element.id,{w,h,bottom,card,subtree:element.tipo==='subarbol'});
    layouts.set(element.id,variants);
    const group=make('g',{class:'node','data-node-id':element.id});
    if(element.tipo==='subarbol')group.append(make('polygon',{class:'subtree',points:'0,'+h/2+' -42,'+bottom+' 42,'+bottom}));
    if(card)group.append(make('rect',{class:'ring',x:-w/2-5,y:-h/2-5,width:w+10,height:h+10,rx:19}),make('rect',{class:'shape',x:-w/2,y:-h/2,width:w,height:h,rx:14}));
    else group.append(make('circle',{class:'ring',r:36}),make('circle',{class:'shape',r:28}));
    group.append(make('title',{},element.etiqueta),make('g',{class:'node-content'}));nodeLayer.append(group);nodes.set(element.id,group);
  }
  ruler.remove();
  const enhanced=[...geometry.values()].some(g=>g.card)||data.diapositivas.some(s=>s.aristas.some(e=>e.etiqueta||e.desde===e.hacia));
  let sceneWidth=1000,sceneHeight=560;
  let slides=data.diapositivas;
  if(enhanced){
    document.body.dataset.graphCards='true';
    const maxWidth=Math.max(...[...geometry.values()].map(g=>Math.max(g.w,84)));
    const maxHeight=Math.max(...[...geometry.values()].map(g=>g.h/2+g.bottom));
    const axis=(values,gap,minimum,padding)=>{
      const sorted=[...new Set(values)].sort((a,b)=>a-b),span=(sorted.length-1)*gap;
      const size=Math.max(minimum,span+2*padding),offset=(size-span)/2;
      return {size,map:new Map(sorted.map((value,i)=>[value,offset+i*gap]))};
    };
    const all=slides.flatMap(slide=>Object.values(slide.posiciones));
    const xs=axis(all.map(p=>p.x),maxWidth+64,1000,maxWidth/2+110),ys=axis(all.map(p=>p.y),maxHeight+64,560,maxHeight/2+120);
    slides=slides.map(slide=>({...slide,posiciones:Object.fromEntries(Object.entries(slide.posiciones).map(([id,p])=>[id,{...p,x:xs.map.get(p.x),y:ys.map.get(p.y)}]))}));
    sceneWidth=xs.size;sceneHeight=ys.size;
    svg.setAttribute('viewBox','0 0 '+sceneWidth+' '+sceneHeight);svg.style.minWidth=sceneWidth+'px';
  }
  const defs=make('defs'),marker=make('marker',{id:'graph-arrow',viewBox:'0 0 10 10',refX:9,refY:5,markerWidth:10,markerHeight:10,markerUnits:'userSpaceOnUse',orient:'auto'});
  marker.append(make('path',{d:'M0 0 L10 5 L0 10 Z',fill:'context-stroke'}));defs.append(marker);svg.prepend(defs);
  document.getElementById('title').textContent=data.titulo;
  for(const slide of slides)for(const edge of slide.aristas){
    const key=edge.desde+':'+edge.hacia;
    if(!edges.has(key)){
      const path=make('path',{class:'edge','data-edge-id':key}),label=make('text',{class:'edge-label','text-anchor':'middle'});
      edgeLayer.append(path,label);edges.set(key,{path,label,from:edge.desde,to:edge.hacia,opacity:0});
    }
  }
  function boundary(id,dx,dy){const g=geometry.get(id);if(!g.card){const length=Math.hypot(dx,dy)||1;return {x:dx/length*30,y:dy/length*30};}const ratio=Math.min((g.w/2+2)/(Math.abs(dx)||.001),(g.h/2+2)/(Math.abs(dy)||.001));return {x:dx*ratio,y:dy*ratio};}
  function draw(){
    for(const [id,p]of current)nodes.get(id).setAttribute('transform','translate('+p.x+' '+p.y+')');
    for(const edge of edges.values()){
      const {path,label,from,to}=edge,a=current.get(from),b=current.get(to);if(!a||!b)continue;
      const dx=b.x-a.x,dy=b.y-a.y,len=Math.hypot(dx,dy)||1,g=geometry.get(from),reverse=from!==to&&edges.has(to+':'+from);
      const control={x:(a.x+b.x)/2-dy/len*70,y:(a.y+b.y)/2+dx/len*70};
      const u=boundary(from,reverse?control.x-a.x:dx,reverse?control.y-a.y:dy),v=boundary(to,reverse?control.x-b.x:-dx,reverse?control.y-b.y:-dy);
      path.setAttribute('d',from===to?'M '+(a.x-g.w/4)+' '+(a.y-g.h/2)+' C '+(a.x-g.w/2-60)+' '+(a.y-g.h/2-100)+' '+(a.x+g.w/2+60)+' '+(a.y-g.h/2-100)+' '+(a.x+g.w/4)+' '+(a.y-g.h/2):'M '+(a.x+u.x)+' '+(a.y+u.y)+(reverse?' Q '+control.x+' '+control.y+' ':' L ')+(b.x+v.x)+' '+(b.y+v.y));
      label.setAttribute('transform','translate('+(from===to?a.x:reverse?control.x:(a.x+b.x)/2)+' '+(from===to?a.y-g.h/2-75:reverse?control.y:(a.y+b.y)/2-10)+')');
      for(const n of [path,label]){n.style.display=edge.opacity<=0?'none':'';n.style.opacity=String(edge.opacity);}
    }
    placeComments();
  }
  function placeComments(){
    if(enhanced){for(const c of comments){notes.append(c.node);c.node.style.left='';c.node.style.top='';}return;}
    const scale=svg.getBoundingClientRect().width/sceneWidth,boxes=[];
    for(const {item,node}of comments){
      const p=current.get(item.anclado_a);stage.append(node);node.style.visibility='hidden';const w=node.offsetWidth,h=node.offsetHeight;
      let desiredX=(p.x+(item.offset_x||0))*scale,desiredY=(p.y+(item.offset_y||0))*scale;
      if(item.posicion){const side=item.posicion,subtree=geometry.get(item.anclado_a).subtree;
        desiredX=side.includes('derecha')?(p.x+54)*scale:side.includes('izquierda')?(p.x-54)*scale-w:p.x*scale-w/2;
        desiredY=side.includes('arriba')?(p.y-48)*scale-h:side.includes('abajo')?(p.y+(subtree?106:48))*scale:p.y*scale-h/2;
      }
      const x=Math.max(8,Math.min(stage.clientWidth-w-8,desiredX)),y=Math.max(8,Math.min(stage.clientHeight-h-8,desiredY)),box={x,y,w,h};
      const intersects=(a,b)=>a.x<b.x+b.w+6&&a.x+a.w+6>b.x&&a.y<b.y+b.h+6&&a.y+a.h+6>b.y;
      const onNode=data.elementos_iniciales.some(el=>{const n=current.get(el.id),subtree=geometry.get(el.id).subtree;return intersects(box,{x:(n.x-44)*scale,y:(n.y-38)*scale,w:88*scale,h:(subtree?132:76)*scale});});
      if(stage.clientWidth<700||onNode||w>stage.clientWidth-16||h>stage.clientHeight-16||boxes.some(b=>intersects(box,b))){notes.append(node);node.style.left='';node.style.top='';}
      else{node.style.left=x+'px';node.style.top=y+'px';boxes.push(box);}node.style.visibility='';
    }
  }
  const dots=slides.map((slide,i)=>{const b=document.createElement('button');b.type='button';b.setAttribute('aria-label','Ir al paso '+slide.paso);b.onclick=()=>go(i);document.getElementById('dots').append(b);return b;});
  function go(target,replay=false){
    cancelAnimationFrame(frame);const previousIndex=index;index=target;
    const slide=slides[index],start=replay&&index>0?slides[index-1].posiciones:Object.fromEntries(current);
    const startEdges=new Map([...edges].map(([key,e])=>[key,replay&&index>0?(slides[index-1].aristas.some(a=>a.desde+':'+a.hacia===key)?1:0):e.opacity]));
    const active=new Set(slide.aristas.map(e=>e.desde+':'+e.hacia));
    for(const element of data.elementos_iniciales){
      const node=nodes.get(element.id),g=geometry.get(element.id),content=node.querySelector('.node-content');node.dataset.state=slide.posiciones[element.id].estado;
      content.replaceChildren();
      if(!g.card)content.append(make('text',{y:7},element.etiqueta));
      else layouts.get(element.id)[index].forEach((row,i)=>content.append(make('text',{x:0,y:-g.h/2+24+i*22,class:row.kind,style:'font-size:'+row.size+'px'},row.text)));
    }
    for(const edge of slide.aristas){
      const entry=edges.get(edge.desde+':'+edge.hacia);entry.path.dataset.style=edge.estilo;
      if(edge.dirigida)entry.path.setAttribute('marker-end','url(#graph-arrow)');else entry.path.removeAttribute('marker-end');
      entry.label.replaceChildren();
      const lines=wrapLabel(edge.etiqueta||'');lines.forEach((line,i)=>entry.label.append(make('tspan',{x:0,dy:i?'1.2em':0},line)));
    }
    for(const c of comments)c.node.remove();comments=slide.comentarios.map(item=>{const node=document.createElement('div');node.className='callout';node.dataset.color=item.color;const name=enhanced?data.elementos_iniciales.find(el=>el.id===item.anclado_a).etiqueta:item.anclado_a;node.textContent=name+': '+item.texto;return {item,node};});
    document.getElementById('counter').textContent='Paso '+slide.paso+' de '+slides.length;
    document.getElementById('prev').disabled=index===0;document.getElementById('next').disabled=index===slides.length-1;
    dots.forEach((dot,i)=>{if(i===index)dot.setAttribute('aria-current','step');else dot.removeAttribute('aria-current');});
    const animate=mounted&&!reduced.matches&&(target!==previousIndex||replay),began=performance.now();mounted=true;document.body.dataset.animating=String(animate);
    function tick(now){
      const t=animate?Math.min(1,(now-began)/850):1,ease=t*t*(3-2*t);
      for(const [id,end]of Object.entries(slide.posiciones)){const a=start[id]||end;current.set(id,{x:a.x+(end.x-a.x)*ease,y:a.y+(end.y-a.y)*ease});}
      for(const [key,edge]of edges){const a=startEdges.get(key)||0;edge.opacity=a+((active.has(key)?1:0)-a)*ease;}
      draw();if(t<1)frame=requestAnimationFrame(tick);else document.body.dataset.animating='false';
    }
    tick(began);
  }
  // Edge labels are capped by the contract; wrap without interpreting markup.
  function wrapLabel(text){const lines=[];for(let i=0;i<text.length;i+=22)lines.push(text.slice(i,i+22));return lines;}
  document.getElementById('prev').onclick=()=>{if(index>0)go(index-1);};
  document.getElementById('next').onclick=()=>{if(index<slides.length-1)go(index+1);};
  document.getElementById('replay').onclick=()=>go(index,true);
  addEventListener('keydown',event=>{if(event.defaultPrevented||event.altKey||event.ctrlKey||event.metaKey||event.target.closest('input,textarea,select,[contenteditable]'))return;if(event.key==='ArrowRight'&&index<slides.length-1){event.preventDefault();go(index+1);}if(event.key==='ArrowLeft'&&index>0){event.preventDefault();go(index-1);}});
  new ResizeObserver(()=>placeComments()).observe(stage);reduced.addEventListener('change',()=>go(index));go(0);
})();`
