import assert from 'node:assert/strict'
import test from 'node:test'
import { build } from 'esbuild'
import { chromium } from '@playwright/test'

test('cooperative UI keeps invitations separate and resolves named deletions inline without dialogs', async () => {
  const fixture = `
    const sphere={id:'sphere-1',group_id:'group-1',name:'Álgebra',color:'#2563eb',created_by:'a',bytes:2500000,ready:false};
    const state={version:1,userId:'b',groups:[{id:'group-1',accepted:false,members:[{id:'a',display_name:'PersonaA'},{id:'b',display_name:'PersonaB'}],spheres:[sphere]},{id:'empty-group',accepted:false,members:[{id:'c',display_name:'PersonaC'}],spheres:[]}],mirrors:{},deletions:[]};
    const changed=()=>dispatchEvent(new Event('cursado-cooperation-changed'));
    window.publishSphere=()=>{sphere.ready=true;changed()};
    window.resetInvitation=()=>{state.mirrors={};state.deletions=[];state.dismissedSpheres=[];changed()};
    export const cooperationState=()=>state;
    export const cooperationUndoStatus=()=>window.undoStage;
    window.setUndoStage=stage=>{window.undoStage=stage;changed()};
    export const cooperationSubjectSyncLabel=()=> '100%';
    export const cooperationSubjectSyncDetails=async()=>({name:'Álgebra',bytes:2500000});
    export const refreshCooperation=async()=>state;
    export const undoCooperationSphere=async id=>{if(window.failUndo)throw new Error('No se pudo deshacer. Reintentá.');if(window.holdUndo){window.setUndoStage('stopping');await new Promise(resolve=>window.releaseUndo=resolve)}delete state.mirrors[id];for(const group of state.groups)group.spheres=group.spheres.filter(sphere=>sphere.id!==id);state.dismissedSpheres=[id];window.undoneSphere=id;window.undoStage=undefined;changed()};
    window.failPublication=()=>{state.mirrors[sphere.id].binding.owner=true;state.mirrors[sphere.id].error='Unexpected end of JSON input';changed()};
    export const acceptCooperationGroup=async id=>{if(window.failGroupAccept)throw new Error('Sin conexión. Reintentá.');state.groups.find(group=>group.id===id).accepted=true;window.acceptedGroup=id;changed()};
    export const synchronizeCooperation=async()=>{};
    export const createCooperationGroup=async names=>{window.createdNames=names;return 'group-1'};
    export const dismissCooperationSphere=async id=>{state.dismissedSpheres=[id];changed()};
    export const notifyCooperationDeletion=async id=>{state.deletions.find(d=>d.id===id).notified=true;changed()};
    export const decideCooperationDeletion=async(id,decision)=>{if(window.failDecision)throw new Error('Sin conexión. Reintentá.');state.deletions.find(d=>d.id===id).decision=decision;changed()};
    export const acceptCooperationSphere=async(_sphere,options)=>{window.downloadOptions=options;window.downloads=(window.downloads||0)+1;state.mirrors[sphere.id]={binding:{id:sphere.id,name:sphere.name,subjectId:'coop-subject',groupId:'group-1'},baseline:{conflicts:[]},downloading:true,metadataReady:true,transfer:{phase:'downloading',completed:0,total:2}};changed()};
    export const startCooperationBackground=()=>{queueMicrotask(changed);return ()=>{}};
    window.prepareDeletion=()=>{state.deletions.push({id:'delete-1',sphereId:sphere.id,key:'sphere.json',selector:[],label:'Álgebra',decision:'wait'});changed()};
    window.preparePdfDeletion=()=>{state.deletions.push({id:'delete-pdf',sphereId:sphere.id,key:'manifests/materials/algebra/week-1.json',selector:['materials','@1'],label:'Elemento',value:{id:1,file_name:'Práctica 3.pdf'},decision:'wait'});changed()};
  `
  const bundled = await build({ stdin: { contents: `import React from 'react';import {createRoot} from 'react-dom/client';import {CooperationPanel,CooperationRuntime,CooperationSyncStatus} from './components/cooperation';function App(){const [visible,setVisible]=React.useState(true);window.showCooperationPanel=setVisible;return <><CooperationSyncStatus subjectId="coop-subject"/><CooperationRuntime/>{visible&&<CooperationPanel onOpen={id=>window.openedSubject=id}/>}</>};createRoot(document.getElementById('root')).render(<App/>)`, resolveDir: process.cwd(), loader: 'tsx' }, bundle: true, write: false, platform: 'browser', format: 'iife', define: { 'process.env.NODE_ENV': '"production"' }, plugins: [{ name: 'cooperation-ui', setup(builder) {
    builder.onResolve({ filter: /^@\/lib\/client\/cooperation$/ }, () => ({ path: 'cooperation', namespace: 'fixture' }))
    builder.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: fixture }))
  } }] })
  const browser = await chromium.launch({ headless: true, ...(process.env.CI ? {} : { channel: 'chrome' }) })
  try {
    const page = await browser.newPage()
    await page.route('https://cooperation.test/**', route => route.fulfill({ contentType: 'text/html', body: '<div id="root"></div>' }))
    await page.goto('https://cooperation.test/estudio')
    await page.addScriptTag({ content: bundled.outputFiles[0].text })
    assert.equal(await page.getByLabel(/^Sincronización (?:100%|sin confirmar)$/).count(), 0)
    const invitation = page.getByRole('dialog', { name: 'Nuevo contenido cooperativo' })
    const emptyGroup = page.locator('[data-cooperation-group="empty-group"]')
    await emptyGroup.getByRole('button', { name: 'Aceptar invitación', exact: true }).waitFor()
    await page.evaluate(() => (window as any).failGroupAccept=true)
    await emptyGroup.getByRole('button', { name: 'Aceptar invitación', exact: true }).click()
    await emptyGroup.getByRole('alert').getByText('Sin conexión. Reintentá.', { exact: true }).waitFor()
    await page.evaluate(() => (window as any).failGroupAccept=false)
    await emptyGroup.getByRole('button', { name: 'Aceptar invitación', exact: true }).click()
    await emptyGroup.getByRole('button', { name: 'Aceptar invitación', exact: true }).waitFor({ state: 'detached' })
    assert.equal(await page.evaluate(() => (window as any).acceptedGroup), 'empty-group')
    await emptyGroup.getByText('Este grupo está vacío.', { exact: true }).waitFor()
    assert.equal(await page.evaluate(() => (window as any).downloads || 0), 0)
    const populatedGroup = page.locator('[data-cooperation-group="group-1"]')
    await populatedGroup.getByRole('button', { name: 'Aceptar invitación', exact: true }).click()
    await populatedGroup.getByRole('button', { name: 'Aceptar invitación', exact: true }).waitFor({ state: 'detached' })
    assert.equal(await page.evaluate(() => (window as any).acceptedGroup), 'group-1')
    await page.getByText('Preparando publicación…', { exact: true }).waitFor()
    await page.getByRole('button', { name: 'Álgebra', exact: true }).click()
    assert.equal(await invitation.count(),0)
    await page.evaluate(() => (window as any).publishSphere())
    await invitation.getByRole('heading', { name: 'Álgebra' }).waitFor()
    await invitation.getByRole('button', { name: 'Cerrar invitación' }).click()
    assert.equal(await page.evaluate(() => (window as any).downloads || 0), 0)
    const sphere = page.getByRole('button', { name: 'Álgebra', exact: true })
    assert.match(await sphere.getAttribute('class'), /grayscale/)
    assert.equal(await page.locator('input[type=password]').count(), 0)
    await page.getByLabel('Nombre de usuario').fill('[PersonaA, PersonaC]')
    await page.getByRole('button', { name: 'Cooperar', exact: true }).click()
    assert.equal(await page.evaluate(() => (window as any).createdNames), '[PersonaA, PersonaC]')
    await sphere.click()
    await page.getByRole('dialog', { name: 'Nuevo contenido cooperativo' }).getByRole('button', { name: 'Sincronizar todo' }).click()
    await page.getByText('Pendiente', { exact: false }).waitFor({ state: 'hidden' })
    assert.equal(await page.evaluate(() => (window as any).downloadOptions.background), true)
    await page.getByLabel('Sincronización 100%').waitFor()
    await page.getByLabel('Sincronización 100%').click()
    const syncDetails = page.getByRole('dialog', { name: 'Álgebra', exact: true })
    await syncDetails.getByText('2,5', { exact: false }).waitFor()
    await page.keyboard.press('Escape')
    await syncDetails.waitFor({ state: 'hidden' })
    await page.context().setOffline(true)
    await page.getByLabel('Sincronización sin confirmar').waitFor()
    await page.context().setOffline(false)
    await page.getByLabel('Sincronización 100%').waitFor()
    assert.equal(await page.getByRole('complementary', { name: 'Sincronizaci\u00f3n cooperativa' }).count(), 0)
    assert.doesNotMatch(await sphere.getAttribute('class'), /grayscale/)
    await sphere.click()
    assert.equal(await page.evaluate(() => (window as any).openedSubject), 'coop-subject')
    await page.evaluate(() => { (window as any).showCooperationPanel(false); (window as any).prepareDeletion() })
    const deletion = page.getByRole('dialog', { name: 'Elemento eliminado' })
    await page.getByRole('region', { name: 'Estudio cooperativo' }).waitFor({ state: 'detached' })
    assert.equal(await deletion.count(), 0, 'background deletions do not interrupt other screens')
    assert.equal(await page.evaluate(() => document.querySelector('[aria-modal="true"]')), null)
    await page.evaluate(() => (window as any).showCooperationPanel(true))
    await page.getByText('¿Conservar?', { exact: true }).waitFor()
    assert.doesNotMatch(await sphere.getAttribute('class'), /grayscale/)
    await sphere.click()
    assert.equal(await deletion.count(), 0, 'opening pending content never prompts')
    await page.evaluate(() => (window as any).failDecision=true)
    await page.getByRole('button', { name: 'Conservar Álgebra', exact: true }).click()
    await page.getByRole('alert').getByText('Sin conexión. Reintentá.', { exact: true }).waitFor()
    await page.evaluate(() => (window as any).failDecision=false)
    await page.getByRole('button', { name: 'Conservar Álgebra', exact: true }).click()
    await page.getByText('Personal', { exact: true }).waitFor()
    assert.doesNotMatch(await sphere.getAttribute('class'), /grayscale/)
    await page.evaluate(() => (window as any).preparePdfDeletion())
    await page.getByText('Práctica 3.pdf', { exact: true }).waitFor()
    await page.getByRole('button', { name: 'Descartar copia local de Práctica 3.pdf', exact: true }).click()
    await page.getByText('Práctica 3.pdf', { exact: true }).waitFor({ state: 'detached' })
    assert.equal(await deletion.count(), 0)
    await page.evaluate(() => (window as any).resetInvitation())
    await page.getByRole('dialog', { name: 'Nuevo contenido cooperativo' }).getByRole('button', { name: 'Elegir', exact: true }).click()
    assert.equal(await page.evaluate(() => (window as any).downloadOptions.choose), true)
    assert.equal(await page.evaluate(() => (window as any).downloadOptions.background), undefined)
    await page.evaluate(() => (window as any).failPublication())
    await page.getByText('Unexpected end of JSON input',{exact:false}).first().waitFor()
    assert.equal(await page.getByRole('complementary',{name:'Sincronización cooperativa'}).count(),0)
    await page.evaluate(()=>(window as any).showCooperationPanel(false))
    await page.getByText('Unexpected end of JSON input',{exact:false}).waitFor({state:'detached'})
    assert.equal(await page.getByRole('alert').count(),0)
    await page.evaluate(()=>(window as any).showCooperationPanel(true))
    const failed=page.locator('[data-cooperation-group="group-1"]')
    await failed.getByRole('button',{name:'Deshacer',exact:true}).waitFor()
    await page.evaluate(() => (window as any).failUndo=true)
    await failed.getByRole('button',{name:'Deshacer',exact:true}).click()
    await failed.getByText('No se pudo deshacer. Reintentá.',{exact:true}).waitFor()
    await page.evaluate(() => { (window as any).failUndo=false;(window as any).holdUndo=true })
    await failed.getByRole('button',{name:'Deshacer',exact:true}).click()
    await failed.getByText('Quitando Álgebra…',{exact:true}).waitFor()
    assert.equal(await failed.getByRole('button',{name:'Álgebra',exact:true}).count(),0)
    const undoProgress=failed.getByRole('progressbar',{name:'Deshacer Álgebra'})
    assert.equal(await undoProgress.getAttribute('value'),'0')
    await page.evaluate(()=>(window as any).setUndoStage('remote'))
    await failed.getByText('Cerrando el intento compartido…',{exact:true}).waitFor()
    assert.equal(await undoProgress.getAttribute('value'),'1')
    await page.evaluate(()=>(window as any).setUndoStage('local'))
    await failed.getByText('Conservando tus archivos y quitando la vinculación…',{exact:true}).waitFor()
    assert.equal(await undoProgress.getAttribute('value'),'2')
    await page.evaluate(()=>(window as any).releaseUndo())
    await failed.getByRole('button',{name:'Deshacer',exact:true}).waitFor({state:'detached'})
    assert.equal(await page.evaluate(() => (window as any).undoneSphere),'sphere-1')
  } finally { await browser.close() }
})


