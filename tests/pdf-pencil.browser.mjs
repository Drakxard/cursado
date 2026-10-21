import assert from 'node:assert/strict'
import test from 'node:test'
import { build } from 'esbuild'
import { chromium, expect } from '@playwright/test'

const bundle = await build({ stdin: { resolveDir: process.cwd(), loader: 'tsx', contents: `
  import {useState} from 'react';import {createRoot} from 'react-dom/client';
  import {HoldActionButton} from './components/hold-action-button';
  import {InlinePdfName} from './components/inline-pdf-name';
  window.saves=[];window.holds=0;window.drags=0;
  function Fixture(){
    const [name,setName]=useState('Original.PDF'),[editing,setEditing]=useState(false);
    return <div draggable={!editing} onDragStart={()=>window.drags++} style={{padding:40}}>
      {editing?<InlinePdfName name={name} onClose={()=>setEditing(false)} onSave={async value=>{
        window.saves.push({fileName:value});
        if(window.failSave)throw new Error('Disco no disponible');
        await new Promise(resolve=>setTimeout(resolve,20));setName(value);
      }}/>:<><a href="/original.pdf">{name}</a><HoldActionButton onClick={()=>setEditing(true)} onHold={()=>window.holds++}>Lápiz</HoldActionButton></>}
      <button>Fuera del nombre</button>
    </div>
  }
  createRoot(document.getElementById('root')).render(<Fixture/>);
` }, jsx: 'automatic', bundle: true, write: false, format: 'iife' })

async function setup(t) {
  const browser = await chromium.launch({ channel: process.env.CI ? undefined : 'chrome' }); t.after(() => browser.close())
  const page = await browser.newPage()
  await page.route('https://pencil.test/', route => route.fulfill({ contentType: 'text/html', body: '<div id="root"></div>' }))
  await page.goto('https://pencil.test/')
  await page.addScriptTag({ content: bundle.outputFiles[0].text })
  return page
}

test('short click renames inline, Enter and blur save once, Escape cancels and PDF extension survives', async t => {
  const page = await setup(t)
  const pencil = page.getByRole('button', { name: 'Lápiz', exact: true })
  await pencil.click()
  const input = page.getByRole('textbox')
  await expect(input).toBeFocused()
  await input.fill('Cancelado'); await input.press('Escape')
  assert.equal(await page.evaluate(() => window.saves.length), 0)
  await expect(page.getByRole('link')).toHaveText('Original.PDF')
  await pencil.click(); await input.fill('Nuevo'); await input.press('Enter')
  await expect(page.getByRole('link')).toHaveText('Nuevo.PDF')
  assert.deepEqual(await page.evaluate(() => window.saves), [{ fileName: 'Nuevo.PDF' }])
  await pencil.click(); await input.fill('Final.pdf'); await page.getByRole('button', { name: 'Fuera del nombre' }).click()
  await expect(page.getByRole('link')).toHaveText('Final.pdf')
  assert.equal(await page.evaluate(() => window.saves.length), 2)
  assert.equal(await page.evaluate(() => window.holds), 0)
})

test('empty names and failed saves stay editable without replacing the previous name', async t => {
  const page = await setup(t)
  await page.getByRole('button', { name: 'Lápiz', exact: true }).click()
  const input = page.getByRole('textbox')
  await input.fill(' '); await input.press('Enter')
  await expect(page.getByRole('alert')).toHaveText('El nombre no puede estar vacío.')
  assert.equal(await page.evaluate(() => window.saves.length), 0)
  await page.evaluate(() => { window.failSave = true })
  await input.fill('Reintentar.pdf'); await input.press('Enter')
  await expect(page.getByRole('alert')).toHaveText('Disco no disponible')
  await expect(input).toHaveValue('Reintentar.pdf')
  await page.evaluate(() => { window.failSave = false })
  await input.press('Enter')
  await expect(page.getByRole('link')).toHaveText('Reintentar.pdf')
})

test('holding fires at 600 ms before release, suppresses rename, and a moved/cancelled press does nothing', async t => {
  const page = await setup(t)
  const now = new Date()
  await page.clock.install({ time: now })
  await page.clock.pauseAt(new Date(now.getTime() + 1000))
  const pencil = page.getByRole('button', { name: 'Lápiz', exact: true }), box = await pencil.boundingBox()
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down()
  await page.clock.runFor(599)
  assert.equal(await page.evaluate(() => window.holds), 0)
  await page.clock.runFor(1)
  assert.equal(await page.evaluate(() => window.holds), 1, 'must open while the pointer is still down')
  await page.mouse.up()
  await expect(page.getByRole('textbox')).toHaveCount(0)
  assert.equal(await page.evaluate(() => window.drags), 0)
  await page.mouse.down(); await page.mouse.move(box.x + box.width + 20, box.y); await page.clock.runFor(700); await page.mouse.up()
  assert.equal(await page.evaluate(() => window.holds), 1)
  await expect(page.getByRole('textbox')).toHaveCount(0)
})
