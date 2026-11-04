import { expect, test } from "@playwright/test";

import { connectPeer, uniqueRoom } from "./helpers";

type ProfileWindow = {
  __komuboard: {
    doc: {
      getMap(name: string): {
        size: number;
        get(id: string): { set(key: string, value: unknown): void };
      };
    };
    awareness: { setLocalStateField(key: string, value: unknown): void };
    canvas: { zoomToFit(): void; textLayer: Record<string, (...args: unknown[]) => unknown> };
  };
};

/**
 * Dense-board performance regression gate (ADR-0009 Phase 4).
 *
 * Injects a 3,000-object board (2,400 stickies/shapes, half with text + 600 strokes) and measures
 * rAF frame times while pumping wheel gestures (wheel = zoom here, so the sweeps cross the whole
 * zoom range — the worst case: mount/unmount churn + full-board relayout at far zoom).
 *
 * Frame budgets are calibrated against an empty-board run on the same machine.
 * The separate profile gate checks board-wide work and style cost directly, since
 * software-rendered CI browsers cannot establish a hardware-independent FPS promise.
 */

/** Use bounded transactions, like real editing, below the Worker's 512 KiB message cap. */
async function injectDenseBoard(
  page: import("@playwright/test").Page,
  boxes: number,
  strokes: number,
): Promise<void> {
  await page.evaluate(
    ({ boxes, strokes }) => {
      const doc = (
        window as unknown as {
          __komuboard: {
            doc: {
              getMap(n: string): { set(k: string, v: unknown): void; constructor: new () => never };
              getArray(n: string): { push(v: string[]): void };
              transact(f: () => void): void;
            };
          };
        }
      ).__komuboard.doc;
      const objects = doc.getMap("objects");
      const order = doc.getArray("order");
      const YMap = objects.constructor as new () => { set(k: string, v: unknown): void };
      const cols = Math.ceil(Math.sqrt(boxes + strokes));
      for (let start = 0; start < boxes + strokes; start += 250)
        doc.transact(() => {
          const end = start + 250;
          for (let i = start; i < Math.min(boxes, end); i++) {
            const m = new YMap();
            const shape = i % 3 === 2;
            m.set("id", "b" + i);
            m.set("type", "text");
            if (shape) m.set("shape", i % 2 ? "rectangle" : "ellipse");
            m.set("x", (i % cols) * 240);
            m.set("y", Math.floor(i / cols) * 240);
            m.set("width", 180);
            m.set("height", shape ? 120 : 180);
            m.set("bg", ["#ffec99", "#b2f2bb", "#a5d8ff", "#ffc9c9"][i % 4]);
            m.set("runs", i % 2 === 0 ? [{ text: "Note " + i + "\nsecond line" }] : []);
            m.set("fontFamily", "Inter");
            m.set("fontSize", 16);
            m.set("align", "left");
            m.set("authorId", "e2e");
            objects.set("b" + i, m);
            order.push(["b" + i]);
          }
          for (let i = Math.max(0, start - boxes); i < Math.min(strokes, end - boxes); i++) {
            const j = boxes + i;
            const ox = (j % cols) * 240;
            const oy = Math.floor(j / cols) * 240;
            const pts: number[] = [];
            for (let k = 0; k < 24; k++) pts.push(ox + k * 8, oy + 60 + Math.sin(k / 2) * 50);
            const m = new YMap();
            m.set("id", "s" + i);
            m.set("type", "stroke");
            m.set("points", pts);
            m.set("color", "#0e1116");
            m.set("width", 6);
            m.set("style", "solid");
            m.set("opacity", 1);
            m.set("authorId", "e2e");
            objects.set("s" + i, m);
            order.push(["s" + i]);
          }
        });
    },
    { boxes, strokes },
  );
}

interface FrameStats {
  frames: number;
  avg: number;
  p50: number;
  p95: number;
  max: number;
  over33ms: number;
  methods: Record<string, { calls: number; ms: number; max: number }>;
}

/** Pump oscillating wheel gestures (~125/s, flipping every `flipEvery` ticks) for `ms` while
 *  sampling rAF frame deltas in-page. `ctrl` adds ctrlKey (pinch-zoom path). */
