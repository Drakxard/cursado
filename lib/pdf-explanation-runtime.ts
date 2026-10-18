// This fixed runtime is embedded in exports. Model content is inserted as text;
// only server-rendered, trust:false KaTeX markup is inserted as HTML.
export const STRUCTURED_LESSON_STYLES = `
*{box-sizing:border-box}body{margin:0;background:#f4f6fb;color:#182439;font:16px/1.6 system-ui,sans-serif}main{max-width:1000px;margin:auto;padding:clamp(14px,4vw,36px)}h1,h2{line-height:1.25}h1{font-size:clamp(24px,4vw,36px)}h2{font-size:clamp(20px,3vw,27px)}.eyebrow{font-size:12px;letter-spacing:.12em;color:#536784}#counter{color:#536784}progress{width:100%;accent-color:#4f46e5;height:7px}#screen{background:white;padding:clamp(16px,3vw,28px);border-radius:20px;box-shadow:0 6px 24px #1725540d;overflow:hidden}.change{border-left:3px solid #6366f1;padding:8px 16px;background:#eef2ff}.warning{background:#fff4d6;padding:12px;border-radius:10px}p{white-space:pre-wrap;overflow-wrap:anywhere}.formula,.table-wrap,.diagram-wrap{overflow:auto;margin:20px 0}.diagram-wrap svg{display:block;width:100%;min-width:320px}.diagram-node rect{fill:#eef2ff;stroke:#6366f1;stroke-width:2}.diagram-node text{fill:#182439;text-anchor:middle;font:15px system-ui}.diagram-node.active rect{fill:#fef3c7;stroke:#b45309;stroke-width:3}.diagram-edge{stroke:#71829d;stroke-width:2;fill:none}.diagram-edge.active{stroke:#b45309;stroke-width:4}.edge-label{font:12px system-ui;fill:#44536b;text-anchor:middle}.diagram-node:focus{outline:none}.diagram-node:focus rect{stroke:#111827;stroke-width:4}table{border-collapse:collapse;min-width:100%;font-size:14px}caption{text-align:left;font-weight:600;margin-bottom:10px}th,td{border:1px solid #dce2ef;padding:10px;text-align:left;white-space:pre-wrap;overflow-wrap:anywhere}th{background:#eef2ff}td.active{background:#fef3c7}nav{display:flex;gap:10px;justify-content:space-between;margin-top:18px}button{font:inherit;padding:10px 16px;border:0;border-radius:10px;background:#4f46e5;color:white;cursor:pointer}button:disabled{opacity:.4;cursor:default}button:focus-visible{outline:3px solid #f59e0b;outline-offset:3px}#replay{background:#e0e7ff;color:#3730a3}@media(max-width:480px){main{padding:12px}button{padding:10px 12px}.diagram-wrap svg{min-width:280px}}@media(prefers-reduced-motion:reduce){*{animation:none!important;transition:none!important}}`

