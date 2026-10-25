import test from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { chromium, expect } from '@playwright/test'
import { fileURLToPath } from 'node:url'

// Exercise the actual React bridge, with unrelated library/storage UI replaced
// by fixtures. The real PDF renderer has its own memory/lifecycle browser tests.
const fixtures = {
  'next/navigation': `export const useSearchParams=()=>new URLSearchParams(location.search)`,
  './important-progress-view': `export default ()=>null`,
  './subject-wheel-loader': `export const SubjectWheelLoader=()=>null`,
  './local-workspace-provider': `export const EmbeddedWorkspaceProvider=({children})=>children`,
  '@/app/practice/viewer/practice-viewer-client': `import React from 'react';export const PracticeViewerClient=()=>React.createElement('iframe',{src:'/viewer',title:'PDF fixture'})`,
  '@/lib/local-workspace-data': `export const getLocalMaterialById=()=>null`,
  '@/lib/local-workspace-client': `export const setReadyWorkspaceHandle=()=>{};export const loadWorkspaceHandle=()=>null;export const queryWorkspacePermission=()=>null;export const pickWorkspaceRootHandle=()=>null;export const loadServicesFile=()=>null;export const setReadyInscreenConfigToken=()=>{};export const setReadyDriveConfigToken=()=>{}`,
  '@/lib/storage-mode': `export const isLocalStorageMode=()=>false`,
}
const bundle = await build({ stdin: { contents: `import {createRoot} from 'react-dom/client';import {BoardLibraryClient} from './components/board-library-client';createRoot(document.getElementById('root')).render(<BoardLibraryClient authSession={null}/>);`, loader: 'tsx', resolveDir: process.cwd() },
  jsx: 'automatic', bundle: true, write: false, format: 'esm', plugins: [{ name: 'bridge-fixtures', setup(builder) {
    builder.onResolve({ filter: /.*/ }, args => {
      if (Object.hasOwn(fixtures, args.path)) return { path: args.path, namespace: 'fixture' }
      if (args.path === '@/lib/board-library-contract') return { path: fileURLToPath(new URL('../lib/board-library-contract.ts', import.meta.url)) }
    })
    builder.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ contents: fixtures[args.path], resolveDir: process.cwd() }))
  } }] })

test('actual library bridge forwards current visibility, including early hide, and rejects forged messages', async t => {
  const browser = await chromium.launch({ channel: process.env.CI ? undefined : 'chrome' });t.after(()=>browser.close())
  const page = await browser.newPage(), errors=[]
  page.on('pageerror',error=>errors.push(error.message))
  await page.route('https://visibility.test/**',route=>{
    const path=new URL(route.request().url()).pathname
    if(path==='/')return route.fulfill({contentType:'text/html',body:`<iframe id="bridge" src="/bridge?mode=reader&session=test&boardId=board"></iframe><script>
      addEventListener('message',e=>{if(e.origin!==location.origin||e.source!==bridge.contentWindow)return;
        if(e.data.type==='board-library:ready')bridge.contentWindow.postMessage({type:'board-library:init',session:'test',boardId:'board',readerVisible:false,reference:{materialId:1,subjectId:'test',fileName:'test.pdf',workspaceFileId:null}},location.origin)});
      window.change=(visible,session='test')=>bridge.contentWindow.postMessage({type:'board-library:reader-visibility',visible,session,boardId:'board'},location.origin);
    </script>`})
    if(path==='/bridge')return route.fulfill({contentType:'text/html',body:'<div id="root"></div><script type="module" src="/bridge.js"></script>'})
    if(path==='/bridge.js')return route.fulfill({contentType:'text/javascript',body:bundle.outputFiles[0].text})
    if(path==='/viewer')return route.fulfill({contentType:'text/html',body:`<body><script>
      addEventListener('message',e=>{if(e.origin===location.origin&&e.source===parent&&e.data.type==='board-reader:visibility')document.body.dataset.visible=String(e.data.visible)});
      parent.postMessage({type:'board-reader:ready'},location.origin);
    </script></body>`})
    return route.fulfill({status:404,body:''})
  })
  await page.goto('https://visibility.test/')
  const bridge=page.frameLocator('#bridge'), viewer=bridge.frameLocator('iframe')
  await expect(viewer.locator('body')).toHaveAttribute('data-visible','false')
  await page.evaluate(()=>window.change(true))
  await expect(viewer.locator('body')).toHaveAttribute('data-visible','true')
  await page.evaluate(()=>window.change(false,'wrong-session'))
  await bridge.locator('body').evaluate(()=>window.postMessage({type:'board-library:reader-visibility',session:'test',boardId:'board',visible:false},location.origin))
  await viewer.locator('body').evaluate(()=>parent.postMessage({type:'board-library:reader-visibility',session:'test',boardId:'board',visible:false},location.origin))
  // A valid subsequent message orders delivery after the three forged ones.
  await page.evaluate(()=>window.change(true))
  await expect(viewer.locator('body')).toHaveAttribute('data-visible','true')
  await page.evaluate(()=>window.change(false))
  await expect(viewer.locator('body')).toHaveAttribute('data-visible','false')
  assert.deepEqual(errors,[])
})
