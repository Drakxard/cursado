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

async function setup(t, { nativeMicrophone = false } = {}) {
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
  const browser = await chromium.launch({ headless: true, args: nativeMicrophone ? ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] : [] }); t.after(async () => { await browser.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)) })
  const page = await browser.newPage({ viewport: { width: 1366, height: 850 }, permissions: nativeMicrophone ? ['microphone'] : [] })
  page.setDefaultTimeout(10000)
  page.on('pageerror', error => console.error('Browser error:', error.message))
  t.after(async () => { if (!t.passed && !page.isClosed()) console.error(await page.locator('body').innerText()) })
  await page.addInitScript(installAudioWorkspace)
  await page.addInitScript(({ nativeMicrophone }) => {
    window.recognitions = []
    window.SpeechRecognition = class {
      constructor() { window.recognitions.push(this) }
      start() { this.onstart?.() }
      stop() { setTimeout(() => { if (this.finalOnStop) this.onresult?.({resultIndex:0,results:[{isFinal:true,0:{transcript:this.finalOnStop}}]}); this.onend?.() },25) }
      abort() { this.onend?.() }
    }
    window.micRequests = 0
    if (!nativeMicrophone) navigator.mediaDevices.getUserMedia = async () => { window.micRequests++; throw Error('No microphone in test') }
  }, { nativeMicrophone })
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
async function requestSave(page) {
  const frame = page.frameLocator('iframe[title="AudioMass"]')
  const recording = frame.locator('.pk_rec')
  if (await recording.count()) await frame.locator('.pk_modal').filter({ has: recording }).getByRole('button', { name: 'Guardar audio', exact: true }).click()
  else await frame.locator('.pk_transport').getByRole('button', { name: 'Guardar audio', exact: true }).click()
  await frame.getByRole('dialog', { name: 'Guardar audio', exact: true }).waitFor()
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
  assert.equal(await page.frameLocator('iframe[title="AudioMass"]').getByLabel('Nombre del audio').count(), 0)
  await requestSave(page)
  await page.frameLocator('iframe[title="AudioMass"]').getByLabel('Nombre del audio').fill('Matrices')
  await page.frameLocator('iframe[title="AudioMass"]').getByLabel('Nombre del audio').press('Enter')
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
  await requestSave(page)
  await page.frameLocator('iframe[title="AudioMass"]').getByLabel('Nombre del audio').fill('Prueba')
  await page.frameLocator('iframe[title="AudioMass"]').getByRole('button', { name: 'Confirmar audio', exact: true }).click()
  await page.frameLocator('iframe[title="AudioMass"]').getByRole('alert').filter({ hasText: 'Grabá o importá' }).waitFor()
  await loadTone(page)
  await page.evaluate(() => { window.failWorkspaceWrites = true })
  await page.frameLocator('iframe[title="AudioMass"]').getByRole('button', { name: 'Confirmar audio', exact: true }).click()
  await page.frameLocator('iframe[title="AudioMass"]').getByRole('alert').filter({ hasText: 'Disco lleno' }).waitFor()
  await page.frameLocator('iframe[title="AudioMass"]').getByRole('button', { name: 'Cancelar', exact: true }).click()
  page.once('dialog', dialog => dialog.dismiss())
  await page.frameLocator('iframe[title="AudioMass"]').getByRole('button', { name: 'Cerrar editor de audio', exact: true }).click()
  assert.equal(await page.locator('iframe').count(), 1)
  await page.evaluate(() => { window.failWorkspaceWrites = false })
  await requestSave(page)
  await page.frameLocator('iframe[title="AudioMass"]').getByRole('button', { name: 'Confirmar audio', exact: true }).click()
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
  await loadTone(page); await requestSave(page); await page.frameLocator('iframe[title="AudioMass"]').getByLabel('Nombre del audio').fill('Dentro del conjunto')
  await page.frameLocator('iframe[title="AudioMass"]').getByRole('button', { name: 'Confirmar audio', exact: true }).click()
  await page.getByText('Dentro del conjunto', { exact: true }).waitFor()
  const w = await page.evaluate(() => window.storage.loadAudioWorkspace('algebra'))
  assert.equal(w.audios.find(a=>a.name==='Dentro del conjunto').parentId,w.folders.find(f=>f.name==='Matrices').id)
})
test('empty project records from the transport without a recording modal', async t => {
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
  })
  await frame.locator('.pk_transport .icon-rec').click()
  await frame.locator('.pk_transport .icon-rec.pk_act').waitFor()
  assert.equal(await frame.locator('.pk_rec').count(), 0)
  assert.equal(await frame.locator('.pk_modal').count(), 0)
  await page.frames().find(frame=>frame.url().includes('/audiomass/')).evaluate(() => {
    const recognition = window.recognitions.at(-1)
    if (!recognition) throw Error('Live dictation did not start with recording')
    recognition.onresult({resultIndex:0,results:[{isFinal:false,0:{transcript:'Una matriz'}}]})
    recognition.finalOnStop = 'Una matriz tiene filas y columnas.'
  })
  // The real capture node must deliver samples to the editor timeline.
  await page.frames().find(frame=>frame.url().includes('/audiomass/')).waitForFunction(() => {
    const backend = window.PKAudioEditor.engine.wavesurfer.backend
    return backend.extraPeaks?.reduce((sum, chunk) => sum + chunk.length, 0) > backend.ac.sampleRate / 2
  })
  await frame.locator('.pk_transport .icon-rec').click()
  await frame.locator('.pk_transport .icon-rec.pk_act').waitFor({state:'hidden'})
  assert.equal(await frame.locator('.pk_rec').count(), 0)
  await requestSave(page)
  await page.frameLocator('iframe[title="AudioMass"]').getByLabel('Nombre del audio').fill('Grabación nueva')
  await page.frameLocator('iframe[title="AudioMass"]').getByRole('button',{name:'Confirmar audio',exact:true}).click()
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
  await requestSave(page)
  await page.frameLocator('iframe[title="AudioMass"]').getByLabel('Nombre del audio').fill('Dictado')
  await page.frameLocator('iframe[title="AudioMass"]').getByRole('button',{name:'Confirmar audio',exact:true}).click()
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
  await requestSave(page)
  await page.frameLocator('iframe[title="AudioMass"]').getByLabel('Nombre del audio').fill('Con texto parcial')
  await page.frameLocator('iframe[title="AudioMass"]').getByRole('button',{name:'Confirmar audio',exact:true}).click()
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
  await requestSave(page)
  await page.frameLocator('iframe[title="AudioMass"]').getByText('Este navegador no admite transcripción en vivo. El audio se guarda igual.',{exact:true}).waitFor()
  await page.frameLocator('iframe[title="AudioMass"]').getByLabel('Nombre del audio').fill('Solo audio')
  await page.frameLocator('iframe[title="AudioMass"]').getByRole('button',{name:'Confirmar audio',exact:true}).click()
  await page.getByText('Dictado no disponible',{exact:true}).waitFor()
  await page.evaluate(()=>window.storage.updateAudioWorkspace('algebra',w=>{w.audios[0].transcript='Texto anterior';w.audios[0].transcription='completed'}))
  await page.reload(); await page.getByText('Transcripción guardada',{exact:true}).waitFor()
  assert.equal((await page.evaluate(()=>window.storage.loadAudioWorkspace('algebra'))).audios[0].transcript,'Texto anterior')
  assert.equal(requests.some(url=>/huggingface|onnx|transcription\/worker|\.wasm/.test(url)),false)
})


