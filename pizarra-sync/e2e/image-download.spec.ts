import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { connectPeer, injectImage, injectSticky, objJSON, uniqueRoom } from "./helpers";

test("image context menu downloads original bytes, including locked images, and retries failures", async ({ browser }, info) => {
  const { page, close } = await connectPeer(browser, uniqueRoom("image-download"));
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="80"><rect width="120" height="80" fill="red"/></svg>';
  let fail = false;
  try {
    await page.context().route("**/img/download-test.svg", route => {
      if (fail && route.request().resourceType() === "fetch") return route.fulfill({ status: 503, body: "Unavailable" });
      return route.fulfill({ contentType: "image/svg+xml", headers: { "Access-Control-Allow-Origin": "*" }, body: svg });
    });
    await injectImage(page, { id: "download", src: "download-test.svg", x: 0, y: 0, width: 120, height: 80 });
    const image = page.locator('.komu-image[data-id="download"]');
    await expect(image).toBeVisible();
    const openMenu = async () => {
      const box = (await image.boundingBox())!;
      await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2, { button: "right" });
    };
    await openMenu();
    await expect(page.locator('.ctx-item[data-act="downloadImage"]')).toBeVisible();
    await page.locator('.ctx-item[data-act="toggleLock"]').click();
    const before = await objJSON(page, "download");
    expect(before?.locked).toBe(true);
    await openMenu();
    fail = true;
    await page.locator('.ctx-item[data-act="downloadImage"]').click();
    await expect(page.locator(".komu-toast")).toContainText(/download|descargar/i);
    await expect(page.locator(".ctx-menu")).toHaveCount(0);
    fail = false;
    await openMenu();
    const pending = page.waitForEvent("download");
    await page.locator('.ctx-item[data-act="downloadImage"]').click();
    const download = await pending;
    expect(download.suggestedFilename()).toBe("imagen.svg");
    const output = info.outputPath("imagen.svg");
    await download.saveAs(output);
    expect(await readFile(output, "utf8")).toBe(svg);
    expect(await objJSON(page, "download")).toEqual(before);
    await injectSticky(page, { id: "note", x: 200, y: 0 });
    const note = page.locator('.komu-text[data-id="note"]');
    await expect(note).toBeVisible();
    const box = (await note.boundingBox())!;
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2, { button: "right" });
    await expect(page.locator(".ctx-menu")).toBeVisible();
    await expect(page.locator('.ctx-item[data-act="downloadImage"]')).toHaveCount(0);
    await page.keyboard.press("Escape");
    await page.locator("#board").click({ button: "right", position: { x: 150, y: 200 } });
    await expect(page.locator(".ctx-menu")).toBeVisible();
    await expect(page.locator('.ctx-item[data-act="downloadImage"]')).toHaveCount(0);
  } finally { await close(); }
});
