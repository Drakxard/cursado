import { test, expect } from '@playwright/test'

async function shapes(page) {
  return page.evaluate(async () => {
    const db = await new Promise(resolve => { const request = indexedDB.open('pizarra-dispositivo', 1); request.onsuccess = () => resolve(request.result) })
    const records = await new Promise(resolve => { const request = db.transaction('boards').objectStore('boards').getAll(); request.onsuccess = () => resolve(request.result) })
    db.close()
    const board = records.find(record => record.id === localStorage.getItem('pizarra_activa'))
    return (board?.draft ?? board?.content)?.shapes ?? []
  })
}

async function openPrivate(page) {
  await page.route('**/api/**', route => route.fulfill({ status: 503, body: 'offline' }))
  await page.goto('/pizarra/')
  await page.getByRole('button', { name: 'Abrir privadas y copias de este dispositivo' }).click()
  await expect(page.locator('.toolbar')).toBeVisible()
}

test('write on the note, preview its appearance, save outside and preserve undo and reload', async ({ page }) => {
  await openPrivate(page)
  await page.getByRole('button', { name: 'Agregar nota adhesiva', exact: true }).click()
  const text = page.getByRole('textbox', { name: 'Texto de la nota', exact: true })
  await expect(text).toBeFocused()
  await expect(page.locator('.visual-inspector')).toHaveCount(0)
  await text.fill('Solución\nPrimero ordenamos el sistema.')
  await page.getByRole('button', { name: 'Color de nota 2', exact: true }).click()
  await page.getByRole('spinbutton', { name: 'Tamaño de letra de nota', exact: true }).fill('24')
  await expect(text).toHaveCSS('background-color', 'rgb(255, 213, 223)')
  await expect(text).toHaveCSS('font-size', '24px')
  await expect.poll(async () => (await shapes(page)).length).toBe(1)
  const initial = (await shapes(page))[0]
  const bounds = await text.boundingBox()
  expect(bounds.x).toBeCloseTo(initial.x, 0)
  expect(bounds.y).toBeCloseTo(initial.y, 0)
  expect(bounds.width).toBeCloseTo(initial.width, 0)
  expect(bounds.height).toBeCloseTo(initial.height, 0)
  await page.screenshot({ path: 'test-results/sticky-note-inline-desktop.png' })
  await page.mouse.click(100, 260)
  await expect(text).toHaveCount(0)
  await expect.poll(async () => (await shapes(page))[0]?.note?.text).toBe('Solución\nPrimero ordenamos el sistema.')
  expect((await shapes(page))[0].note).toMatchObject({ background: '#ffd5df', fontSize: 24 })
  await page.keyboard.press('Control+z')
  await expect.poll(async () => (await shapes(page))[0]?.note?.text).toBe('')
  await page.keyboard.press('Control+y')
  await expect.poll(async () => (await shapes(page))[0]?.note?.text).toBe('Solución\nPrimero ordenamos el sistema.')
  await page.reload()
  await expect.poll(async () => (await shapes(page))[0]?.note?.text).toBe('Solución\nPrimero ordenamos el sistema.')
  const note = (await shapes(page))[0]
  await page.mouse.dblclick(note.x + 50, note.y + 50)
  await expect(text).toHaveValue('Solución\nPrimero ordenamos el sistema.')
  await text.fill('Cambio cancelado')
  await page.keyboard.press('Escape')
  expect((await shapes(page))[0].note.text).toBe('Solución\nPrimero ordenamos el sistema.')
})

test('the editor follows a rotated note and camera zoom without losing the draft', async ({ page }) => {
  await openPrivate(page)
  await page.getByRole('button', { name: 'Agregar nota adhesiva', exact: true }).click()
  await page.getByRole('textbox', { name: 'Texto de la nota', exact: true }).fill('Girar y acercar')
  await page.getByRole('button', { name: 'Aplicar', exact: true }).click()
  await expect.poll(async () => (await shapes(page))[0]?.note?.text).toBe('Girar y acercar')
  const original = (await shapes(page))[0]
  await page.mouse.move(original.x + original.width / 2, original.y - 34)
  await page.mouse.down()
  await page.mouse.move(original.x + original.width / 2 + 60, original.y - 4, { steps: 10 })
  await page.mouse.up()
  await expect.poll(async () => Math.abs((await shapes(page))[0]?.rotation ?? 0)).toBeGreaterThan(.2)
  const note = (await shapes(page))[0]
  await page.mouse.dblclick(note.x + note.width / 2, note.y + note.height / 2)
  const text = page.getByRole('textbox', { name: 'Texto de la nota', exact: true })
  await text.fill('Borrador durante el zoom')
  const before = await text.boundingBox()
  await page.mouse.move(100, 300)
  await page.mouse.wheel(0, 40)
  await expect.poll(async () => (await text.boundingBox()).y).not.toBe(before.y)
  await page.keyboard.down('Control')
  await page.mouse.wheel(0, -100)
  await page.keyboard.up('Control')
  await expect.poll(async () => (await text.boundingBox()).width).not.toBe(before.width)
  await expect(text).toHaveValue('Borrador durante el zoom')
  const matrix = await page.locator('.inline-note-surface').evaluate(element => {
    const matrix = new DOMMatrix(getComputedStyle(element).transform)
    return { angle: Math.atan2(matrix.b, matrix.a), scale: Math.hypot(matrix.a, matrix.b) }
  })
  expect(matrix.angle).toBeCloseTo(note.rotation, 3)
  expect(matrix.scale).not.toBe(1)
  await text.press('Control+Enter')
  await expect.poll(async () => (await shapes(page))[0]?.note?.text).toBe('Borrador durante el zoom')
})

