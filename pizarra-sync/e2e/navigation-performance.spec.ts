import { expect, test, type TestInfo } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { connectPeer, uniqueRoom } from './helpers';

async function artifact(info: TestInfo, name: string, value: unknown) {
  const filename = info.outputPath(name);
  await mkdir(path.dirname(filename), { recursive: true });
  await writeFile(filename, JSON.stringify(value, null, 2));
  await info.attach(name, { path: filename, contentType: 'application/json' });
}

// Runtime hooks are deliberately inspected here; production has no benchmark branches.
// Timing metrics diagnose responsiveness. Work counters provide deterministic regression gates.
for (const theme of ['light', 'dark']) test(`production navigation: links, edits and gestures (${theme})`, async ({ browser }, info) => {
  const peer = await connectPeer(browser, uniqueRoom('navigation'));
  const { page } = peer;
  const cdp = await page.context().newCDPSession(page);
  try {
    await cdp.send('Performance.enable');
    await page.evaluate(({ theme }) => {
      document.documentElement.dataset.theme = theme;
      const { doc, canvas } = (window as any).__komuboard;
      const objects = doc.getMap('objects'), order = doc.getArray('order');
      const MapType = objects.constructor;
      for (let start = 0; start < 1200; start += 100) doc.transact(() => {
        for (let i = start; i < start + 100; i++) {
          const map = new MapType();
          const values = { id: `nav-${i}`, type: 'text', x: (i % 40) * 220, y: Math.floor(i / 40) * 160,
            width: 180, height: 100, bg: '#ffec99', fontSize: 16, fontFamily: 'Inter', align: 'left',
            runs: [{ text: `Material ${i}`, link: `https://example.test/${i}` }] };
          for (const [key, value] of Object.entries(values)) map.set(key, value);
          objects.set(values.id, map); order.push([values.id]);
        }
      });
      canvas.zoomToFit();
    }, { theme });
    await page.waitForTimeout(400);
    await cdp.send('Profiler.enable');
    await cdp.send('Profiler.start');
    const before = await cdp.send('Performance.getMetrics');
    const report = await page.evaluate(async () => {
      const board = (window as any).__komuboard, layer = board.canvas.textLayer;
      const frame = () => new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
      const frames: number[] = [], tasks: number[] = [];
      const observer = new PerformanceObserver(list => { for (const entry of list.getEntries()) tasks.push(entry.duration); });
      observer.observe({ type: 'longtask', buffered: false });
      let rectReads = 0;
      const rects = Element.prototype.getClientRects;
      Element.prototype.getClientRects = function () { rectReads++; return rects.call(this); };
      const hoverStart = performance.now();
      for (let i = 0; i < 30; i++) layer.linkAtPoint(-10 - i, -10);
      const hoverMs = performance.now() - hoverStart;
      const outsideRectReads = rectReads;
      rectReads = 0;
      const stage = board.canvas.stage;
      const bounds = document.querySelector('#board')!.getBoundingClientRect();
      // Blank space between two cards, INSIDE the board (not just an early bounds return).
      for (let i = 0; i < 30; i++) layer.linkAtPoint(bounds.x + stage.x() + (200 + i / 100) * stage.scaleX(), bounds.y + stage.y() + 50 * stage.scaleX());
      const insideRectReads = rectReads;
      Element.prototype.getClientRects = rects;

      const changed = new Set<string>();
      let moved = 0;
      const mutations = new MutationObserver(records => {
        for (const record of records) {
          const host = (record.target as Element).closest?.('[data-id]');
          if (host) changed.add(host.getAttribute('data-id')!);
          if (record.target === layer.root) moved += record.addedNodes.length;
        }
      });
      mutations.observe(layer.root, { childList: true, subtree: true });
      const editStart = performance.now();
      board.doc.getMap('objects').get('nav-0').set('runs', [{ text: 'Updated material', link: 'https://example.test/updated' }]);
      await frame();
      const editMs = performance.now() - editStart;
      mutations.disconnect();

      // Separate continuous input from the final settle: both matter to perceived response.
      const el = document.querySelector('#board canvas')!, rect = el.getBoundingClientRect();
      const sync = layer.syncTransform;
      const handlerMs: number[] = [], presentationMs: number[] = [];
      let inputAt = 0;
      layer.syncTransform = function (...args: unknown[]) {
        presentationMs.push(performance.now() - inputAt);
        return sync.apply(this, args);
      };
      let previous = performance.now();
      for (let i = 0; i < 40; i++) {
        inputAt = performance.now();
        el.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, ctrlKey: i < 20,
          deltaY: (i % 2 ? 1 : -1) * (i < 20 ? 4 : 18), clientX: rect.x + rect.width / 2, clientY: rect.y + rect.height / 2 }));
        handlerMs.push(performance.now() - inputAt);
        await frame();
        const now = performance.now(); frames.push(now - previous); previous = now;
      }
      layer.syncTransform = sync;
      const settleStart = performance.now();
      layer.finishCameraMotion();
      await frame();
      const settleMs = performance.now() - settleStart;
      await frame();
      observer.disconnect();
      const stats = (values: number[]) => {
        const sorted = [...values].sort((a, b) => a - b);
        return { p50: sorted[Math.floor(sorted.length * .5)] ?? 0, p95: sorted[Math.floor(sorted.length * .95)] ?? 0,
          max: sorted.at(-1) ?? 0, samples: sorted.length, over50: sorted.filter(x => x > 50).length };
      };
      return { hoverMs, rectReads: outsideRectReads, insideRectReads, changed: [...changed], moved, editMs, settleMs,
        frames: stats(frames), handler: stats(handlerMs), inputToCameraCallback: stats(presentationMs), longTasks: stats(tasks),
        mounted: layer.root.querySelectorAll('[data-id]').length, total: board.doc.getMap('objects').size };
    });
    const after = await cdp.send('Performance.getMetrics');
    const { profile } = await cdp.send('Profiler.stop');
    const metrics = Object.fromEntries(after.metrics.map(m => [m.name, m.value - (before.metrics.find(b => b.name === m.name)?.value ?? 0)]));
    console.log(theme, JSON.stringify({ ...report, changed: report.changed.length, metrics }));
    await artifact(info, 'navigation.json', { theme, report, metrics });
    await artifact(info, 'navigation.cpuprofile', profile);
    expect(report.total).toBe(1200);
    expect(report.frames.samples).toBe(40);
    expect(report.rectReads).toBe(0);
    expect(report.insideRectReads).toBe(0);
    expect(report.changed).toEqual(['nav-0']);
    expect(report.moved).toBe(0);
    await expect(page.locator('[data-id="nav-0"]')).toContainText('Updated material');

    // Warm reopen includes fetching the real persisted room and its first visible content.
    const reopenStart = Date.now();
    await page.reload();
    await page.waitForFunction(() => (window as any).__komuboard?.doc.getMap('objects').size === 1200);
    await expect(page.locator('.komu-text').first()).toBeVisible();
    await artifact(info, 'reopen.json', { ms: Date.now() - reopenStart, navigation: await page.evaluate(() => performance.getEntriesByType('navigation')[0]?.toJSON()) });
  } finally { await peer.close(); }
});