async function sweep(
  page: import("@playwright/test").Page,
  opts: { ms: number; flipEvery: number; ctrl: boolean },
): Promise<FrameStats> {
  return (await page.evaluate(
    async ({ ms, flipEvery, ctrl }) => {
      const layer = (window as unknown as ProfileWindow).__komuboard.canvas.textLayer;
      const methods: FrameStats["methods"] = {};
      const originals = new Map<string, (...args: unknown[]) => unknown>();
      for (const name of [
        "syncTransform",
        "recull",
        "layout",
        "paintStroke",
        "paintConnector",
        "recordSize",
        "reorderZ",
      ]) {
        const original = layer[name]!;
        originals.set(name, original);
        methods[name] = { calls: 0, ms: 0, max: 0 };
        layer[name] = function (...args: unknown[]) {
          const start = performance.now();
          try {
            return original.apply(this, args);
          } finally {
            const duration = performance.now() - start;
            methods[name]!.calls++;
            methods[name]!.ms += duration;
            methods[name]!.max = Math.max(methods[name]!.max, duration);
          }
        };
      }
      const el = document.elementFromPoint(640, 360);
      if (!el) throw new Error("nothing at viewport centre");
      let dir = 1;
      let n = 0;
      const pump = (): void => {
        if (++n % flipEvery === 0) dir = -dir;
        el.dispatchEvent(
          new WheelEvent("wheel", {
            deltaX: 24 * dir,
            deltaY: (ctrl ? 12 : 18) * dir,
            ctrlKey: ctrl,
            bubbles: true,
            cancelable: true,
            clientX: 640,
            clientY: 360,
          }),
        );
      };
      const deltas: number[] = [];
      await new Promise<void>((done) => {
        let last: number | undefined;
        let stop = false;
        const loop = (t: number): void => {
          if (last !== undefined) deltas.push(t - last);
          last = t;
          if (stop) done();
          else requestAnimationFrame(loop);
        };
        requestAnimationFrame(loop);
        const iv = setInterval(pump, 8);
        setTimeout(() => {
          stop = true;
          clearInterval(iv);
        }, ms);
      });
      deltas.sort((a, b) => a - b);
      for (const [name, original] of originals) layer[name] = original;
      const q = (p: number): number =>
        deltas[Math.min(deltas.length - 1, Math.floor(deltas.length * p))] ?? 0;
      return {
        frames: deltas.length,
        avg: +(deltas.reduce((a, b) => a + b, 0) / deltas.length).toFixed(1),
        p50: +q(0.5).toFixed(1),
        p95: +q(0.95).toFixed(1),
        max: +Math.max(...deltas).toFixed(1),
        over33ms: deltas.filter((d) => d > 33).length,
        methods,
      };
    },
    { ms: opts.ms, flipEvery: opts.flipEvery, ctrl: opts.ctrl },
  )) as FrameStats;
}

