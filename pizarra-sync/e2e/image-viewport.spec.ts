import { expect, test } from "@playwright/test";
import { calibrate, connectPeer, injectImage, objJSON, uniqueRoom, worldToScreen } from "./helpers";

test("images follow camera zoom and pan without changing shared geometry", async ({ browser }) => {
  const room = uniqueRoom("image-camera");
  const a = await connectPeer(browser, room);
  const b = await connectPeer(browser, room);
  try {
    await injectImage(a.page, {
      id: "camera-image",
      x: 500,
      y: 300,
      width: 200,
      height: 150,
      src: "camera-test-placeholder.png",
    });
    const image = a.page.locator('.komu-image[data-id="camera-image"]');
    const peerImage = b.page.locator('.komu-image[data-id="camera-image"]');
    await expect(image).toBeVisible();
    await expect(peerImage).toBeVisible();
    const original = await objJSON(a.page, "camera-image");
    const peerRect = await peerImage.boundingBox();

    for (const scale of [2, 0.5, 1]) {
      await a.page.evaluate((value) => {
        const canvas = (
          window as unknown as {
            __komuboard: { canvas: { zoomTo(scale: number): void } };
          }
        ).__komuboard.canvas;
        canvas.zoomTo(value);
      }, scale);
      await expect.poll(async () => (await image.boundingBox())?.width).toBeCloseTo(200 * scale, 0);
      await expect
        .poll(async () => (await image.boundingBox())?.height)
        .toBeCloseTo(150 * scale, 0);
      const position = worldToScreen(await calibrate(a.page), 500, 300);
      await expect.poll(async () => (await image.boundingBox())?.x).toBeCloseTo(position.x, 0);
      await expect.poll(async () => (await image.boundingBox())?.y).toBeCloseTo(position.y, 0);
      expect(await objJSON(a.page, "camera-image")).toEqual(original);
      expect(await objJSON(b.page, "camera-image")).toEqual(original);
      expect(await peerImage.boundingBox()).toEqual(peerRect);
    }

    const beforePan = (await image.boundingBox())!;
    const board = (await a.page.locator("#board").boundingBox())!;
    await a.page.keyboard.press("h");
    const x = board.x + board.width / 2;
    const y = board.y + board.height / 2;
    await a.page.mouse.move(x, y);
    await a.page.mouse.down();
    await a.page.mouse.move(x + 80, y + 40, { steps: 5 });
    await a.page.mouse.up();
    await expect.poll(async () => (await image.boundingBox())!.x - beforePan.x).toBeCloseTo(80, 0);
    await expect.poll(async () => (await image.boundingBox())!.y - beforePan.y).toBeCloseTo(40, 0);
    expect(await objJSON(a.page, "camera-image")).toEqual(original);
    expect(await objJSON(b.page, "camera-image")).toEqual(original);
  } finally {
    await a.close();
    await b.close();
  }
});
