import { expect, test } from "@playwright/test";
import { type BoardWindow, connectPeer, drawStroke, objectIds, uniqueRoom } from "./helpers";

/**
 * Characterizes the board camera (zoom/pan): a stroke's *content-relative* rect is
 * world-space, so it must stay fixed while the camera zooms or pans — only the screen
 * projection changes. Guards the ViewportController extraction against coordinate drift.
 */

const rectOf = (page: import("@playwright/test").Page, id: string) =>
  page.evaluate(
    (id) => (window as unknown as BoardWindow).__komuboard.canvas!.nodeContentRect(id),
    id,
  );
const zoomOf = (page: import("@playwright/test").Page) =>
  page.evaluate(() => (window as unknown as BoardWindow).__komuboard.canvas!.getZoomPercent());

test("grid follows zoom and pan without inheriting camera variables into content", async ({
  browser,
}) => {
  const { page, close } = await connectPeer(browser, uniqueRoom("grid"));
  try {
    const checkGrid = async () => {
      const result = await page.evaluate(() => {
        const canvas = (
          window as unknown as {
            __komuboard: {
              canvas: {
                stage: { x(): number; y(): number; scaleX(): number };
              };
            };
          }
        ).__komuboard.canvas;
        const board = document.querySelector<HTMLElement>("#board")!;
        const grid = board.querySelector<HTMLElement>(":scope > .canvas-grid")!;
        const css = getComputedStyle(grid),
          s = canvas.stage.scaleX();
        const fine = 24 * s * 2 ** Math.floor(Math.log2(1 / s));
        const child = getComputedStyle(board.querySelector(".text-layer")!);
        return {
          fine: parseFloat(css.getPropertyValue("--grid-fine")),
          expectedFine: fine,
          x: parseFloat(css.getPropertyValue("--gx-fine")),
          expectedX: canvas.stage.x() - fine / 2,
          y: parseFloat(css.getPropertyValue("--gy-fine")),
          expectedY: canvas.stage.y() - fine / 2,
          inherited: child.getPropertyValue("--grid-fine"),
          image: css.backgroundImage,
        };
      });
      expect(result.fine).toBeCloseTo(result.expectedFine, 3);
      expect(result.x).toBeCloseTo(result.expectedX, 3);
      expect(result.y).toBeCloseTo(result.expectedY, 3);
      expect(result.inherited).toBe("");
      return result.image;
    };
    expect(await checkGrid()).toContain("radial-gradient");
    await page.mouse.move(500, 350);
    await page.keyboard.down("Control");
    await page.mouse.wheel(0, -80);
    await page.keyboard.up("Control");
    await page.waitForTimeout(200);
    await checkGrid();
    await page.keyboard.press("h");
    await page.mouse.down();
    await page.mouse.move(570, 400);
    await page.mouse.up();
    await page.waitForTimeout(200);
    await checkGrid();
    await page.locator("#board").evaluate((el) => {
      (el as HTMLElement).dataset.grid = "lines";
    });
    expect(await checkGrid()).toContain("linear-gradient");
  } finally {
    await close();
  }
});

test("viewport: wheel-zoom and pan keep world geometry fixed", async ({ browser }) => {
  const { page, close } = await connectPeer(browser, uniqueRoom("vp"));

  const { cx, cy } = await drawStroke(page);
  const [id] = await objectIds(page);
  expect(id).toBeTruthy();

  const r0 = await rectOf(page, id);
  const z0 = await zoomOf(page);
  expect(r0).not.toBeNull();

  // Wheel-zoom in over the canvas centre — zoom % changes, world rect does not.
  await page.mouse.move(cx, cy);
  await page.keyboard.down("Control");
  await page.mouse.wheel(0, -200);
  await page.keyboard.up("Control");
  const z1 = await zoomOf(page);
  expect(z1).toBeGreaterThan(z0);
  const r1 = await rectOf(page, id);
  expect(Math.abs(r1!.x - r0!.x)).toBeLessThan(0.5);
  expect(Math.abs(r1!.y - r0!.y)).toBeLessThan(0.5);
  expect(Math.abs(r1!.width - r0!.width)).toBeLessThan(0.5);

  // Hand-pan — also world-invariant.
  await page.keyboard.press("h");
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx + 100, cy + 60);
  await page.mouse.move(cx + 140, cy + 90);
  await page.mouse.up();
  const r2 = await rectOf(page, id);
  expect(Math.abs(r2!.x - r0!.x)).toBeLessThan(0.5);
  expect(Math.abs(r2!.y - r0!.y)).toBeLessThan(0.5);

  // Still selectable after the camera moved (hit-testing survives the transform).
  await page.keyboard.press("v");
  await page.keyboard.press("Control+a");
  expect(await rectOf(page, id)).not.toBeNull();

  await close();
});