test('cached notes retain links, stacking, edits, undo and remounting', async ({ browser }) => {
  const peer = await connectPeer(browser, uniqueRoom('navigation-correctness'));
  const { page } = peer;
  try {
    const result = await page.evaluate(async () => {
      const { doc, canvas } = (window as any).__komuboard;
      const objects = doc.getMap('objects'), order = doc.getArray('order'), MapType = objects.constructor;
      doc.transact(() => {
        for (let i = 0; i < 3; i++) {
          const map = new MapType();
          for (const [k, v] of Object.entries({ id: `link-${i}`, type: 'text', x: i * 250, y: 0, width: 200, height: 120,
            fontSize: 16, fontFamily: 'Inter', align: 'left', bg: '#ffec99', runs: [{ text: `Linked note ${i}`, link: `https://example.test/${i}` }] })) map.set(k, v);
          objects.set(`link-${i}`, map); order.push([`link-${i}`]);
        }
      });
      canvas.zoomToFit();
      await new Promise(resolve => setTimeout(resolve, 300));
      const layer = canvas.textLayer, text = layer.els.get('link-0'), originalLink = text.querySelector('a');
      objects.get('link-1').set('runs', [{ text: 'Other note changed' }]);
      const retained = originalLink === text.querySelector('a');
      const r = originalLink.getClientRects()[0];
      const hit = layer.linkAtPoint(r.x + r.width / 2, r.y + r.height / 2)?.href;
      objects.get('link-0').set('rotation', 45);
      const rotatedRect = text.querySelector('a').getClientRects()[0];
      const rotatedHit = layer.linkAtPoint(rotatedRect.x + rotatedRect.width / 2, rotatedRect.y + rotatedRect.height / 2)?.href;
      layer.beginEdit('link-0');
      const editorRect = layer.edit.el.querySelector('a').getClientRects()[0];
      const editorHit = layer.linkAtPoint(editorRect.x + editorRect.width / 2, editorRect.y + editorRect.height / 2)?.href;
      layer.commit();
      doc.transact(() => { order.delete(0, 1); order.push(['link-0']); });
      const domOrder = [...layer.root.children].map((el: any) => el.dataset.id).filter(Boolean);
      objects.get('link-0').set('runs', [{ text: 'Changed link', link: 'https://example.test/new' }]);
      const changed = text.querySelector('a')?.href;
      canvas.undoManager.undo();
      const undone = text.querySelector('a')?.href;
      canvas.viewport.applyTransform(1, { x: -100000, y: -100000 });
      await new Promise(resolve => setTimeout(resolve, 300));
      const culled = !layer.els.has('link-0');
      canvas.zoomToFit();
      await new Promise(resolve => setTimeout(resolve, 300));
      const remounted = layer.els.get('link-0')?.querySelector('a')?.href;
      return { retained, hit, rotatedHit, editorHit, domOrder, changed, undone, culled, remounted };
    });
    expect(result).toEqual({ retained: true, hit: 'https://example.test/0', rotatedHit: 'https://example.test/0', editorHit: 'https://example.test/0', domOrder: ['link-1', 'link-2', 'link-0'],
      changed: 'https://example.test/new', undone: 'https://example.test/0', culled: true, remounted: 'https://example.test/0' });
  } finally { await peer.close(); }
});

