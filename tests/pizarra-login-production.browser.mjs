import assert from 'node:assert/strict'
import test from 'node:test'
import { randomBytes } from 'node:crypto'
import { mkdir } from 'node:fs/promises'
import { chromium } from '@playwright/test'

// Explicit production smoke test, invoked only by the manual deployment workflow.
// Each run registers one isolated verification account with a random password.
const origin='https://cursado.vercel.app'
test('production Pizarra registration, login, session restoration and logout through the Vercel proxy',async t=>{
  const browser=await chromium.launch({headless:true});t.after(()=>browser.close())
  const context=await browser.newContext({serviceWorkers:'block'}),page=await context.newPage()
  const name=`verifica-${randomBytes(6).toString('hex')}`,password=randomBytes(32).toString('hex')
  await page.goto(origin)
  await page.getByRole('link',{name:'Abrir Pizarra',exact:true}).click()
  await page.getByRole('heading',{name:'Tu pizarra',exact:true}).waitFor()
  await page.getByLabel('Tu nombre de usuario',{exact:true}).fill(name)
  await page.getByLabel('Contraseña',{exact:true}).fill(password)
  const registration=page.waitForResponse(r=>new URL(r.url()).pathname==='/pizarra/api/auth/guest')
  await page.getByRole('button',{name:'Crear mi espacio',exact:true}).click()
  const response=await registration
  assert.equal(response.status(),200,`Registro: HTTP ${response.status()}`)
  await page.getByRole('button',{name:`Abrir perfil de ${name}`,exact:true}).waitFor()
  await page.locator('canvas').first().waitFor()
  await page.waitForFunction(()=>localStorage.getItem('pizarra_activa')?.startsWith('local:'))
  const cookie=(await context.cookies()).find(cookie=>cookie.name==='pizarra_sid')
  assert.ok(cookie?.httpOnly&&cookie.secure);assert.equal(cookie.path,'/pizarra/')
  assert.equal(await page.evaluate(()=>document.cookie.includes('pizarra_sid')),false)
  await page.keyboard.press('Control+q');await page.waitForURL(origin+'/')
  await page.goto(origin+'/pizarra/')
  await page.getByRole('button',{name:`Abrir perfil de ${name}`,exact:true}).waitFor()
  await page.reload()
  await page.getByRole('button',{name:`Abrir perfil de ${name}`,exact:true}).click()
  await page.getByRole('button',{name:'Cambiar de usuario / salir',exact:true}).click()
  await page.getByRole('heading',{name:'Tu pizarra',exact:true}).waitFor()
  assert.equal((await context.cookies()).some(cookie=>cookie.name==='pizarra_sid'),false)
  const other=await browser.newContext({serviceWorkers:'block'}),second=await other.newPage()
  await second.goto(origin+'/pizarra/')
  await second.getByRole('button',{name:'Ingresar',exact:true}).click()
  await second.getByLabel('Tu nombre de usuario',{exact:true}).fill(name.toUpperCase())
  await second.getByLabel('Contraseña',{exact:true}).fill('wrong-password')
  await second.getByRole('button',{name:'Ingresar a mi espacio',exact:true}).click()
  await second.getByText(/Nombre o contraseña incorrectos/).waitFor()
  await second.getByLabel('Contraseña',{exact:true}).fill(password)
  const loggedIn=second.waitForResponse(r=>new URL(r.url()).pathname==='/pizarra/api/auth/login')
  await second.getByRole('button',{name:'Ingresar a mi espacio',exact:true}).click()
  assert.equal((await loggedIn).status(),200)
  await second.getByRole('button',{name:`Abrir perfil de ${name}`,exact:true}).waitFor()
  await second.locator('canvas').first().waitFor()
  await mkdir('test-results',{recursive:true})
  await second.screenshot({path:'test-results/pizarra-production-login.png'})
  await second.getByRole('button',{name:`Abrir perfil de ${name}`,exact:true}).click()
  await second.getByRole('button',{name:'Cambiar de usuario / salir',exact:true}).click()
  await second.getByRole('heading',{name:'Tu pizarra',exact:true}).waitFor()
})