export const STRUCTURED_LESSON_RUNTIME = String.raw`
(() => {
  const lesson=JSON.parse(document.getElementById('verlo-lesson').textContent);
  const formulas=JSON.parse(document.getElementById('verlo-formulas').textContent);
  const screen=document.getElementById('screen');
  const reduced=matchMedia('(prefers-reduced-motion: reduce)');
  const layouts=new Map(); let index=0, replayTimer, animation=0, generation=0;
  const el=(tag,text,cls)=>{const node=document.createElement(tag);if(text!==undefined)node.textContent=text;if(cls)node.className=cls;return node;};
  const svgEl=(tag,attrs,text)=>{const node=document.createElementNS('http://www.w3.org/2000/svg',tag);for(const [key,value] of Object.entries(attrs||{}))node.setAttribute(key,String(value));if(text!==undefined)node.textContent=text;return node;};
  document.getElementById('title').textContent=lesson.title;
  for(const warning of lesson.warnings)document.getElementById('warnings').append(el('p',warning,'warning'));
  function diagram(block,token){
    const wrap=el('div',undefined,'diagram-wrap'); const positions=new Map();let height=400,width=760;
    if(block.kind==='tree'){
      let ordinal=0,depthMax=0;
      function visit(id,depth){const edges=block.edges.filter(e=>e.from===id);const left=edges.find(e=>e.side==='left'),right=edges.find(e=>e.side==='right');if(left)visit(left.to,depth+1);positions.set(id,{x:ordinal++*150+80,y:depth*100+55});depthMax=Math.max(depthMax,depth);if(right)visit(right.to,depth+1);}
      visit(block.root,0);width=Math.max(320,ordinal*150+10);height=Math.max(180,depthMax*100+110);
    }else{
      width=Math.max(500,block.nodes.length*55);height=Math.max(350,Math.min(width,850));
      block.nodes.forEach((node,i)=>{const angle=2*Math.PI*i/block.nodes.length-Math.PI/2;positions.set(node.id,{x:width/2+Math.cos(angle)*(width/2-85),y:height/2+Math.sin(angle)*(height/2-55)});});
    }
    const svg=svgEl('svg',{viewBox:'0 0 '+width+' '+height,role:'img','aria-label':block.kind==='tree'?'Árbol '+block.id:'Grafo '+block.id});
    svg.style.minWidth=width+'px';
    const defs=svgEl('defs');const marker=svgEl('marker',{id:'arrow-'+block.id,viewBox:'0 0 10 10',refX:9,refY:5,markerWidth:7,markerHeight:7,orient:'auto-start-reverse'});marker.append(svgEl('path',{d:'M 0 0 L 10 5 L 0 10 z',fill:'#71829d'}));defs.append(marker);svg.append(defs);
    const edges=block.edges.map(edge=>{const line=svgEl('path',{class:'diagram-edge'+(block.highlights.includes(edge.id)?' active':''),'data-edge-id':edge.id,...(block.kind==='graph'?{'marker-end':'url(#arrow-'+block.id+')'}:{})});const label=svgEl('text',{class:'edge-label'},edge.label);svg.append(line,label);return {edge,line,label};});
    const nodes=block.nodes.map(node=>{const group=svgEl('g',{class:'diagram-node'+(block.highlights.includes(node.id)?' active':''),'data-node-id':node.id,tabindex:0,role:'button','aria-label':node.label,'aria-pressed':block.highlights.includes(node.id)});group.append(svgEl('rect',{x:-62,y:-23,width:124,height:46,rx:12}));const title=svgEl('title',{},node.label);group.append(title);const text=svgEl('text',{y:5},node.label.length>15?node.label.slice(0,14)+'…':node.label);group.append(text);const toggle=()=>{const selected=group.classList.toggle('active');group.setAttribute('aria-pressed',String(selected));};group.onclick=toggle;group.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();toggle();}};svg.append(group);return {node,group};});
    const previous=layouts.get(block.id);layouts.set(block.id,positions);
    function draw(t){const current=new Map();for(const [id,end]of positions){const start=previous&&previous.get(id)||end;current.set(id,{x:start.x+(end.x-start.x)*t,y:start.y+(end.y-start.y)*t});}for(const {node,group}of nodes){const p=current.get(node.id);group.setAttribute('transform','translate('+p.x+' '+p.y+')');}for(const {edge,line,label}of edges){const from=current.get(edge.from),to=current.get(edge.to);const dx=to.x-from.x,dy=to.y-from.y,len=Math.hypot(dx,dy)||1;const boundary=Math.min(Math.abs(dx)>0?62*len/Math.abs(dx):Infinity,Math.abs(dy)>0?23*len/Math.abs(dy):Infinity);const startOffset=Number.isFinite(boundary)?boundary+2:27,endOffset=startOffset+6;const x1=from.x+dx/len*startOffset,y1=from.y+dy/len*startOffset,x2=to.x-dx/len*endOffset,y2=to.y-dy/len*endOffset;const curve=block.kind==='graph'?' Q '+((x1+x2)/2-dy*.1)+' '+((y1+y2)/2+dx*.1)+' '+x2+' '+y2:' L '+x2+' '+y2;line.setAttribute('d',edge.from===edge.to?'M '+from.x+' '+(from.y-23)+' C '+(from.x-90)+' '+(from.y-110)+' '+(from.x+90)+' '+(from.y-110)+' '+(from.x+12)+' '+(from.y-23):'M '+x1+' '+y1+curve);label.setAttribute('x',(from.x+to.x)/2-(block.kind==='graph'?dy*.05:0));label.setAttribute('y',(from.y+to.y)/2+(block.kind==='graph'?dx*.05:0)-10);}}
    draw(reduced.matches?1:0);if(!reduced.matches&&previous){const start=performance.now();function tick(now){if(token!==generation)return;const t=Math.min(1,(now-start)/350);draw(t*t*(3-2*t));if(t<1)requestAnimationFrame(tick);}requestAnimationFrame(tick);}else draw(1);
    wrap.append(svg);return wrap;
  }
  function show(){
    clearTimeout(replayTimer);cancelAnimationFrame(animation);const token=++generation;const step=lesson.steps[index];screen.replaceChildren(el('h2',step.title));if(step.change)screen.append(el('p',step.change,'change'));
    step.blocks.forEach((block,b)=>{
      if(block.type==='text')screen.append(el('p',block.text));
      if(block.type==='formula'){const formula=el('div',undefined,'formula');formula.innerHTML=formulas[index+':'+b];screen.append(formula);}
      if(block.type==='table'){const wrap=el('div',undefined,'table-wrap'),table=el('table');table.append(el('caption',block.caption));const head=el('thead'),header=el('tr');for(const column of block.columns){const th=el('th',column);th.scope='col';header.append(th);}head.append(header);table.append(head);const body=el('tbody');block.rows.forEach((row,r)=>{const tr=el('tr');row.forEach((value,c)=>tr.append(el('td',value,block.highlights.some(cell=>cell.row===r&&cell.column===c)?'active':undefined)));body.append(tr);});table.append(body);wrap.append(table);screen.append(wrap);}
      if(block.type==='diagram')screen.append(diagram(block,token));
    });
    document.getElementById('counter').textContent='Paso '+(index+1)+' de '+lesson.steps.length;const progress=document.getElementById('progress');progress.max=lesson.steps.length;progress.value=index+1;document.getElementById('prev').disabled=index===0;document.getElementById('next').disabled=index===lesson.steps.length-1;
  }
  document.getElementById('prev').onclick=()=>{if(index>0){index--;show();}};
  document.getElementById('next').onclick=()=>{if(index<lesson.steps.length-1){index++;show();}};
  document.getElementById('replay').onclick=()=>{const target=index;if(index>0&&!reduced.matches){index--;show();replayTimer=setTimeout(()=>{index=target;show();},400);}else{layouts.clear();show();}};
  show();
})();`
