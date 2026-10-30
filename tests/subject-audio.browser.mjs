import test from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { chromium } from '@playwright/test'
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { resolve, extname } from 'node:path'
import { installAudioWorkspace } from './helpers/audio-workspace.mjs'

const bundle = build({
  stdin: { contents: `
    import React, { useState } from 'react'; import { createRoot } from 'react-dom/client';
    import { SubjectVoiceDialog } from './components/subject-voice-dialog';
    import { setReadyWorkspaceHandle } from './lib/local-workspace-client';
    import * as storage from './lib/subject-audio-storage';
    setReadyWorkspaceHandle(window.workspaceRoot); window.storage = storage;
    function App() { const [open,setOpen] = useState(true); return <><button onClick={()=>setOpen(true)}>Abrir esfera</button><SubjectVoiceDialog subject={open?{id:'algebra',name:'Álgebra'}:null} onClose={()=>setOpen(false)} /></> }
    createRoot(document.getElementById('root')).render(<App />);
  `, resolveDir: process.cwd(), loader: 'tsx' }, bundle: true, write: false, platform: 'browser', format: 'iife', jsx: 'automatic',
  define: { 'process.env.NODE_ENV': '"production"' },
  plugins: [{ name: 'no-pdfs', setup(builder) {
    builder.onLoad({ filter: /local-workspace-data\.ts$/ }, () => ({ loader: 'ts', contents: `
      export async function listLocalSubjectMaterialContainers(){return []}; export async function listLocalSubjectWeekNumbersWithContent(){return []};
      export async function listLocalSubjectDayMaterials(){return []}; export async function getWorkspaceFile(){throw Error('No PDF')};
    ` }))
  } }],
})

