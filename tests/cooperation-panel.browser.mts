import assert from 'node:assert/strict'
import test from 'node:test'
import { build } from 'esbuild'
import { chromium } from '@playwright/test'

test('cooperative UI accepts username lists, keeps declined spheres gray and offers deletion review and personal copies', async () => {
  const fixture = `
    const sphere={id:'sphere-1',group_id:'group-1',name:'Álgebra',color:'#2563eb',created_by:'a',bytes:2500000};
    const state={version:1,userId:'b',groups:[{id:'group-1',accepted:false,members:[{id:'a',display_name:'PersonaA'},{id:'b',display_name:'PersonaB'}],spheres:[sphere]}],mirrors:{},deletions:[]};
    const changed=()=>dispatchEvent(new Event('cursado-cooperation-changed'));
    export const cooperationState=()=>state;
    export const refreshCooperation=async()=>state;
    export const createCooperationGroup=async names=>{window.createdNames=names;return 'group-1'};
    export const dismissCooperationSphere=async id=>{state.dismissedSpheres=[id];changed()};
    export const notifyCooperationDeletion=async id=>{state.deletions.find(d=>d.id===id).notified=true;changed()};
    export const decideCooperationDeletion=async(id,decision)=>{state.deletions.find(d=>d.id===id).decision=decision;changed()};
    export const acceptCooperationSphere=async()=>{window.downloads=(window.downloads||0)+1;state.mirrors[sphere.id]={binding:{id:sphere.id,subjectId:'coop-subject',groupId:'group-1'},baseline:{conflicts:[]}};changed()};
    export const startCooperationBackground=()=>{queueMicrotask(changed);return ()=>{}};
    window.prepareDeletion=()=>{state.deletions.push({id:'delete-1',sphereId:sphere.id,key:'sphere.json',selector:[],label:'Álgebra',decision:'wait'});changed()};
  `
  const bundled = await build({ stdin: { contents: `import React from 'react';import {createRoot} from 'react-dom/client';import {CooperationPanel,CooperationRuntime} from './components/cooperation';createRoot(document.getElementById('root')).render(<><CooperationRuntime/><CooperationPanel onOpen={id=>window.openedSubject=id}/></>)`, resolveDir: process.cwd(), loader: 'tsx' }, bundle: true, write: false, platform: 'browser', format: 'iife', define: { 'process.env.NODE_ENV': '"production"' }, plugins: [{ name: 'cooperation-ui', setup(builder) {
    builder.onResolve({ filter: /^@\/lib\/client\/cooperation$/ }, () => ({ path: 'cooperation', namespace: 'fixture' }))
    builder.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: fixture }))
  } }] })
  const browser = await chromium.launch({ headless: true, ...(process.env.CI ? {} : { channel: 'chrome' }) })
  try {
    const page = await browser.newPage()
    await page.route('https://cooperation.test/**', route => route.fulfill({ contentType: 'text/html', body: '<div id="root"></div>' }))
    await page.goto('https://cooperation.test/')
    await page.addScriptTag({ content: bundled.outputFiles[0].text })
    const invitation = page.getByRole('dialog', { name: 'Nuevo contenido cooperativo' })
    await invitation.getByText(/2,5 MB/).waitFor()
    await invitation.getByRole('button', { name: 'Cancelar' }).click()
    assert.equal(await page.evaluate(() => (window as any).downloads || 0), 0)
    const sphere = page.getByRole('button', { name: 'Álgebra', exact: true })
    assert.match(await sphere.getAttribute('class'), /grayscale/)
    assert.equal(await page.locator('input[type=password]').count(), 0)
    await page.getByLabel('Nombre de usuario').fill('[PersonaA, PersonaC]')
    await page.getByRole('button', { name: 'Cooperar', exact: true }).click()
    assert.equal(await page.evaluate(() => (window as any).createdNames), '[PersonaA, PersonaC]')
    await sphere.click()
    await page.getByRole('dialog', { name: 'Nuevo contenido cooperativo' }).getByRole('button', { name: 'Confirmar' }).click()
    await page.getByText('Pendiente', { exact: false }).waitFor({ state: 'hidden' })
    assert.doesNotMatch(await sphere.getAttribute('class'), /grayscale/)
    await sphere.click()
    assert.equal(await page.evaluate(() => (window as any).openedSubject), 'coop-subject')
    await page.evaluate(() => (window as any).prepareDeletion())
    const deletion = page.getByRole('dialog', { name: 'Elemento eliminado' })
    await deletion.getByRole('button', { name: 'Esperar' }).click()
    assert.match(await sphere.getAttribute('class'), /grayscale/)
    await sphere.click()
    await deletion.getByRole('button', { name: 'Ver', exact: true }).waitFor()
    await deletion.getByRole('button', { name: 'Guardar', exact: true }).click()
    await page.getByText('Personal', { exact: true }).waitFor()
    assert.doesNotMatch(await sphere.getAttribute('class'), /grayscale/)
  } finally { await browser.close() }
})
