import assert from 'node:assert/strict'
import test from 'node:test'
import { build } from 'esbuild'
import { readFile } from 'node:fs/promises'
import { extname, resolve, sep } from 'node:path'
import { chromium, expect } from '@playwright/test'

const parentBundle = await build({ stdin: { resolveDir: process.cwd(), contents: `
  import {createRoot} from 'react-dom/client';
  import {TopicBoardOverlay} from './tests/helpers/legacy-topic-board-overlay';
  const root=await navigator.storage.getDirectory();
  const directory=await(await root.getDirectoryHandle('progreso',{create:true})).getDirectoryHandle('pizarras',{create:true});
  // Use the same file name/format as topic workspaces.
  const writer=await(await directory.getFileHandle('opening.json',{create:true})).createWritable();
  await writer.write(JSON.stringify({version:1,boardId:'opening',name:'Opening',assets:{},content:{camera:{x:0,y:0,zoom:1},
    strokes:[{points:[{x:150,y:300},{x:300,y:300}],color:'#e00000',width:8}],texts:[],shapes:[],tables:[],graphs:[],media:[],videos:[]}}));await writer.close();
  window.readySamples=[];
  window.addEventListener('message',event=>{
    if(event.origin!==location.origin||event.source!==document.querySelector('iframe')?.contentWindow||event.data?.type!=='topic-board:ready')return;
    const frame=document.querySelector('iframe'),canvas=frame.contentDocument.querySelector('.app > canvas');
    const dpr=frame.contentWindow.devicePixelRatio;
    window.readySamples.push({pixel:[...canvas.getContext('2d').getImageData(200*dpr,300*dpr,1,1).data],height:frame.getBoundingClientRect().height});
  });
  createRoot(document.getElementById('root')).render(<TopicBoardOverlay boardId="opening" name="Opening" rootHandle={root} onClose={()=>window.closedBoard=true}/>);
`, loader: 'tsx' }, jsx: 'automatic', bundle: true, format: 'esm', write: false, plugins: [{ name: 'parent-services', setup(builder) {
  builder.onResolve({ filter: /^@\/lib\/(native-workspace|client\/cooperation|client\/cooperation-files)$/ }, args => ({ path: args.path, namespace: 'fixture' }))
  builder.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: 'export const isNativeReadOnly=()=>false;export const cooperationPresence=()=>undefined;export const cooperationState=()=>({mirrors:{}});export const sendCooperationEditor=()=>{};export const mapBindingText=x=>x;' }))
} }] })

for (const {theme, fail} of [...['light', 'dark', 'rest'].map(theme => ({theme, fail:false})), {theme:'dark',fail:true}]) test(`opening ${theme}${fail ? ' with failed storage' : ''}: stable viewport, matching startup theme and first scene before reveal`, { timeout: 60000 }, async t => {
  const browser = await chromium.launch({ channel: process.env.CI ? undefined : 'chrome' }); t.after(() => browser.close())
  const context = await browser.newContext({ viewport: { width: 1366, height: 900 }, serviceWorkers: 'block' })
  await context.addInitScript(({theme,fail}) => {
    localStorage.setItem('pizarra-theme', theme)
    window.canvasResets = 0
    if(fail) {
      const get=IDBObjectStore.prototype.get
      IDBObjectStore.prototype.get=function(...args) {
        if(this.name==='boards' && document.querySelector('.app')) throw new Error('Opening storage failure')
        return get.apply(this,args)
      }
    }
    for (const property of ['width', 'height']) {
      const descriptor = Object.getOwnPropertyDescriptor(HTMLCanvasElement.prototype, property)
      Object.defineProperty(HTMLCanvasElement.prototype, property, { ...descriptor, set(value) { window.canvasResets++; descriptor.set.call(this, value) } })
    }
  }, {theme,fail})
  const page = await context.newPage(), errors = []
  page.on('pageerror', error => errors.push(error.message))
  let unblock, blocked = false
  const gate = new Promise(resolve => { unblock = resolve })
  const directory = resolve('public/pizarra')
  await page.route('https://opening.test/**', async route => {
    const url = new URL(route.request().url()), path = url.pathname
    if (path === '/') return route.fulfill({ contentType: 'text/html', body: '<style>body{margin:0}.fixed{position:fixed;inset:0;display:flex;flex-direction:column}.absolute{position:absolute}iframe{flex:1;min-height:0;width:100%;border:0}</style><div id="root"></div><script type="module" src="/parent.js"></script>' })
    if (path === '/parent.js') return route.fulfill({ contentType: 'text/javascript', body: parentBundle.outputFiles[0].text })
    if (!path.startsWith('/pizarra/') || path.includes('/api/')) return route.fulfill({ status: 404, body: '{}' })
    const file = resolve(directory, '.' + (path === '/pizarra/' ? '/index.html' : path.slice('/pizarra'.length)))
    assert.ok(file.startsWith(directory + sep))
    if (/\/assets\/index-.*\.js$/.test(path)) { blocked = true; await gate }
    try { return await route.fulfill({ body: await readFile(file), contentType: ({ '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2' })[extname(file)] ?? 'application/octet-stream' }) }
    catch { return route.fulfill({ status: 404, body: '' }) }
  })
  await page.goto('https://opening.test/', { waitUntil: 'domcontentloaded' })
  await expect.poll(() => blocked).toBe(true)
  const frame = page.locator('iframe'), child = page.frameLocator('iframe')
  const expected = { light: 'rgb(255, 255, 255)', dark: 'rgb(23, 27, 36)', rest: 'rgb(238, 229, 211)' }[theme]
  await expect(frame).toHaveCSS('visibility', 'hidden')
  await expect(page.getByRole('dialog')).toHaveCSS('background-color', expected)
  await expect(child.locator('html')).toHaveCSS('background-color', expected)
  const before = await frame.evaluate(element => ({ width: element.clientWidth, height: element.clientHeight }))
  unblock()
  if(fail) {
    await expect(page.getByRole('alert')).toHaveText('Opening storage failure')
    await expect(frame).toHaveCSS('visibility','hidden')
    await page.getByRole('button',{name:'Volver a Temas'}).click()
    assert.equal(await page.evaluate(()=>window.closedBoard),true)
    return
  }
  await expect(frame).toHaveCSS('visibility', 'visible')
  await expect(child.locator('.app')).toHaveAttribute('data-theme', theme)
  assert.deepEqual(await frame.evaluate(element => ({ width: element.clientWidth, height: element.clientHeight })), before)
  const samples = await page.evaluate(() => window.readySamples)
  assert.equal(samples.length, 1)
  assert.ok(samples[0].pixel[0] > samples[0].pixel[1] + 40 && samples[0].pixel[3] > 0, 'ready must include the restored red stroke, with theme contrast applied')
  const resets = await child.locator('body').evaluate(() => window.canvasResets)
  await child.locator('body').evaluate(async () => { window.dispatchEvent(new Event('resize')); await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))) })
  assert.equal(await child.locator('body').evaluate(() => window.canvasResets), resets, 'unchanged viewport must not reset canvas buffers')
  assert.deepEqual(errors, [])
})