async function setup(t) {
  const js = (await bundle).outputFiles[0].text
  const types = { '.js': 'text/javascript', '.mjs': 'text/javascript', '.html': 'text/html', '.css': 'text/css', '.wasm': 'application/wasm' }
  const server = createServer(async (request, response) => {
    const pathname = new URL(request.url, 'http://localhost').pathname
    if (pathname === '/') { response.end('<div id="root"></div><script src="/bundle.js"></script>'); return }
    if (pathname === '/bundle.js') { response.setHeader('Content-Type', 'text/javascript'); response.end(js); return }
    try { response.setHeader('Content-Type', types[extname(pathname)] || 'application/octet-stream'); response.end(await readFile(resolve('public', '.' + pathname))) }
    catch { response.statusCode = 404; response.end() }
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const browser = await chromium.launch({ headless: true }); t.after(async () => { await browser.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)) })
  const page = await browser.newPage({ viewport: { width: 1200, height: 850 } })
  page.on('pageerror', error => console.error('Browser error:', error.message))
  t.after(async () => { if (!t.passed && !page.isClosed()) console.error(await page.locator('body').innerText()) })
  await page.addInitScript(installAudioWorkspace)
  await page.addInitScript(() => {
    window.recognitions = []
    window.SpeechRecognition = class {
      constructor() { window.recognitions.push(this) }
      start() { this.onstart?.() }
      stop() { setTimeout(() => { if (this.finalOnStop) this.onresult?.({resultIndex:0,results:[{isFinal:true,0:{transcript:this.finalOnStop}}]}); this.onend?.() },25) }
      abort() { this.onend?.() }
    }
    window.micRequests = 0
    navigator.mediaDevices.getUserMedia = async () => { window.micRequests++; throw Error('No microphone in test') }
  })
  await page.goto(`http://127.0.0.1:${server.address().port}`)
  await page.getByText('Pulsá + para grabar o importar un audio', { exact: true }).waitFor()
  return page
}
async function loadTone(page) {
  const frame = page.frameLocator('iframe[title="AudioMass"]')
  await frame.locator('#app .pk_hdr').waitFor()
  await page.frames().find(frame => frame.url().includes('/audiomass/')).evaluate(async () => {
    const editor = window.PKAudioEditor, context = editor.engine.wavesurfer.backend.ac
    const audio = context.createBuffer(1, 16000, 16000)
    const samples = audio.getChannelData(0)
    for(let i=0;i<samples.length;i++) samples[i]=Math.sin(i*2*Math.PI*440/16000)*.1
    editor.engine.wavesurfer.loadDecodedBuffer(audio)
    editor.engine.is_ready = true
    editor.fireEvent('DidLoadFile')
  })
}
test('lazy light AudioMass, imported WAV saved without live transcript and reload', async t => {
  const page = await setup(t)
  assert.equal(await page.locator('iframe').count(), 0)
  assert.equal(await page.evaluate(() => window.micRequests), 0)
  assert.equal(await page.evaluate(() => window.recognitions.length), 0)
  await page.keyboard.press('+')
  await page.getByRole('region', { name: 'Editor AudioMass' }).waitFor()
  await loadTone(page)
  const background = await page.frames().find(frame => frame.url().includes('/audiomass/')).evaluate(() => getComputedStyle(document.body).backgroundColor)
  assert.equal(background, 'rgb(255, 255, 255)')
  await page.getByLabel('Nombre del audio').fill('Matrices')
  await page.getByRole('button', { name: 'Confirmar audio', exact: true }).click()
  await page.getByText('Sin transcripción en vivo', { exact: true }).waitFor()
  const saved = await page.evaluate(async () => window.storage.loadAudioWorkspace('algebra'))
  assert.equal(saved.audios[0].name, 'Matrices'); assert.equal(saved.audios[0].parentId, null)
  assert.equal(saved.audios[0].transcript, ''); assert.equal(saved.audios[0].transcription, 'none')
  const header = await page.evaluate(async () => Array.from(new Uint8Array(await (await window.storage.readStudyAudio('algebra', (await window.storage.loadAudioWorkspace('algebra')).audios[0].id)).arrayBuffer()).slice(0, 12)))
  assert.equal(Buffer.from(header.slice(0,4)).toString(), 'RIFF')
  await page.reload(); await page.getByText('Matrices', { exact: true }).waitFor()
  assert.equal(await page.locator('audio[controls]').count(), 1)
  assert.equal(await page.evaluate(() => window.micRequests), 0)
})
test('empty export, failed save keeps editor, dirty cancel can be rejected and retried', async t => {
  const page = await setup(t)
  await page.getByRole('button', { name: 'Nuevo audio', exact: true }).click()
  await page.getByLabel('Nombre del audio').fill('Prueba')
  await page.getByRole('button', { name: 'Confirmar audio', exact: true }).click()
  await page.getByRole('alert').filter({ hasText: 'Grabá o importá' }).waitFor()
  await loadTone(page)
  await page.evaluate(() => { window.failWorkspaceWrites = true })
  await page.getByRole('button', { name: 'Confirmar audio', exact: true }).click()
  await page.getByRole('alert').filter({ hasText: 'Disco lleno' }).waitFor()
  page.once('dialog', dialog => dialog.dismiss())
  await page.getByRole('button', { name: 'Cancelar', exact: true }).click()
  assert.equal(await page.locator('iframe').count(), 1)
  await page.evaluate(() => { window.failWorkspaceWrites = false })
  await page.getByRole('button', { name: 'Confirmar audio', exact: true }).click()
  await page.getByText('Prueba', { exact: true }).waitFor()
})

