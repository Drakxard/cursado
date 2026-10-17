'use strict';
const $=id=>document.getElementById(id),content=$('content');
let snapshot={},view={kind:'home'},history=[],pending=null,board=null,subjectsReader=null,generation=0;
const element=(tag,text,className)=>{const e=document.createElement(tag);if(text!==undefined)e.textContent=text;if(className)e.className=className;return e};
const button=(label,callback,className)=>{const b=element('button',label,className);b.onclick=callback;return b};
const message=text=>{$('status').textContent=text;pending=null};
function manifest(){return snapshot.manifest||{items:[],subjects:[],files:[]}}
function fileById(id){return manifest().files.find(f=>f.id===id)}
function fileByPath(path){return manifest().files.find(f=>f.path===path)}
function fileUrl(file){return `/files/${manifest().revision}/${file.id}`}
function clearReader(){generation++;board?.close();board=null;subjectsReader?.close();subjectsReader=null;delete document.body.dataset.reader;content.replaceChildren()}
function go(next){history.push(view);view=next;render()}
function back(){if(history.length){view=history.pop();render()}else Library.home()}
window.LibraryBack=back;
window.LibraryMessage=text=>{message(text);$('status').className='error'};
window.LibraryReload=()=>{try{snapshot=JSON.parse(Library.snapshot());$('status').className='';render()}catch(error){message(error.message)}};
window.LibraryDownloaded=(id,revision)=>{if(!pending||pending.id!==id||pending.revision!==revision)return;snapshot.available[id]=true;const item=pending.item;pending=null;void openItem(item)};
$('back').onclick=back;$('refresh').onclick=()=>{message('Buscando novedades…');Library.refresh()};$('settings').onclick=()=>go({kind:'settings'});
function availability(item){return !item.fileId||snapshot.available?.[item.fileId]?'Disponible sin conexión':'Pendiente de descarga'}
function card(label,detail,callback,available){const card=button('',callback,'card');card.append(element('strong',label));if(detail)card.append(element('small',detail,available===true?'offline':available===false?'pending':''));return card}
function empty(text){content.append(element('div',text,'empty'))}
function list(items){const grid=element('div',undefined,'list');for(const item of items)grid.append(card(item.title,availability(item),()=>void openItem(item),!item.fileId||Boolean(snapshot.available?.[item.fileId])));content.append(grid);if(!items.length)empty('No hay materiales en esta sección.')}
function render(){
  clearReader();$('title').textContent=snapshot.name||'Cursado';
  if(!snapshot.linked){$('status').textContent=snapshot.error||'Tu biblioteca, también sin conexión';empty('Vinculá InScreen con el QR de Cursado para llevar tus materiales.');content.append(button('Vincular con nuevo dispositivo',()=>Library.pair()));return}
  const inventory=manifest(),files=inventory.files,downloaded=files.filter(f=>snapshot.available?.[f.id]).length;
  $('status').textContent=`${snapshot.online?'Con conexión':'Sin conexión'} · ${downloaded}/${files.length} archivos guardados${inventory.publishedAt?' · '+new Date(inventory.publishedAt).toLocaleString('es-AR'):''}`;
  if(view.kind==='settings'){const settings=element('div',undefined,'settings');settings.append(element('h2','Dispositivos'),element('p',snapshot.name),element('p','Se descarga todo por Wi-Fi. Con datos móviles se actualiza el catálogo y se descarga lo que abras.'),button('Actualizar ahora',()=>Library.refresh()),button('Vincular con nuevo dispositivo',()=>Library.pair()),button('Quitar biblioteca de este celular',()=>Library.unlink()));content.append(settings);return}
  if(!snapshot.manifest){empty('La biblioteca está vinculada. Conectate para obtener el catálogo.');return}
  if(view.kind==='home'){const choices=element('nav',undefined,'choices');for(const [kind,label,icon]of[['boards','Pizarra','pizarra-home.svg'],['study','Estudio','icon.svg']]){const b=button('',()=>go({kind}),'choice');b.setAttribute('aria-label',label);const image=element('img');image.src=icon;image.alt=label;b.append(image);choices.append(b)}content.append(choices);return}
  if(view.kind==='boards'){$('title').textContent='Pizarras';list(inventory.items.filter(i=>i.kind==='board'));return}
  if(view.kind==='study'){
    $('title').textContent='Estudio';const grid=element('div',undefined,'list');grid.append(card('★ Importantes','Todos los apuntes destacados',()=>go({kind:'important'})));
    if(inventory.items.some(i=>i.kind!=='board'&&!i.subjectId))grid.append(card('Otros recursos','Cronograma y archivos generales',()=>go({kind:'resources'})));content.append(grid);
    const subjects=inventory.subjects.filter(subject=>inventory.items.some(i=>i.subjectId===subject.id)).map(subject=>({...subject,detail:subject.weekday==null?'--':`${(subject.weekday-(new Date().getDay()+6)%7+7)%7}d`}));const host=element('div');content.append(host);subjectsReader=CursadoBoardReader.openSubjectsReader(host,subjects,id=>go({kind:'subject',subjectId:id}));return
  }
  if(view.kind==='important'){$('title').textContent='★ Importantes';list(inventory.items.filter(i=>i.important));return}
  if(view.kind==='resources'){$('title').textContent='Otros recursos';list(inventory.items.filter(i=>i.kind!=='board'&&!i.subjectId));return}
  const subject=inventory.subjects.find(s=>s.id===view.subjectId);$('title').textContent=subject?.name||'Materia';
  if(view.kind==='subject'){
    const items=inventory.items.filter(i=>i.subjectId===view.subjectId),weeks=[...new Set(items.map(i=>i.week??null))].sort((a,b)=>(b??-1)-(a??-1));
    const grid=element('div',undefined,'list');for(const week of weeks)grid.append(card(week===null?'Recursos generales':`Semana ${week}`,'Ver secciones',()=>go({kind:'week',subjectId:view.subjectId,week})));content.append(grid);return
  }
  if(view.kind==='week'){
    const items=inventory.items.filter(i=>i.subjectId===view.subjectId&&(i.week??null)===view.week),sections=[...new Set(items.map(i=>i.section||'Recursos'))];
    const grid=element('div',undefined,'list');for(const section of sections)grid.append(card(section,`${items.filter(i=>(i.section||'Recursos')===section).length} materiales`,()=>go({kind:'section',subjectId:view.subjectId,week:view.week,section})));content.append(grid);return
  }
  if(view.kind==='section'){list(inventory.items.filter(i=>i.subjectId===view.subjectId&&(i.week??null)===view.week&&(i.section||'Recursos')===view.section));return}
  if(view.kind==='item'){void renderItem(view.item).catch(error=>message(error.message))}
}
async function openItem(item){
  const file=fileById(item.fileId);
  if(file&&!snapshot.available?.[file.id]){pending={id:file.id,revision:manifest().revision,item};message('Descargando el archivo…');pending={id:file.id,revision:manifest().revision,item};Library.download(file.id,manifest().revision);return}
  go({kind:'item',item})
}
async function json(file){const response=await fetch(fileUrl(file));if(!response.ok)throw Error('Este recurso no está descargado. Conectate y reintentá.');return response.json()}
function renderDocument(node){
  if(!node)return document.createDocumentFragment();
  if(node.type==='text'){let text=document.createTextNode(node.text||'');for(const mark of node.marks||[]){const tag={bold:'strong',italic:'em',underline:'u',strike:'s',code:'code',subscript:'sub',superscript:'sup'}[mark.type];if(tag){const wrapper=element(tag);wrapper.append(text);text=wrapper}}return text}
  if(/math/i.test(node.type||'')){const span=element('span');try{katex.render(node.attrs?.latex||node.attrs?.value||node.text||'',span,{throwOnError:false,displayMode:/block/i.test(node.type),trust:false})}catch{span.textContent=node.attrs?.latex||''}return span}
  if(node.type==='image'){const src=node.attrs?.src||'',id=src.replace(/^synthesis-local-image:/,'');const file=manifest().files.find(f=>f.path.startsWith('sintesis/images/')&&(f.path.split('/').pop().split('.')[0]===id));const img=element('img');img.alt=node.attrs?.alt||'Imagen';if(file)img.src=fileUrl(file);else if(/^data:image\/(png|jpeg|webp);base64,/.test(src))img.src=src;return img}
  const tag={doc:'article',paragraph:'p',heading:'h'+Math.max(1,Math.min(6,Number(node.attrs?.level)||2)),bulletList:'ul',orderedList:'ol',listItem:'li',taskList:'ul',taskItem:'li',blockquote:'blockquote',codeBlock:'pre',hardBreak:'br',horizontalRule:'hr',table:'table',tableRow:'tr',tableCell:'td',tableHeader:'th'}[node.type]||'div';
  const wrapper=element(tag);for(const child of node.content||[])wrapper.append(renderDocument(child));return wrapper
}
async function renderItem(item){
  $('title').textContent=item.title;const file=fileById(item.fileId),token=generation;
  if(item.kind==='board'&&file){const data=await json(file);if(token!==generation)return;const tools=element('div',undefined,'tools'),host=element('div',undefined,'board-host');tools.append(button('Ajustar vista',()=>board?.fit()));content.append(tools,host);board=CursadoBoardReader.openBoardReader(host,data.scene,id=>{const f=fileByPath(data.assets[id]);return f?fileUrl(f):''});return}
  if(file?.mime==='application/pdf'){await showPdf(file,token);return}
  const article=element('article',undefined,'reader');content.append(article);
  if(item.text)article.append(element('p',item.text));
  if(!file)return;
  if(file.mime.startsWith('audio/')){const audio=element('audio');audio.controls=true;audio.src=fileUrl(file);article.append(audio);return}
  if(file.mime.startsWith('image/')){const img=element('img');img.src=fileUrl(file);img.alt=item.title;article.append(img);return}
  if(item.kind==='synthesis'){const data=await json(file);if(token!==generation)return;article.append(renderDocument(data.workspace?.document||data.document));return}
  if(file.mime==='text/html'){article.append(button('Abrir Verlo',()=>Library.openHtml(file.id,manifest().revision)));Library.openHtml(file.id,manifest().revision);return}
  const response=await fetch(fileUrl(file));if(!response.ok)throw Error('Archivo no disponible.');const text=await response.text();if(token!==generation)return;
  if(file.mime.includes('json')){const data=JSON.parse(text);if(typeof data.html==='string'){const iframe=element('iframe',undefined,'html-reader');iframe.sandbox='';iframe.title=item.title;iframe.srcdoc=data.html;article.append(iframe)}else if(data.workspace?.document||data.document)article.append(renderDocument(data.workspace?.document||data.document));else article.append(element('pre',JSON.stringify(data,null,2)))}else article.append(element('pre',text))
}
async function showPdf(file,token){
  if(token!==generation)return;
  message('Abriendo PDF...');document.body.dataset.reader='pdf';
  const iframe=element('iframe',undefined,'pdf-viewer');iframe.title='PDF.js - '+view.item.title;
  iframe.src='pdfjs/web/viewer.html?'+new URLSearchParams({file:fileUrl(file),libraryReadOnly:'1'});
  content.append(iframe);
}
window.addEventListener('message',event=>{
  const frame=content.querySelector('.pdf-viewer');
  if(event.origin!==location.origin||event.source!==frame?.contentWindow)return;
  if(event.data?.type==='libraryPdfReady')message('PDF disponible sin conexión');
  if(event.data?.type==='libraryPdfError')message('No se pudo abrir el PDF. Reintentá la descarga.');
});
setInterval(()=>{if(view.kind==='item'||pending)return;try{const next=JSON.parse(Library.snapshot());if(JSON.stringify(next)!==JSON.stringify(snapshot)){snapshot=next;render()}}catch{}},4000);
if(window.Library){LibraryReload();Library.refresh()}else empty('Abrí esta biblioteca desde InScreen.');