test("perf: a 3000-object board stays interactive through full-range zoom sweeps", async ({
  browser,
}, info) => {
  test.setTimeout(180_000);
  const a = await connectPeer(browser, uniqueRoom("perf"));
  const page = a.page;
  await sweep(page, { ms: 500, flipEvery: 60, ctrl: false }); // warm the renderer
  const empty = await sweep(page, { ms: 3000, flipEvery: 60, ctrl: false });
  console.log("empty-board wheel baseline:", JSON.stringify(empty));
  expect(empty.frames).toBeGreaterThan(5);
  // Preserve the legacy full-range ceilings on fast machines, and allow at most
  // twice the empty-board frame cost on a software-rendered/contended runner.
  // These sweeps include mounting and settling thousands of objects. The profile
  // below separately enforces the steady gesture's actual CPU/style work.
  const p50Limit = Math.max(100, empty.p50 * 2);
  const p95Limit = Math.max(1000, empty.p95 * 2);
  await page.evaluate(() => {
    (
      window as unknown as { __komuboard: { canvas: { resetZoom(): void } } }
    ).__komuboard.canvas.resetZoom();
  });
  await page.waitForTimeout(200);

  const t0 = Date.now();
  await injectDenseBoard(page, 2400, 600);
  await page.waitForFunction(() => document.querySelectorAll(".text-layer > *").length > 0);
  const mountMs = Date.now() - t0;
  console.log("inject+first-mount ms:", mountMs);
  expect(mountMs).toBeLessThan(15_000);

  const counts = () =>
    page.evaluate(() => ({
      mounted: document.querySelectorAll(".text-layer > *").length,
    }));

  // Culling: at 100% over a corner of the board only a small fraction is mounted.
  const near = await counts();
  console.log("mounted @100%:", JSON.stringify(near));
  expect(near.mounted).toBeLessThan(300);
  expect(near.mounted).toBeGreaterThan(0);

  // Wheel sweep at 100% (wheel = zoom → crosses the zoom range; worst-case mount churn).
  const wheelNear = await sweep(page, { ms: 3000, flipEvery: 60, ctrl: false });
  console.log("wheel sweep from 100%:", JSON.stringify(wheelNear));

  // Zoom to fit → EVERYTHING mounts (culling off-screen set is empty at fit).
  await page.evaluate(() => {
    (
      window as unknown as { __komuboard: { canvas: { zoomToFit(): void } } }
    ).__komuboard.canvas.zoomToFit();
  });
  await page.waitForTimeout(1200);
  const fit = await counts();
  console.log(
    "mounted @fit:",
    JSON.stringify(fit),
    "zoom:",
    await page.evaluate(() => document.getElementById("zoom-pill")?.textContent ?? "?"),
  );
  expect(fit.mounted).toBeGreaterThanOrEqual(3000); // all 2400 boxes + 600 strokes are in the DOM

  // Sweeps with the whole board mounted — per-frame relayout of every element.
  const wheelFit = await sweep(page, { ms: 3000, flipEvery: 60, ctrl: false });
  console.log("wheel sweep from fit:", JSON.stringify(wheelFit));

  const pinchFit = await sweep(page, { ms: 3000, flipEvery: 40, ctrl: true });
  console.log("ctrl-wheel sweep from fit:", JSON.stringify(pinchFit));
  await info.attach("zoom-sweeps.json", {
    body: JSON.stringify({ empty, wheelNear, wheelFit, pinchFit, p50Limit, p95Limit }, null, 2),
    contentType: "application/json",
  });
  for (const stats of [wheelNear, wheelFit, pinchFit]) {
    expect.soft(stats.frames).toBeGreaterThan(5);
    expect.soft(stats.p50).toBeLessThan(p50Limit);
    expect.soft(stats.p95).toBeLessThan(p95Limit);
  }

  await a.close();
});