test('microphone failure allows retry and New Recording uses the timeline', async t => {
  const page = await setup(t)
  await page.keyboard.press('+')
  const frame = page.frameLocator('iframe[title="AudioMass"]')
  await frame.locator('.pk_transport .icon-rec').click()
  await frame.getByText('No microphone in test', {exact:true}).waitFor()
  await frame.locator('.pk_modal_cancel').click()
  assert.equal(await frame.locator('.pk_transport .icon-rec').isEnabled(), true)
  const editor = page.frames().find(frame=>frame.url().includes('/audiomass/'))
  await editor.evaluate(() => {
    navigator.mediaDevices.getUserMedia = async () => {
      const context = new AudioContext(), source = context.createOscillator(), destination = context.createMediaStreamDestination()
      source.connect(destination); source.start(); await context.resume()
      return destination.stream
    }
    window.PKAudioEditor.fireEvent('RequestActionNewRec')
  })
  await frame.locator('.pk_transport .icon-rec.pk_act').waitFor()
  assert.equal(await frame.locator('.pk_modal').count(), 0)
  await editor.waitForFunction(() => {
    const backend = window.PKAudioEditor.engine.wavesurfer.backend
    return backend.extraPeaks?.reduce((sum, chunk) => sum + chunk.length, 0) > backend.ac.sampleRate / 2
  })
  await frame.locator('.pk_transport .icon-rec').click()
  await frame.locator('.pk_transport .icon-rec.pk_act').waitFor({state:'hidden'})
  assert.ok(await editor.evaluate(() => window.PKAudioEditor.engine.wavesurfer.backend.buffer.duration) > .1)
})


test('live waveform uses the captured duration instead of the one-sample empty buffer', {timeout:30000}, async t => {
  const page = await setup(t)
  await page.keyboard.press('+'); await loadTone(page)
  const editor = page.frames().find(frame=>frame.url().includes('/audiomass/'))
  const result = await editor.evaluate(() => {
    const wave = window.PKAudioEditor.engine.wavesurfer, backend = wave.backend
    const context = backend.ac
    wave.loadDecodedBuffer(context.createBuffer(1, 1, context.sampleRate))
    const getPeaks = backend.getPeaks
    // Abort before the old renderer can loop through hundreds of millions of offscreen pixels.
    backend.getPeaks = function (...args) {
      if (this.extraPeaks) {
        const samples = this.extraPeaks.reduce((sum, chunk) => sum + chunk.length, 0)
        if (this.getDuration() * this.buffer.sampleRate < this.extraOffset + samples)
          throw Error('Live timeline is shorter than its captured samples; rendering would freeze')
      }
      return getPeaks.apply(this, args)
    }
    const samples = new Float32Array(context.sampleRate * 12)
    for (let i=0;i<samples.length;i++) samples[i]=Math.sin(i * .1) * .2
    const start = performance.now()
    wave.DrawTemp(0, [samples])
    const duration = wave.getDuration(), end = backend.extraPeakEnd, width = wave.drawer.getWidth()
    const elapsed = performance.now() - start
    wave.DrawTemp(null)
    return {duration, end, width, elapsed, cleared: !backend.extraPeaks, restoredDuration: wave.getDuration()}
  })
  assert.ok(result.duration >= 12)
  assert.ok(result.end <= result.width, JSON.stringify(result))
  assert.ok(result.elapsed < 500, JSON.stringify(result))
  assert.equal(result.cleared, true)
  assert.ok(result.restoredDuration < .001)
})