test('large scanned pages keep decoded images during night-mode navigation', async ({ browser }, info) => {
  const peer = await connectPeer(browser, uniqueRoom('navigation-images'));
  const { page } = peer;
  try {
    const data = await page.evaluate(() => {
      const canvas = document.createElement('canvas'); canvas.width = 2048; canvas.height = 3072;
      const ctx = canvas.getContext('2d')!; ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = '#111'; ctx.font = '32px sans-serif';
      for (let y = 100; y < 2900; y += 60) ctx.fillText('Documento de estudio: formulas, temas y diagramas', 80, y);
      return canvas.toDataURL('image/png').split(',')[1];
    });
    let requests = 0;
    await page.route('**/img/nav-scan-*', async route => {
      requests++;
      await route.fulfill({ body: Buffer.from(data, 'base64'), contentType: 'image/png', headers: { 'access-control-allow-origin': '*' } });
    });
    await page.evaluate(() => {
      document.documentElement.dataset.theme = 'dark';
      const { doc, canvas } = (window as any).__komuboard, objects = doc.getMap('objects'), order = doc.getArray('order');
      const MapType = objects.constructor;
      doc.transact(() => {
        for (let i = 0; i < 12; i++) {
          const map = new MapType();
          for (const [k, v] of Object.entries({ id: `scan-${i}`, type: 'image', x: (i % 4) * 550, y: Math.floor(i / 4) * 800, width: 512, height: 768, src: `nav-scan-${i}` })) map.set(k, v);
          objects.set(`scan-${i}`, map); order.push([`scan-${i}`]);
        }
      });
      canvas.zoomToFit();
    });
    await page.waitForFunction(() => {
      const imgs = [...document.querySelectorAll<HTMLImageElement>('.komu-image img')];
      return imgs.length === 12 && imgs.every(img => img.complete && img.naturalWidth === 2048);
    });
    await page.waitForTimeout(300);
    const report = await page.evaluate(async () => {
      const { canvas } = (window as any).__komuboard, originals = [...document.querySelectorAll('.komu-image img')];
      const target = document.querySelector('#board canvas')!, bounds = target.getBoundingClientRect();
      const frames = []; let previous = performance.now();
      for (let i = 0; i < 30; i++) {
        target.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, ctrlKey: true, deltaY: i % 2 ? 3 : -3, clientX: bounds.x + bounds.width / 2, clientY: bounds.y + bounds.height / 2 }));
        await new Promise(resolve => requestAnimationFrame(resolve));
        const now = performance.now(); frames.push(now - previous); previous = now;
      }
      canvas.textLayer.finishCameraMotion();
      const current = [...document.querySelectorAll('.komu-image img')];
      frames.sort((a, b) => a - b);
      return { retained: current.length === originals.length && originals.every((img, i) => img === current[i]), p50: frames[15], p95: frames[28], max: frames[29], decodedPixels: 12 * 2048 * 3072 };
    });
    await artifact(info, 'scanned-pages.json', { ...report, requests });
    expect(report.retained).toBe(true);
    expect(requests).toBe(12);
  } finally { await peer.close(); }
});