async function seedAudios(page, count = 4) {
  await page.evaluate(async count => {
    // A small, valid silent WAV; exercises the same storage path as AudioMass.
    const bytes = new ArrayBuffer(44 + 3200), view = new DataView(bytes)
    const str = (offset,text) => [...text].forEach((char,i)=>view.setUint8(offset+i,char.charCodeAt(0)))
    str(0,'RIFF'); view.setUint32(4,bytes.byteLength-8,true); str(8,'WAVE'); str(12,'fmt '); view.setUint32(16,16,true)
    view.setUint16(20,1,true); view.setUint16(22,1,true); view.setUint32(24,16000,true); view.setUint32(28,32000,true)
    view.setUint16(32,2,true); view.setUint16(34,16,true); str(36,'data'); view.setUint32(40,3200,true)
    for(let i=0;i<count;i++) await window.storage.saveStudyAudio('algebra',String(i),`Audio ${i}`,null,new Blob([bytes],{type:'audio/wav'}),.1)
  }, count)
}
test('drag pairs, cancel grouping, nested folders, parent drop and saving inside a folder', async t => {
  const page = await setup(t)
  await seedAudios(page)
  const card = name => page.locator('[data-subject-audios] [draggable="true"]').filter({ has: page.getByText(name, { exact: true }) })
  await card('Audio 0').getByText('Audio 0',{exact:true}).dragTo(card('Audio 1').getByText('Audio 1',{exact:true}))
  await page.getByRole('button', { name: 'Cancelar', exact: true }).click()
  assert.equal((await page.evaluate(() => window.storage.loadAudioWorkspace('algebra'))).folders.length, 0)
  await card('Audio 0').getByText('Audio 0',{exact:true}).dragTo(card('Audio 1').getByText('Audio 1',{exact:true}))
  await page.getByLabel('Nombre del conjunto').fill('Matrices')
  await page.getByRole('button', { name: 'Crear conjunto', exact: true }).click()
  const matrices = page.getByRole('button', { name: 'Abrir conjunto Matrices', exact: true })
  await card('Audio 2').getByText('Audio 2',{exact:true}).dragTo(matrices)
  await page.waitForFunction(async () => (await window.storage.loadAudioWorkspace('algebra')).audios.filter(a => a.parentId !== null).length === 3)
  await page.evaluate(() => window.storage.updateAudioWorkspace('algebra',w => { w.folders.push({id:'outer',name:'Álgebra completa',parentId:null}) }))
  await matrices.dragTo(page.getByRole('button', { name: 'Abrir conjunto Álgebra completa', exact: true }))
  await page.getByRole('button', { name: 'Abrir conjunto Álgebra completa', exact: true }).click()
  await matrices.waitFor()
  await matrices.dragTo(page.getByRole('button', { name: '← Nivel superior', exact: true }))
  await page.getByRole('button', { name: '← Nivel superior', exact: true }).click()
  await matrices.click()
  await card('Audio 0').waitFor()
  await page.getByRole('button', { name: 'Nuevo audio', exact: true }).click()
  await loadTone(page); await page.getByLabel('Nombre del audio').fill('Dentro del conjunto')
  await page.getByRole('button', { name: 'Confirmar audio', exact: true }).click()
  await page.getByText('Dentro del conjunto', { exact: true }).waitFor()
  const w = await page.evaluate(() => window.storage.loadAudioWorkspace('algebra'))
  assert.equal(w.audios.find(a=>a.name==='Dentro del conjunto').parentId,w.folders.find(f=>f.name==='Matrices').id)
})
test('new recording can be confirmed directly from the recording modal', async t => {
  const page = await setup(t)
  await page.keyboard.press('+')
  const frame = page.frameLocator('iframe[title="AudioMass"]')
  await frame.locator('#app .pk_hdr').waitFor()
  await page.frames().find(frame=>frame.url().includes('/audiomass/')).evaluate(() => {
    navigator.mediaDevices.enumerateDevices = async () => [{kind:'audioinput',deviceId:'test',label:'Test microphone'}]
    navigator.mediaDevices.getUserMedia = async () => {
      const context = new AudioContext(), oscillator = context.createOscillator(), destination = context.createMediaStreamDestination()
      oscillator.connect(destination); oscillator.start(); await context.resume()
      return destination.stream
    }
    window.PKAudioEditor.fireEvent('RequestActionNewRec')
  })
  await frame.getByText('START RECORDING',{exact:true}).click()
  await frame.getByText('FINISH RECORDING',{exact:true}).waitFor()
  await page.frames().find(frame=>frame.url().includes('/audiomass/')).evaluate(() => {
    const recognition = window.recognitions.at(-1)
    if (!recognition) throw Error('Live dictation did not start with recording')
    recognition.onresult({resultIndex:0,results:[{isFinal:false,0:{transcript:'Una matriz'}}]})
    recognition.finalOnStop = 'Una matriz tiene filas y columnas.'
  })
  // Wait for actual microphone samples rather than a timer-based synthetic buffer.
  await page.waitForFunction(() => {
    const doc = document.querySelector('iframe').contentDocument
    return parseFloat(doc.querySelector('.pk_rec .pk_row:nth-child(2) span')?.textContent || '0') > .5
  })
  await page.getByLabel('Nombre del audio').fill('Grabación nueva')
  await page.getByRole('button',{name:'Confirmar audio',exact:true}).click()
  await page.getByText('Grabación nueva',{exact:true}).waitFor({timeout:6000}).catch(async error => { console.error('Host:',await page.locator('body').innerText()); console.error('Frame:',await frame.locator('body').innerText()); throw error })
  const w = await page.evaluate(()=>window.storage.loadAudioWorkspace('algebra'))
  assert.ok(w.audios[0].duration > .1)
  assert.equal(w.audios[0].transcript,'Una matriz tiene filas y columnas.')
  assert.equal(w.audios[0].transcription,'completed')
})

