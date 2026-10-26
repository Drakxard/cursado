import assert from 'node:assert/strict'
import test from 'node:test'
import { build } from 'esbuild'
import { readFile } from 'node:fs/promises'
import { extname, resolve, sep } from 'node:path'
import { chromium, expect } from '@playwright/test'

test('existing board shortcuts, contextual figure editing and external clipboard preserve content', { timeout: 60000 }, async t => {
  const parent = await build({ stdin: { resolveDir: process.cwd(), loader:'tsx', contents:`
    import {createRoot} from 'react-dom/client';import {TopicBoardOverlay} from './components/topic-board-overlay';
    const root=await navigator.storage.getDirectory(),directory=await(await root.getDirectoryHandle('progreso',{create:true})).getDirectoryHandle('pizarras',{create:true});
    const content={camera:{x:0,y:0,zoom:1},strokes:[],texts:[],shapes:[],tables:[],graphs:[],media:[],videos:[]};
    for(const [id,shapes] of [['source',[{id:'shortcut',kind:'rounded',visualType:'board-shortcut',boardReference:{boardId:'study-existing',name:'Theory'},label:'Theory',x:100,y:200,width:220,height:60,color:'#2563eb',strokeWidth:1}]],['study-existing',[{id:'figure',kind:'rectangle',x:100,y:230,width:380,height:240,color:'#ff9900',strokeWidth:3}]]]){
      const writer=await(await directory.getFileHandle(id+'.json',{create:true})).createWritable();await writer.write(JSON.stringify({version:1,boardId:id,name:id,assets:{},content:{...content,shapes}}));await writer.close();
    }
    window.removeBoard=async id=>directory.removeEntry(id+'.json');
    window.readBoard=async id=>JSON.parse(await(await(await directory.getFileHandle(id+'.json')).getFile()).text());
    createRoot(document.getElementById('root')).render(<TopicBoardOverlay boardId="source" name="Source" rootHandle={root} onClose={()=>window.closedBoard=true}/>);
  ` }, jsx:'automatic', bundle:true,format:'esm',write:false,plugins:[{ name:'parent',setup(builder){builder.onResolve({filter:/^@\/lib\/(native-workspace|client\/cooperation|client\/cooperation-files)$/},args=>({path:args.path,namespace:'fixture'}));builder.onLoad({filter:/.*/,namespace:'fixture'},()=>({contents:'export const isNativeReadOnly=()=>false;export const cooperationPresence=()=>undefined;export const cooperationState=()=>({mirrors:{}});export const sendCooperationEditor=()=>{};export const mapBindingText=x=>x;'}))} }] })
  const browser=await chromium.launch({channel:process.env.CI?undefined:'chrome'});t.after(()=>browser.close())
  const page=await browser.newPage({viewport:{width:1000,height:760},serviceWorkers:'block'}),errors=[]
  page.on('pageerror',error=>errors.push(error.message))
  const directory=resolve('public/pizarra')
  await page.route('https://context.test/**',async route=>{
    const path=new URL(route.request().url()).pathname
    if(path==='/')return route.fulfill({contentType:'text/html',body:'<style>body{margin:0}.fixed{position:fixed;inset:0;display:flex;flex-direction:column}.absolute{position:absolute}iframe{flex:1;min-height:0;width:100%;border:0}</style><div id="root"></div><script type="module" src="/parent.js"></script>'})
    if(path==='/parent.js')return route.fulfill({contentType:'text/javascript',body:parent.outputFiles[0].text})
    if(path==='/pizarra/api/auth/me')return route.fulfill({json:{id:'account'}})
    if(path==='/pizarra/api/library')return route.fulfill({json:{folders:[],boards:[{id:'server-accessible',name:'Shared board',folder_id:null,version:1,updated_at:''}]}})
    if(path==='/pizarra/api/boards/server-accessible')return route.fulfill({json:{id:'server-accessible',name:'Shared board',version:1,content:{camera:{x:0,y:0,zoom:1},strokes:[],texts:[],shapes:[],tables:[],graphs:[],media:[],videos:[]}}})
    if(!path.startsWith('/pizarra/')||path.includes('/api/'))return route.fulfill({status:404,body:'{}'})
    const file=resolve(directory,'.'+(path==='/pizarra/'?'/index.html':path.slice('/pizarra'.length)));assert.ok(file.startsWith(directory+sep))
    try{return await route.fulfill({body:await readFile(file),contentType:({'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.woff2':'font/woff2'})[extname(file)]||'application/octet-stream'})}catch{return route.fulfill({status:404})}
  })
  await page.goto('https://context.test/')
  const child=page.frameLocator('iframe'),canvas=child.locator('.app > canvas').first()
  await expect(page.locator('iframe')).toHaveCSS('visibility','visible')
  await canvas.click({position:{x:200,y:230}})
  await expect(child.locator('.app')).toHaveAttribute('data-board-id','local:important-study-existing')
  await child.getByRole('button',{name:'Seleccionar área',exact:true}).click()
  await canvas.dblclick({position:{x:250,y:340}})
  await child.getByRole('textbox',{name:'Texto de la figura'}).fill('Texto en la figura')
  await child.getByRole('textbox',{name:'Texto de la figura'}).press('Control+Enter')
  const toolbar=child.getByRole('toolbar',{name:'Propiedades de la figura'})
  await toolbar.getByRole('button',{name:'Relleno',exact:true}).first().click()
  await toolbar.getByRole('button',{name:'Relleno #ffe1c2',exact:true}).click()
  await toolbar.getByRole('button',{name:'Negrita',exact:true}).click()
  const popup=toolbar.locator('.object-toolbar-popup'),box=await popup.boundingBox()
  assert.ok(box.x>=0&&box.y>=0&&box.x+box.width<=1000&&box.y+box.height<=760)
  await page.screenshot({path:'.cache/board-context-tools.png'})
  await page.setViewportSize({width:360,height:640})
  await expect.poll(async()=>{const rect=await popup.boundingBox();return rect.x>=0&&rect.y>=0&&rect.x+rect.width<=360&&rect.y+rect.height<=640}).toBe(true)
  await page.setViewportSize({width:1000,height:760})
  await toolbar.getByRole('button',{name:'Relleno',exact:true}).first().click()
  await canvas.click({position:{x:250,y:340}})
  await page.keyboard.press('Control+c')
  await canvas.click({position:{x:700,y:500}})
  await canvas.evaluate(node=>{const data=new DataTransfer();data.setData('text/plain','Texto copiado desde Figma');node.dispatchEvent(new ClipboardEvent('paste',{clipboardData:data,bubbles:true,cancelable:true}))})
  await expect(child.getByRole('toolbar',{name:'Propiedades de la selección'})).toBeVisible()
  await canvas.evaluate(node=>{const data=new DataTransfer();data.setData('image/svg+xml','<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100"><rect x="0" y="0" width="200" height="100" fill="#ff0000"/><text x="10" y="30">SVG editable</text></svg>');node.dispatchEvent(new ClipboardEvent('paste',{clipboardData:data,bubbles:true,cancelable:true}))})
  await expect(child.getByRole('toolbar',{name:'Propiedades de la figura'})).toBeVisible()
  await page.getByRole('button',{name:'Volver a Temas'}).click()
  await expect(child.locator('.app')).toHaveAttribute('data-board-id','local:important-source')
  const board=await page.evaluate(()=>window.readBoard('study-existing'))
  assert.equal(board.content.shapes[0].label,'Texto en la figura')
  assert.equal(board.content.shapes[0].fill,'#ffe1c2')
  assert.equal(board.content.shapes[0].labelBold,true)
  assert.equal(board.content.shapes.at(-1).fill,'#ff0000')
  assert.deepEqual(board.content.texts.map(text=>text.text),['Texto copiado desde Figma','SVG editable'])
  // A topic dragged before its first opening has no snapshot or Important row.
  // Exercise the real drop handler and preserve its context through persistence.
  const drop = async reference => canvas.evaluate((node,reference)=>{
    const data=new DataTransfer();data.setData('application/x-cursado-board-link',JSON.stringify(reference));
    node.dispatchEvent(new DragEvent('drop',{dataTransfer:data,clientX:700,clientY:400,bubbles:true,cancelable:true}));
  },reference)
  await drop({boardId:'local:important-study-unopened',name:'Unopened theory',topic:{cooperationSubjectId:'subject',cooperationWeekNumber:2,pdfReferences:[]}})
  await canvas.click({position:{x:740,y:420}})
  await expect(child.locator('.app')).toHaveAttribute('data-board-id','local:important-study-unopened')
  const created=await page.evaluate(()=>window.readBoard('study-unopened'))
  assert.equal(created.cooperationSubjectId,'subject');assert.equal(created.cooperationWeekNumber,2)
  await page.getByRole('button',{name:'Volver a Temas'}).click()
  await expect(child.locator('.app')).toHaveAttribute('data-board-id','local:important-source')
  // Recover an existing device copy if its workspace backup is absent.
  await page.evaluate(()=>window.removeBoard('study-existing'))
  await canvas.click({position:{x:200,y:230}})
  await expect(child.locator('.app')).toHaveAttribute('data-board-id','local:important-study-existing')
  await page.getByRole('button',{name:'Volver a Temas'}).click()
  await expect(child.locator('.app')).toHaveAttribute('data-board-id','local:important-source')
  // Embedded boards resolve the signed-in session before listing server boards.
  await drop({boardId:'server-accessible',name:'Shared board'})
  await canvas.click({position:{x:740,y:420}})
  await expect(child.locator('.app')).toHaveAttribute('data-board-id','server-accessible')
  await page.getByRole('button',{name:'Volver a Temas'}).click()
  await expect(child.locator('.app')).toHaveAttribute('data-board-id','local:important-source')
  await page.getByRole('button',{name:'Volver a Temas'}).click()
  await expect.poll(()=>page.evaluate(()=>window.closedBoard)).toBe(true)
  assert.deepEqual(errors,[])
})