test('native microphone keeps a full-size editor responsive during sustained recording', {timeout:45000}, async t => {
  const page = await setup(t, { nativeMicrophone: true })
  await page.keyboard.press('+')
  const frame = page.frameLocator('iframe[title="AudioMass"]')
  await frame.locator('.pk_transport .icon-rec').waitFor()
  // The isolated React harness does not load Tailwind; match the deployed iframe dimensions.
  await page.locator('iframe').evaluate(el => { el.style.width = '1320px'; el.style.height = '700px' })
  const editor = page.frames().find(frame=>frame.url().includes('/audiomass/'))
  await editor.evaluate(() => {
    window.recordingTimes = []
    window.PKAudioEditor.listenFor('DidAudioProcess', value => window.recordingTimes.push(value[0]))
    window.heartbeat = 0
    window.heartbeatTimer = setInterval(() => window.heartbeat++, 100)
  })
  await frame.locator('.pk_transport .icon-rec').click()
  await frame.locator('.pk_transport .icon-rec.pk_act').waitFor()
  await editor.waitForFunction(() => window.recordingTimes.at(-1) >= 8, null, {timeout:15000})
  const live = await editor.evaluate(() => ({ticks: window.heartbeat, time: window.recordingTimes.at(-1),
    end: window.PKAudioEditor.engine.wavesurfer.backend.extraPeakEnd,
    width: window.PKAudioEditor.engine.wavesurfer.drawer.getWidth()}))
  assert.ok(live.ticks >= 40, JSON.stringify(live))
  assert.ok(live.end <= live.width, JSON.stringify(live))
  const start = Date.now()
  await frame.locator('.pk_transport .icon-rec').click()
  await frame.locator('.pk_transport .icon-rec.pk_act').waitFor({state:'hidden'})
  assert.ok(Date.now() - start < 3000, 'Stop must respond without freezing the page')
  await requestSave(page)
  await frame.getByLabel('Nombre del audio').fill('Grabacion sostenida')
  await frame.getByRole('button', {name:'Confirmar audio',exact:true}).click()
  await page.getByText('Grabacion sostenida',{exact:true}).waitFor()
  const audio = await page.evaluate(async () => (await window.storage.loadAudioWorkspace('algebra')).audios[0])
  assert.ok(audio.duration >= 7.5 && audio.duration < 15, JSON.stringify(audio))
})


test('dragged audio selection stays visible on the light waveform', async t => {
  const page = await setup(t)
  await page.keyboard.press('+')
  await page.locator('iframe').waitFor()
  await page.locator('iframe').evaluate(el => { el.style.width = '1320px'; el.style.height = '700px' })
  await loadTone(page)
  const editor = page.frames().find(frame=>frame.url().includes('/audiomass/'))
  await editor.waitForFunction(() => {
    const box = window.PKAudioEditor.engine.wavesurfer.drawer.wrapper.getBoundingClientRect()
    return box.width > 1000 && box.height > 100 && box.bottom <= innerHeight
  })
  // Playwright returns top-level coordinates for elements inside an iframe.
  const waveform = page.frameLocator('iframe[title="AudioMass"]').locator('wave').first()
  await waveform.scrollIntoViewIfNeeded()
  const box = await waveform.boundingBox()
  const y = box.y + Math.min(100, box.height / 2)
  await page.mouse.move(box.x + box.width * .2, y)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width * .6, y, {steps:12})
  await page.mouse.up()
  const region = page.frameLocator('iframe[title="AudioMass"]').locator('region.wavesurfer-region')
  await region.waitFor()
  const selection = await region.evaluate(el => {
    const style = getComputedStyle(el), handle = getComputedStyle(el.querySelector('.wavesurfer-handle'))
    const range = window.PKAudioEditor.engine.wavesurfer.regions.list[0]
    return {blend:style.mixBlendMode,background:style.backgroundColor,shadow:style.boxShadow,
      handle:handle.backgroundColor,start:range.start,end:range.end,width:el.getBoundingClientRect().width}
  })
  assert.equal(selection.blend,'normal')
  assert.equal(selection.background,'rgba(37, 99, 235, 0.24)')
  assert.match(selection.shadow,/29, 78, 216/)
  assert.equal(selection.handle,'rgb(29, 78, 216)')
  assert.ok(selection.start > 0 && selection.end > selection.start && selection.width > 50, JSON.stringify(selection))
})