test('compact note controls remain accessible on mobile and in a short window', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 667 })
  await openPrivate(page)
  await page.getByRole('button', { name: 'Agregar nota adhesiva', exact: true }).click()
  const text = page.getByRole('textbox', { name: 'Texto de la nota', exact: true })
  await text.fill('Una nota desde el celular')
  for (const size of [{ width: 390, height: 667 }, { width: 320, height: 480 }, { width: 900, height: 400 }]) {
    await page.setViewportSize(size)
    await expect.poll(async () => page.locator('.inline-note-toolbar').evaluate(element => {
      const box = element.getBoundingClientRect()
      return box.left >= 0 && box.top >= 0 && box.right <= innerWidth && box.bottom <= innerHeight
    })).toBe(true)
    await expect(page.getByRole('button', { name: 'Color de nota 6', exact: true })).toBeInViewport()
    await expect(page.getByRole('button', { name: 'Aplicar', exact: true })).toBeInViewport()
    await expect(text).toHaveValue('Una nota desde el celular')
  }
  await page.setViewportSize({ width: 390, height: 667 })
  await page.screenshot({ path: 'test-results/sticky-note-inline-mobile.png' })
  await page.getByRole('button', { name: 'Aplicar', exact: true }).click()
  await expect.poll(async () => (await shapes(page))[0]?.note?.text).toBe('Una nota desde el celular')
})

test('Ctrl+C and Ctrl+V duplicate the complete selected note even when clipboard access is denied', async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(navigator, 'clipboard', { value: {
    write: async () => { throw new DOMException('Clipboard denied', 'NotAllowedError') },
  } }))
  await openPrivate(page)
  await page.getByRole('button', { name: 'Agregar nota adhesiva', exact: true }).click()
  await page.getByRole('textbox', { name: 'Texto de la nota', exact: true }).fill('Nota para copiar\nCon dos líneas')
  await page.getByRole('button', { name: 'Color de nota 3', exact: true }).click()
  await page.getByRole('spinbutton', { name: 'Tamaño de letra de nota', exact: true }).fill('26')
  await page.getByRole('button', { name: 'Aplicar', exact: true }).click()
  await expect.poll(async () => (await shapes(page))[0]?.note?.fontSize).toBe(26)
  const original = (await shapes(page))[0]
  await page.keyboard.press('Control+c')
  await page.keyboard.press('Control+v')
  await expect.poll(async () => (await shapes(page)).length).toBe(2)
  await page.keyboard.press('Control+v')
  await expect.poll(async () => (await shapes(page)).length).toBe(3)
  const copies = await shapes(page)
  expect(new Set(copies.map(note => note.id)).size).toBe(3)
  for (const copy of copies.slice(1)) {
    expect(copy.note).toEqual(original.note)
    expect(copy.width).toBe(original.width)
    expect(copy.height).toBe(original.height)
    expect(copy.x).toBeGreaterThan(original.x)
    expect(copy.y).toBeGreaterThan(original.y)
  }
  await page.keyboard.press('Control+z')
  await expect.poll(async () => (await shapes(page)).length).toBe(2)
  await page.keyboard.press('Control+y')
  await expect.poll(async () => (await shapes(page)).length).toBe(3)
})

test('system clipboard pastes a copied URL note as an object and keeps native text editing shortcuts', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  await openPrivate(page)
  await page.evaluate(() => navigator.clipboard.writeText('Texto externo anterior'))
  const content = 'https://youtu.be/dQw4w9WgXcQ'
  await page.getByRole('button', { name: 'Agregar nota adhesiva', exact: true }).click()
  await page.getByRole('textbox', { name: 'Texto de la nota', exact: true }).fill(content)
  await page.getByRole('button', { name: 'Aplicar', exact: true }).click()
  await page.keyboard.press('Control+c')
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(content)
  await page.keyboard.press('Control+v')
  await expect.poll(async () => (await shapes(page)).length).toBe(2)
  expect((await shapes(page))[1].note.text).toBe(content)
  await page.getByRole('button', { name: 'Editar nota', exact: true }).click()
  const field = page.getByRole('textbox', { name: 'Texto de la nota', exact: true })
  await field.press('Control+a')
  await field.press('Control+c')
  await field.press('End')
  await field.press('Enter')
  await field.press('Control+v')
  await expect(field).toHaveValue(`${content}\n${content}`)
  await page.getByRole('button', { name: 'Aplicar', exact: true }).click()
  await expect.poll(async () => (await shapes(page))[1]?.note?.text).toBe(`${content}\n${content}`)
  expect((await shapes(page)).length).toBe(2)
})