test('week picker toggles whole weeks, navigates with angle keys and leaves editable/composing input alone', async () => {
  const fixture = `
    export const toggleCooperationWeek=async(id,week)=>{if(window.failToggle)throw new Error('Sin conexión');window.toggleWeek(week)};
  `
  const bundle = await build({ stdin: { contents: `
    import React,{useState} from 'react';import {createRoot} from 'react-dom/client';import {CooperationWeekSelector} from './components/cooperation-week-selector';
    function App(){const [week,setWeek]=useState(1),[excluded,setExcluded]=useState([1,2]);window.toggleWeek=w=>setExcluded(prev=>prev.includes(w)?prev.filter(v=>v!==w):[...prev,w]);
    return <><CooperationWeekSelector sphereId="sphere-1" weekNumber={week} selection={{choosing:true,excludedWeeks:excluded,weeks:[1,2]}} onNavigate={direction=>setWeek(w=>Math.min(2,Math.max(1,w+direction)))}/><input aria-label="Texto"/><div contentEditable aria-label="Editor"/><button onClick={()=>window.finished=excluded}>Terminar</button></>};
    createRoot(document.getElementById('root')).render(<App/>);
  `, resolveDir: process.cwd(), loader: 'tsx' }, bundle: true, write: false, platform: 'browser', format: 'iife', define: { 'process.env.NODE_ENV': '"production"' }, plugins: [{ name: 'week-picker', setup(builder) {
    builder.onResolve({ filter: /^@\/lib\/client\/cooperation$/ }, () => ({ path: 'cooperation', namespace: 'fixture' }))
    builder.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: fixture }))
  } }] })
  const browser = await chromium.launch({ headless: true, ...(process.env.CI ? {} : { channel: 'chrome' }) })
  try {
    const page = await browser.newPage()
    await page.route('https://cooperation.test/**', route => route.fulfill({ contentType: 'text/html', body: '<div id="root"></div>' }))
    await page.goto('https://cooperation.test/'); await page.addScriptTag({ content: bundle.outputFiles[0].text })
    const toggle = page.getByRole('button', { name: /Sincronizar/ })
    assert.equal(await toggle.getAttribute('aria-pressed'), 'false')
    await toggle.click(); assert.equal(await toggle.getAttribute('aria-pressed'), 'true')
    await page.keyboard.press('>'); await toggle.getByText('Semana 2').waitFor()
    assert.equal(await toggle.getAttribute('aria-pressed'), 'false')
    await page.getByLabel('Texto').focus(); await page.keyboard.press('<'); await toggle.getByText('Semana 2').waitFor()
    await page.getByLabel('Editor').focus(); await page.keyboard.press('<'); await toggle.getByText('Semana 2').waitFor()
    await toggle.focus()
    await page.evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown',{key:'<',isComposing:true})))
    await toggle.getByText('Semana 2').waitFor()
    await page.keyboard.press('<'); await toggle.getByText('Semana 1').waitFor()
    await page.evaluate(() => (window as any).failToggle=true)
    await toggle.click(); await page.getByRole('alert').getByText('Sin conexión').waitFor()
    assert.equal(await toggle.getAttribute('aria-pressed'), 'true')
    await page.getByRole('button',{name:'Terminar'}).click()
    assert.deepEqual(await page.evaluate(() => (window as any).finished), [2])
  } finally { await browser.close() }
})