// Instrument the actual runtime, without adding profiling overhead to production.
// Counts identify wasted board-wide work even on a fast CI runner; timings provide context.
test("zoom profile: dense board with a collaborating text editor", async ({ browser }, info) => {
  test.setTimeout(180_000);
  const room = uniqueRoom("zoom-profile");
  const a = await connectPeer(browser, room);
  const b = await connectPeer(browser, room);
  try {
    console.log("zoom profile: connected both peers");
    await injectDenseBoard(a.page, 2400, 600);
    console.log("zoom profile: injected board");
    await b.page.waitForFunction(
      () => (window as unknown as ProfileWindow).__komuboard.doc.getMap("objects").size === 3000,
      undefined,
      { timeout: 15_000 },
    );
    await a.page.bringToFront();
    await a.page.evaluate(() =>
      (window as unknown as ProfileWindow).__komuboard.canvas.zoomToFit(),
    );
    await a.page.waitForTimeout(300);
    await b.page.evaluate(() =>
      (window as unknown as ProfileWindow).__komuboard.awareness.setLocalStateField("textedit", {
        id: "b0",
        x: 0,
        y: 0,
        width: 180,
        fontSize: 16,
        fontFamily: "Inter",
        align: "left",
        bg: "#ffec99",
        runs: [{ text: "Peer is editing" }],
      }),
    );
    await expect(a.page.locator(".komu-text-remote")).toHaveCount(1);
    // The camera background must not broadcast its changing CSS variables to content.
    expect(
      await a.page
        .locator(".text-layer")
        .evaluate((el) => getComputedStyle(el).getPropertyValue("--grid-fine")),
    ).toBe("");
    const cdp = await a.page.context().newCDPSession(a.page);
    await cdp.send("Performance.enable");
    await cdp.send("Profiler.enable");
    await cdp.send("Profiler.start");
    const before = await cdp.send("Performance.getMetrics");
    const profile = await a.page.evaluate(async () => {
      const board = (window as unknown as ProfileWindow).__komuboard;
      const layer = board.canvas.textLayer;
      const names = [
        "syncTransform",
        "recull",
        "layout",
        "paintStroke",
        "paintConnector",
        "recordSize",
      ];
      const methods: Record<string, { calls: number; ms: number }> = {};
      const originals = new Map<string, (...args: unknown[]) => unknown>();
      for (const name of names) {
        const original = layer[name]!;
        originals.set(name, original);
        methods[name] = { calls: 0, ms: 0 };
        layer[name] = function (...args: unknown[]) {
          const start = performance.now();
          try {
            return original.apply(this, args);
          } finally {
            methods[name]!.calls++;
            methods[name]!.ms += performance.now() - start;
          }
        };
      }
      const el = document.querySelector("#board canvas")!;
      const rect = el.getBoundingClientRect();
      const intervals: number[] = [];
      let previous = performance.now();
      try {
        for (let i = 0; i < 60; i++) {
          // Presence churn must not rebuild an unchanged remote editor or settle the camera.
          board.awareness.setLocalStateField("cursor", { x: i, y: i });
          el.dispatchEvent(
            new WheelEvent("wheel", {
              deltaY: i % 2 ? 2 : -2,
              bubbles: true,
              cancelable: true,
              clientX: rect.left + rect.width / 2,
              clientY: rect.top + rect.height / 2,
            }),
          );
          await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
          const now = performance.now();
          intervals.push(now - previous);
          previous = now;
        }
      } finally {
        for (const [name, original] of originals) layer[name] = original;
      }
      intervals.sort((a, b) => a - b);
      return {
        methods,
        frames: intervals.length,
        p50: intervals[30],
        p95: intervals[57],
        max: intervals[59],
      };
    });
    console.log("zoom with peer editor:", JSON.stringify(profile));
    const after = await cdp.send("Performance.getMetrics");
    const cpu = await cdp.send("Profiler.stop");
    const metrics = Object.fromEntries(
      after.metrics.map((m) => [
        m.name,
        m.value - (before.metrics.find((b) => b.name === m.name)?.value ?? 0),
      ]),
    );
    console.log("Chrome work:", JSON.stringify(metrics));
    await info.attach("zoom.cpuprofile", {
      body: JSON.stringify(cpu.profile),
      contentType: "application/json",
    });
    await info.attach("chrome-metrics.json", {
      body: JSON.stringify(metrics, null, 2),
      contentType: "application/json",
    });
    await info.attach("zoom-profile.json", {
      body: JSON.stringify(profile, null, 2),
      contentType: "application/json",
    });
    // A stationary peer editor must not force thousands of objects to relayout on every wheel frame.
    expect(profile.methods.recull!.calls).toBeLessThan(5);
    expect(profile.methods.layout!.calls).toBeLessThan(100);
    // Seconds of style work / presented frames: generous 5 ms/frame, versus ~95 ms
    // before grid isolation. This measures actual browser work, not scheduler delays.
    expect(metrics.RecalcStyleDuration! / profile.frames).toBeLessThan(0.005);
    expect(metrics.LayoutCount).toBeLessThan(5);

    await b.page.evaluate(() => {
      const board = (window as unknown as ProfileWindow).__komuboard;
      board.awareness.setLocalStateField("textedit", {
        id: "b0",
        x: 0,
        y: 0,
        width: 180,
        fontSize: 16,
        fontFamily: "Inter",
        runs: [{ text: "Updated while zooming" }],
      });
    });
    await expect(a.page.locator(".komu-text-remote")).toHaveText("Updated while zooming");
    await b.page.evaluate(() => {
      const board = (window as unknown as ProfileWindow).__komuboard;
      board.doc
        .getMap("objects")
        .get("b0")
        .set("runs", [{ text: "Committed after zoom" }]);
      board.awareness.setLocalStateField("textedit", null);
    });
    await expect(a.page.locator(".komu-text-remote")).toHaveCount(0);
    await expect(a.page.locator('.text-layer [data-id="b0"]')).toHaveText("Committed after zoom");
  } finally {
    await a.close();
    await b.close();
  }
});