test('browser dictation restarts, pauses and preserves text without duplicated interim results', async t => {
  const page = await setup(t)
  await page.keyboard.press('+'); await loadTone(page)
  const frame = page.frames().find(frame=>frame.url().includes('/audiomass/'))
  await frame.evaluate(() => {
    const app = window.PKAudioEditor
    app.fireEvent('CursadoRecordingStart',true)
    const recognition=window.recognitions.at(-1)
    recognition.onresult({resultIndex:0,results:[{isFinal:false,0:{transcript:'Una'}}]})
    recognition.onresult({resultIndex:0,results:[{isFinal:true,0:{transcript:'Una matriz.'}}]})
    recognition.onend()
  })
  await frame.waitForFunction(()=>window.recognitions.length===2)
  await frame.evaluate(() => {
    window.recognitions.at(-1).onresult({resultIndex:0,results:[{isFinal:true,0:{transcript:'Tiene filas.'}}]})
    window.PKAudioEditor.fireEvent('CursadoRecordingStop')
  })
  await frame.waitForFunction(()=>window.recognitions.length===2)
  // A paused recognizer has ended before the user resumes the microphone.
  await frame.evaluate(()=>new Promise(resolve=>setTimeout(resolve,40)))
  await frame.evaluate(()=>window.PKAudioEditor.fireEvent('CursadoRecordingStart',false))
  await frame.waitForFunction(()=>window.recognitions.length===3)
  await frame.evaluate(()=>window.recognitions.at(-1).onresult({resultIndex:0,results:[{isFinal:true,0:{transcript:'Y columnas.'}}]}))
  await page.getByLabel('Nombre del audio').fill('Dictado')
  await page.getByRole('button',{name:'Confirmar audio',exact:true}).click()
  await page.getByText('Transcripción guardada',{exact:true}).waitFor()
  const w=await page.evaluate(()=>window.storage.loadAudioWorkspace('algebra'))
  assert.equal(w.audios[0].transcript,'Una matriz. Tiene filas. Y columnas.')
})

test('recognition errors preserve partial text and never block audio storage', async t => {
  const page=await setup(t)
  await page.keyboard.press('+'); await loadTone(page)
  await page.frames().find(frame=>frame.url().includes('/audiomass/')).evaluate(()=>{
    window.PKAudioEditor.fireEvent('CursadoRecordingStart',true)
    const recognition=window.recognitions.at(-1)
    recognition.onresult({resultIndex:0,results:[{isFinal:true,0:{transcript:'Texto previo.'}}]})
    recognition.onerror({error:'network'}); recognition.onend()
  })
  await page.getByLabel('Nombre del audio').fill('Con texto parcial')
  await page.getByRole('button',{name:'Confirmar audio',exact:true}).click()
  await page.getByText('Transcripción parcial guardada',{exact:true}).waitFor()
  const w=await page.evaluate(()=>window.storage.loadAudioWorkspace('algebra'))
  assert.equal(w.audios[0].transcript,'Texto previo.')
  assert.equal(w.audios[0].transcription,'partial')
})

test('unsupported browser saves audio without loading a model; old transcripts remain intact', async t=>{
  const page=await setup(t)
  const requests=[]; page.on('request',request=>requests.push(request.url()))
  await page.addInitScript(()=>{ delete window.SpeechRecognition; delete window.webkitSpeechRecognition })
  await page.reload(); await page.keyboard.press('+'); await loadTone(page)
  await page.frames().find(frame=>frame.url().includes('/audiomass/')).evaluate(()=>window.PKAudioEditor.fireEvent('CursadoRecordingStart',true))
  await page.getByText('Este navegador no admite transcripción en vivo. El audio se guarda igual.',{exact:true}).waitFor()
  await page.getByLabel('Nombre del audio').fill('Solo audio')
  await page.getByRole('button',{name:'Confirmar audio',exact:true}).click()
  await page.getByText('Dictado no disponible',{exact:true}).waitFor()
  await page.evaluate(()=>window.storage.updateAudioWorkspace('algebra',w=>{w.audios[0].transcript='Texto anterior';w.audios[0].transcription='completed'}))
  await page.reload(); await page.getByText('Transcripción guardada',{exact:true}).waitFor()
  assert.equal((await page.evaluate(()=>window.storage.loadAudioWorkspace('algebra'))).audios[0].transcript,'Texto anterior')
  assert.equal(requests.some(url=>/huggingface|onnx|transcription\/worker|\.wasm/.test(url)),false)
})
