import assert from 'node:assert/strict'
import test from 'node:test'
import path from 'node:path'
import { readFile, mkdir } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { chromium } from '@playwright/test'

function pdf() {
  const stream='BT /F1 18 Tf 30 100 Td (Cursado original offline) Tj ET'
  const objects=['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [3 0 R] /Count 1 >>','<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 180] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>','<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`]
  let text='%PDF-1.4\n';const offsets=[0]
  for(let i=0;i<objects.length;i++){offsets.push(Buffer.byteLength(text));text+=`${i+1} 0 obj\n${objects[i]}\nendobj\n`}
  const start=Buffer.byteLength(text)
  return Buffer.from(text+`xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map(o=>String(o).padStart(10,'0')+' 00000 n \n').join('')}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${start}\n%%EOF`)
}
const hash=value=>createHash('sha256').update(value).digest('hex')
async function setup(browser, {legacy = false} = {}) {
  const root=path.resolve(process.env.INSCREEN_NATIVE_WEB_ASSETS || 'public/native-web')
  const packageManifest=JSON.parse(await readFile(path.join(root,'current.json'),'utf8'))
  const directory=path.join(root,'releases',packageManifest.revision)
  const resources=new Map(), files=[]
  function add(pathname,content,mime='application/json') { const bytes=Buffer.isBuffer(content)?content:Buffer.from(JSON.stringify(content));const id=hash(pathname);files.push({id,path:pathname,hash:hash(bytes),size:bytes.length,mime});resources.set(id,bytes) }
  const now='2026-10-17T12:00:00Z'
  add('manifests/workspace-state.json',{workspaceTabs:{},activeWorkspaceTabId:'main',isMainWorkspaceTabVisible:true,subjectWeekdays:{'custom-calculo3':0},customSubjects:{'custom-calculo3':{id:'custom-calculo3',name:'Cálculo 3',color:'#0f766e',storageKey:'calculo3',tabId:'main',createdAt:now,targetWeekday:0}}})
  add('manifests/subject-catalog.json',{version:2,subjects:{'custom-calculo3':{id:'custom-calculo3',name:'Cálculo 3',normalizedName:'calculo 3',storageKey:'calculo3',createdAt:now,updatedAt:now}}})
  add('manifests/subject-shortcuts.json',{calculo3:{subjectId:'calculo3',buttons:[{id:'campus',label:'Campus',url:'https://campus.example.edu/calculo3',orderIndex:0,sectionScoped:false,sectionUrls:{}}]}})
  add('manifests/materials/calculo3/week-1.json',{materials:[{id:41,subject_id:'custom-calculo3',file_name:'Material original.pdf',drive_file_id:'workspace://teoria/calculo3/material.pdf',material_type:'theory',week_number:1,weekday_index:0,session_date:'2026-10-12',created_at:now,updated_at:now,order_index:0}]})
  add('manifests/sintesis/custom-calculo3/semana-1/workspace.json',{version:1,r2:{etag:null,baseline:null},workspace:{version:2,revision:0,updatedAt:now,defaultScale:1,document:{type:'doc',content:[{type:'heading',attrs:{level:1,synthesisId:'native-node'},content:[{type:'text',text:'Tema sincronizado'}]},{type:'paragraph',content:[{type:'text',text:'Contenido original de la Síntesis'}]}]},layout:{'native-node':{x:0.5,y:0.4,scale:1}}}})
  add('teoria/calculo3/material.pdf',pdf(),'application/pdf')
  add('manifests/pdf-explanations/test/saved.html',Buffer.from('<p>Contenido aislado</p>'),'text/html')
  const scene={strokes:[{id:'stroke-one',points:[{x:20,y:80},{x:220,y:90}],width:4,color:'#2563eb'}],texts:[{id:'text-one',x:20,y:20,text:'Pizarra original',fontSize:22,color:'#111827'}],media:[],shapes:[],tables:[],graphs:[],camera:{x:0,y:0,zoom:1}}
  add('boards/board.json',{id:'local:native-test',name:'Pizarra original',folderId:'folder-native',scene,assets:{}})
  add('boards/library.json',{version:1,folders:[{id:'folder-native',name:'Carpeta sincronizada'}],boards:[{id:'local:native-test',name:'Pizarra original',folderId:'folder-native',path:'boards/board.json'}]})
  if(legacy) files.splice(files.findIndex(file=>file.path==='boards/library.json'),1)
  const inventory={version:1,workspaceId:'workspace-native-browser',revision:'revision-native-browser',publishedAt:now,name:'Mi biblioteca',subjects:[],items:[{id:'board-original',kind:'board',title:'Pizarra original',fileId:hash('boards/board.json')},{id:`explanation:${hash('workspace://teoria/calculo3/material.pdf')}:saved`,kind:'html',title:'Explicación guardada',fileId:hash('manifests/pdf-explanations/test/saved.html')}],files}
  const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true})
  await context.addInitScript(({inventory})=>{
    window.nativeActions=[]
    window.CursadoNative={snapshot:()=>JSON.stringify({bridgeVersion:1,linked:true,manifest:inventory,available:{}}),pair:()=>window.nativeActions.push('pair'),refresh:()=>window.nativeActions.push('refresh'),unlink:()=>window.nativeActions.push('unlink'),openHtml:()=>window.nativeActions.push('html'),openExternal:url=>window.nativeActions.push(url)}
  },{inventory})
  const errors=[],requests=[]
  context.on('page',page=>page.on('pageerror',error=>errors.push(error.message)))
  await context.route('**/*',async route=>{
    const url=new URL(route.request().url()); requests.push(url.href)
    if(url.origin!=='https://workspace.inscreen.local'){await route.abort();return}
    if(url.pathname.startsWith('/files/')) {const bytes=resources.get(url.pathname.split('/').at(-1));const file=files.find(f=>f.id===url.pathname.split('/').at(-1));await route.fulfill({status:bytes?200:503,contentType:file?.mime||'text/plain',body:bytes||'Archivo pendiente de descarga'});return}
    const pathname=['/','/estudio','/sintesis','/practice/viewer'].includes(url.pathname)?'/index.html':url.pathname
    const local=path.resolve(directory,'.'+pathname)
    if(!local.startsWith(directory+path.sep)){await route.abort();return}
    try {const body=await readFile(local);const ext=path.extname(local);await route.fulfill({body,contentType:({'.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.html':'text/html','.svg':'image/svg+xml','.woff2':'font/woff2','.wasm':'application/wasm','.json':'application/json','.png':'image/png'})[ext]||'application/octet-stream'})}catch{await route.fulfill({status:404,body:'No encontrado'})}
  })
  return {context,errors,requests,resources,inventory}
}
test('original home, study, board and PDF work with a native read-only revision and no network',async()=>{
  const browser=await chromium.launch({headless:true,...(process.env.CI?{}:{channel:'chrome'})})
  try {
    const {context,errors,requests}=await setup(browser)
    const page=await context.newPage()
    await context.setOffline(true)
    await page.goto('https://workspace.inscreen.local/')
    await page.getByRole('link',{name:'Abrir organizador de estudio'}).click()
    await page.getByRole('button',{name:/Cálculo 3/}).waitFor({timeout:20000})
    assert.equal(await page.locator('[data-workspace-write="true"]:visible').count(),0)
    assert.equal(await page.getByText(/Seleccioná.*carpeta|Configuración InScreen/).count(),0)
    assert.equal(await page.getByText('Error al guardar',{exact:true}).count(),0)
    assert.equal(await page.evaluate(async()=> (await fetch('/api/sessions',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'})).status),403)
    await page.getByRole('button',{name:/C\u00e1lculo 3/}).click()
    const campus = page.getByRole('link',{name:'Campus',exact:true})
    await campus.waitFor({timeout:15000})
    assert.equal(await campus.getAttribute('href'),'https://campus.example.edu/calculo3')
    assert.equal(await page.getByText(/Esta biblioteca es de solo consulta/).count(),0)
    const materials = await page.evaluate(async()=>{
      const response = await fetch('/api/subject-day-materials?subjectId=custom-calculo3&weekNumber=1&scope=week')
      return {status:response.status,items:await response.json()}
    })
    assert.equal(materials.status,200)
    assert.equal(materials.items[0].file_name,'Material original.pdf')
    await campus.click()
    assert.deepEqual(await page.evaluate(()=>window.nativeActions),['https://campus.example.edu/calculo3'])
    await mkdir('.cache',{recursive:true});await page.screenshot({path:'.cache/native-study-mobile.png'})
    await page.goto('https://workspace.inscreen.local/practice/viewer?materialId=41')
    const pdf=page.frameLocator('iframe[title="Material"]')
    await pdf.locator('.page[data-page-number="1"] canvas').waitFor({timeout:20000})
    assert.equal(await pdf.locator('#toolbarContainer').isVisible(),true)
    assert.equal(await pdf.locator('#editorModeButtons').isVisible(),false)
    await page.screenshot({path:'.cache/native-pdf-mobile.png'})
    await page.getByLabel('Verlo',{exact:true}).click()
    await page.getByRole('button',{name:'Explicación guardada'}).click()
    assert.deepEqual(await page.evaluate(()=>window.nativeActions),['html'])
    assert.equal(await page.getByText('Contenido aislado',{exact:true}).count(),0)
    await page.goto('https://workspace.inscreen.local/sintesis?subjectId=custom-calculo3&weekNumber=1')
    await page.getByRole('button',{name:'Abrir Tema sincronizado'}).click()
    await page.getByText('Contenido original de la Síntesis',{exact:true}).waitFor({timeout:15000})
    assert.equal(await page.locator('.tiptap[contenteditable="true"]').count(),0)
    await page.screenshot({path:'.cache/native-synthesis-mobile.png'})
    await page.goto('https://workspace.inscreen.local/')
    await page.getByRole('link',{name:'Abrir Pizarra'}).click()
    const board=page.frameLocator('iframe[title="Pizarra"]')
    await board.getByText('Carpeta sincronizada',{exact:true}).first().waitFor({timeout:20000})
    await board.locator('.library-board-name').filter({hasText:'Pizarra original'}).click()
    await page.screenshot({path:'.cache/native-board-mobile.png'})
    assert.equal(await board.locator('[data-workspace-write="true"]:visible').count(),0)
    assert.equal(await board.getByRole('button',{name:'Opciones del lápiz'}).isVisible(),false)
    assert.equal(await board.locator('.board-search-dock').isVisible(),false)
    assert.equal(requests.some(url=>url.includes('/api/')),false)
    assert.equal(requests.every(url=>new URL(url).origin==='https://workspace.inscreen.local'),true)
    assert.deepEqual(errors,[])
    await context.close()
  } finally {await browser.close()}
})
test('missing native files are reported and incompatible bridges never open the workspace',async()=>{
  const browser=await chromium.launch({headless:true,...(process.env.CI?{}:{channel:'chrome'})})
  try{
    const {context,resources,inventory}=await setup(browser),page=await context.newPage()
    resources.delete(inventory.files.find(file=>file.path==='manifests/workspace-state.json').id)
    await page.goto('https://workspace.inscreen.local/estudio')
    await page.getByText(/pendiente de descarga/).first().waitFor({timeout:15000})
    await context.addInitScript(()=>{window.CursadoNative={snapshot:()=>JSON.stringify({bridgeVersion:2})}})
    await page.reload()
    await page.getByText(/Actualizá InScreen/).waitFor()
    await context.close()
  }finally{await browser.close()}
})
test('existing linked inventories open boards without another QR or a new publication',async()=>{
  const browser=await chromium.launch({headless:true,...(process.env.CI?{}:{channel:'chrome'})})
  try{
    const {context,errors}=await setup(browser,{legacy:true}),page=await context.newPage()
    await context.setOffline(true)
    await page.goto('https://workspace.inscreen.local/')
    await page.getByRole('link',{name:'Abrir Pizarra'}).click()
    const board=page.frameLocator('iframe[title="Pizarra"]')
    await board.locator('.library-board-name').filter({hasText:'Pizarra original'}).click()
    assert.deepEqual(await page.evaluate(()=>window.nativeActions),[])
    assert.deepEqual(errors,[])
    await context.close()
  }finally{await browser.close()}
})
