import { expect, test } from '@playwright/test';
import { connectPeer, injectSticky, uniqueRoom } from './helpers';

test('empty and sparse boards keep grid navigation near the hidden-grid baseline', async ({ browser }, info) => {
  test.setTimeout(90000);
  const { page, close } = await connectPeer(browser, uniqueRoom('grid-frames'));
  const reports = [];
  try {
    for (const objects of [0, 8]) {
      for (let i = 0; i < objects; i++) await injectSticky(page, { id: `note-${i}`, x: i * 100, y: 0 });
      const report = await page.evaluate(async () => {
        const target = document.querySelector('#board .konvajs-content canvas')!;
        const grid = document.querySelector<HTMLElement>('#board > .canvas-grid')!;
        const rect = target.getBoundingClientRect();
        const sample = async (hidden: boolean) => {
          grid.style.visibility = hidden ? 'hidden' : 'visible';
          const frames: number[] = [];
          let previous = performance.now();
          for (let i = 0; i < 44; i++) {
            target.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true,
              ctrlKey: true, deltaY: i % 2 ? 10 : -10, clientX: rect.left + 300, clientY: rect.top + 250 }));
            await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
            const now = performance.now();
            if (i >= 4) frames.push(now - previous);
            previous = now;
          }
          frames.sort((a, b) => a - b);
          return { p50: frames[20]!, p95: frames[38]! };
        };
        const baseline = await sample(true), visible = await sample(false);
        grid.style.removeProperty('visibility');
        return { baseline, visible };
      });
      reports.push({ objects, ...report });
      // Relative gate tolerates software-rendered CI; it catches expensive full-screen gradients.
      expect(report.visible.p50).toBeLessThan(Math.max(40, report.baseline.p50 * 2));
    }
    await page.screenshot({ path: info.outputPath('sparse-grid.png') });
  } finally {
    await info.attach('grid-frame-times.json', { body: JSON.stringify(reports), contentType: 'application/json' });
    console.log('Grid camera frames:', reports);
    await close();
  }
});
