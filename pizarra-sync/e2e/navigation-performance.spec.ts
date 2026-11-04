import { expect, test } from '@playwright/test';
import { connectPeer, uniqueRoom } from './helpers';

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
      return { hoverMs, rectReads, changed: [...changed], moved, editMs, settleMs,
        frames: stats(frames), handler: stats(handlerMs), inputToCameraCallback: stats(presentationMs), longTasks: stats(tasks),
        mounted: layer.root.querySelectorAll('[data-id]').length, total: board.doc.getMap('objects').size };
    });
    const after = await cdp.send('Performance.getMetrics');
    const { profile } = await cdp.send('Profiler.stop');
    const metrics = Object.fromEntries(after.metrics.map(m => [m.name, m.value - (before.metrics.find(b => b.name === m.name)?.value ?? 0)]));
    console.log(theme, JSON.stringify({ ...report, changed: report.changed.length, metrics }));
    await info.attach('navigation.json', { body: JSON.stringify({ theme, report, metrics }, null, 2), contentType: 'application/json' });
    await info.attach('navigation.cpuprofile', { body: JSON.stringify(profile), contentType: 'application/json' });
    expect(report.total).toBe(1200);
    expect(report.frames.samples).toBe(40);
    await expect(page.locator('[data-id="nav-0"]')).toContainText('Updated material');
  } finally { await peer.close(); }
});
