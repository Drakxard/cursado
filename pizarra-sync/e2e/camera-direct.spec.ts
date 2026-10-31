import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { connectPeer, drawStroke, injectImage, injectSticky, uniqueRoom } from "./helpers";

// Inspect the existing runtime test hook; production camera APIs stay unchanged.
type CameraWindow = Window & {
  __komuboard: { canvas: {
    stage: { x(): number; y(): number; scaleX(): number; isDragging(): boolean };
    viewport: { zoomStep(dir: number): void; zoomTo(scale: number): void };
  } };
};
const camera = (page: Page) => page.evaluate(() => {
  const s = (window as CameraWindow).__komuboard.canvas.stage;
  return { x: s.x(), y: s.y(), scale: s.scaleX(), dragging: s.isDragging() };
});
const frame = (page: Page) => page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => resolve())));

async function diagnostics(page: Page, info: TestInfo) {
  await page.evaluate(() => {
    const samples: { input: number; frame: number; interval: number }[] = [];
    const presentations: { input: number; presented: number; latency: number }[] = [];
    let input = 0, previous = performance.now(), running = true;
    const canvas = (window as CameraWindow).__komuboard.canvas as unknown as {
      stage: { draw(): unknown };
    };
    const draw = canvas.stage.draw;
    canvas.stage.draw = function () {
      const result = draw.call(this);
      const presented = performance.now();
      presentations.push({ input, presented, latency: presented - input });
      return result;
    };
    const record = () => { input = performance.now(); };
    window.addEventListener("pointermove", record, true);
    window.addEventListener("wheel", record, true);
    const tick = (now: number) => {
      samples.push({ input, frame: now, interval: now - previous });
      previous = now;
      if (running) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    Object.assign(window, { cameraDiagnostics: () => {
      running = false;
      window.removeEventListener("pointermove", record, true);
      window.removeEventListener("wheel", record, true);
      canvas.stage.draw = draw;
      return { frames: samples, presentations };
    } });
  });
  return async () => {
    const samples = await page.evaluate(() => (window as unknown as { cameraDiagnostics(): unknown }).cameraDiagnostics());
    await info.attach("camera-frames.json", { body: JSON.stringify(samples), contentType: "application/json" });
    // Playwright owns tracing (--trace on in CI), including manually created contexts.
  };
}

test("empty camera follows the first pixel, reverses and stops outside the board", async ({ browser }, info) => {
  const { page, close } = await connectPeer(browser, uniqueRoom("direct-empty"));
  const finish = await diagnostics(page, info);
  try {
    await page.keyboard.press("h");
    const box = (await page.locator("#board").boundingBox())!;
    const x = box.x + box.width / 2, y = box.y + box.height / 2;
    await page.mouse.move(x, y);
    const start = await camera(page);
    await page.mouse.down();
    await page.mouse.move(x + 1, y + 1);
    await frame(page);
    expect((await camera(page)).x - start.x).toBeCloseTo(1, 4);
    expect((await camera(page)).y - start.y).toBeCloseTo(1, 4);
    await page.mouse.move(x - 2, y - 3);
    await frame(page);
    expect((await camera(page)).x - start.x).toBeCloseTo(-2, 4);
    await page.mouse.move(2, 2);
    await page.mouse.up();
    const stopped = await camera(page);
    await page.mouse.move(x, y);
    await page.waitForTimeout(220);
    expect(await camera(page)).toEqual({ ...stopped, dragging: false });

    // Tool switches and cancellation cannot leave a live hand drag behind.
    for (const action of ["cancel", "tool", "blur"]) {
      await page.keyboard.press("h");
      await page.mouse.down();
      await page.mouse.move(x + 12, y + 8);
      if (action === "tool") await page.keyboard.press("p");
      else await page.evaluate(type => window.dispatchEvent(new Event(type)), action === "cancel" ? "pointercancel" : "blur");
      expect((await camera(page)).dragging).toBe(false);
      await page.mouse.up();
      await page.mouse.move(x, y);
    }
  } finally { await finish(); await close(); }
});

test("content stays aligned through composited pan, zoom, rebase and settling", async ({ browser }, info) => {
  const { page, close } = await connectPeer(browser, uniqueRoom("direct-content"));
  const finish = await diagnostics(page, info);
  try {
    await drawStroke(page);
    await injectSticky(page, { id: "note", x: 0, y: 0 });
    await page.evaluate(() => {
      const doc = (window as unknown as { __komuboard: {
        doc: { getMap(n: string): { get(id: string): { set(k: string, v: unknown): void } } };
      } }).__komuboard.doc;
      doc.getMap("objects").get("note").set("runs", [{ text: "Camera alignment" }]);
    });
    await injectImage(page, { id: "image", x: 200, y: 0, width: 60, height: 60,
      src: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='60' height='60'%3E%3Cpath fill='red' d='M0 0h60v60H0z'/%3E%3C/svg%3E" });
    const nodes = page.locator('.text-layer [data-id]');
    await expect(page.locator('.text-layer [data-id="image"]')).toBeVisible();
    const rects = () => nodes.evaluateAll(els => els.map(el => {
      const r = el.getBoundingClientRect();
      return { id: (el as HTMLElement).dataset.id!, x: r.x, y: r.y, width: r.width, height: r.height };
    }));
    await page.keyboard.press("h");
    const box = (await page.locator("#board").boundingBox())!;
    const x = box.x + box.width / 2, y = box.y + box.height / 2;
    await page.mouse.move(x, y);
    const before = await rects();
    expect(before.length).toBeGreaterThanOrEqual(3);
    await page.mouse.down();
    await page.mouse.move(x + 40, y + 20);
    await frame(page);
    for (const r of await rects()) {
      const old = before.find(b => b.id === r.id)!;
      expect(r.x - old.x).toBeCloseTo(40, 1);
      expect(r.y - old.y).toBeCloseTo(20, 1);
    }
    await page.mouse.up();
    await page.mouse.wheel(0, -50);
    await frame(page);
    const moving = await rects();
    await page.waitForTimeout(220);
    for (const r of await rects()) {
      const old = moving.find(b => b.id === r.id)!;
      expect(r.x).toBeCloseTo(old.x, 0);
      expect(r.y).toBeCloseTo(old.y, 0);
    }
    // Cross the compositor's culling margin, then return: no accumulated camera drift.
    await page.mouse.move(x - box.width * .3, y);
    const start = await camera(page);
    await page.mouse.down();
    await page.mouse.move(x + box.width * .3, y, { steps: 8 });
    await page.mouse.move(x - box.width * .3, y, { steps: 8 });
    await page.mouse.up();
    await frame(page);
    expect((await camera(page)).x).toBeCloseTo(start.x, 3);
    await expect(page.locator('.text-layer [data-id="note"]')).toBeVisible();
  } finally { await finish(); await close(); }
});

test("zoom uses normalized deltas, keeps its anchor and buttons have no animation tail", async ({ browser }) => {
  const { page, close } = await connectPeer(browser, uniqueRoom("direct-zoom"));
  try {
    const results = await page.evaluate(() => {
      const { stage, viewport } = (window as CameraWindow).__komuboard.canvas;
      const el = document.querySelector<HTMLCanvasElement>("#board canvas")!;
      const r = el.getBoundingClientRect(), px = 300, py = 250;
      const wheel = (deltaY: number, deltaMode = 0) => el.dispatchEvent(new WheelEvent("wheel", {
        bubbles: true, cancelable: true, clientX: r.left + px, clientY: r.top + py, deltaY, deltaMode,
      }));
      const anchor = () => ({ x: (px - stage.x()) / stage.scaleX(), y: (py - stage.y()) / stage.scaleX() });
      const origin = anchor();
      wheel(-1); const small = stage.scaleX();
      wheel(0); const zero = stage.scaleX();
      wheel(-1, 1); const line = stage.scaleX();
      wheel(-.01, 2); const pageScale = stage.scaleX();
      const end = anchor();
      const button = document.querySelector<HTMLButtonElement>('komu-zoombar [data-act="in"]')!;
      viewport.zoomTo(1); button.click(); const step = stage.scaleX();
      button.click(); const repeated = stage.scaleX();
      viewport.zoomTo(100); const max = stage.scaleX();
      viewport.zoomTo(.0001); const min = stage.scaleX();
      return { origin, end, small, zero, line, pageScale, height: r.height, step, repeated, max, min };
    });
    expect(results.small).toBeCloseTo(Math.exp(.002), 6);
    expect(results.zero).toBe(results.small);
    expect(results.line / results.small).toBeCloseTo(Math.exp(.032), 6);
    expect(results.pageScale / results.line).toBeCloseTo(Math.exp(Math.min(100, results.height * .01) * .002), 6);
    expect(results.end.x).toBeCloseTo(results.origin.x, 6);
    expect(results.end.y).toBeCloseTo(results.origin.y, 6);
    expect(results.step).toBe(1.25);
    expect(results.repeated).toBe(1.5);
    expect(results.max).toBe(5); expect(results.min).toBe(.01);
    await page.waitForTimeout(220);
    expect((await camera(page)).scale).toBe(.01);
  } finally { await close(); }
});

test("pinch applies its first movement and anchors the moving centre", async ({ browser }) => {
  const { page, close } = await connectPeer(browser, uniqueRoom("direct-pinch"), { touch: true });
  try {
    const result = await page.evaluate(() => {
      const s = (window as CameraWindow).__komuboard.canvas.stage;
      const el = document.querySelector<HTMLCanvasElement>("#board canvas")!;
      const r = el.getBoundingClientRect();
      const send = (type: string, points: number[][]) => {
        const touches = points.map(([x, y], identifier) => new Touch({ identifier, target: el,
          clientX: r.left + x!, clientY: r.top + y! }));
        el.dispatchEvent(new TouchEvent(type, { bubbles: true, cancelable: true, touches, targetTouches: touches, changedTouches: touches }));
      };
      const before = { x: (300 - s.x()) / s.scaleX(), y: (300 - s.y()) / s.scaleX(), scale: s.scaleX() };
      send("touchstart", [[250, 300], [350, 300]]);
      send("touchmove", [[210, 320], [410, 320]]);
      const after = { x: (310 - s.x()) / s.scaleX(), y: (320 - s.y()) / s.scaleX(), scale: s.scaleX() };
      send("touchcancel", []);
      return { before, after };
    });
    expect(result.after.scale / result.before.scale).toBeCloseTo(2, 6);
    expect(result.after.x).toBeCloseTo(result.before.x, 6);
    expect(result.after.y).toBeCloseTo(result.before.y, 6);
  } finally { await close(); }
});

test("camera bursts schedule one presentation frame and draw inside it", async ({ browser }) => {
  const { page, close } = await connectPeer(browser, uniqueRoom("direct-frame"));
  try {
    const result = await page.evaluate(async () => {
      const modulePath = "/src/viewport.ts";
      const { ViewportController } = await import(/* @vite-ignore */ modulePath);
      const calls: string[] = [], pending: FrameRequestCallback[] = [];
      const stage = { on() {}, scaleX: () => 1, x: () => 0, y: () => 0,
        draw: () => calls.push("draw"), batchDraw: () => calls.push("deferred-draw") };
      const viewport = new ViewportController(stage, document.createElement("div"), () => calls.push("transform"));
      const original = window.requestAnimationFrame;
      try {
        window.requestAnimationFrame = callback => { pending.push(callback); return pending.length; };
        for (let i = 0; i < 50; i++) viewport.scheduleSync(true);
        const count = pending.length;
        pending.shift()!(performance.now());
        return { count, remaining: pending.length, calls };
      } finally { window.requestAnimationFrame = original; viewport.destroy(); }
    });
    expect(result).toEqual({ count: 1, remaining: 0, calls: ["transform", "draw"] });
  } finally { await close(); }
});
