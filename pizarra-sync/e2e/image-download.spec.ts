import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { connectPeer, injectImage, injectSticky, objJSON, uniqueRoom } from "./helpers";

for (const source of ["@startmindmap\n* Root\n** Child\n@endmindmap", "mindmap\n  root((Root))\n    Child"]) {
  test(`diagram download uses the complete image while the board displays its root (${source.startsWith('mindmap') ? 'Mermaid' : 'PlantUML'})`, async ({ browser }, info) => {
    const { page, close } = await connectPeer(browser, uniqueRoom('diagram-download'));
    const full = '<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600"><rect width="800" height="600" fill="blue"/><text x="40" y="40">Complete diagram</text></svg>';
    try {
      await page.route('**/img/root-diagram.svg', route => route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="60"><rect width="100" height="60" fill="red"/></svg>' }));
      await page.route('**/img/complete-diagram.svg', route => route.fulfill({ contentType: 'image/svg+xml', body: full }));
      await injectImage(page, { id: 'diagram', src: 'root-diagram.svg', x: 0, y: 0, width: 100, height: 60 });
      await page.evaluate(source => {
        const map = window.__komuboard!.doc.getMap('objects').get('diagram') as { set(k: string, v: unknown): void };
        map.set('plantumlSource', source);
        map.set('plantumlFullSrc', 'complete-diagram.svg');
      }, source);
      const root = page.locator('.komu-image[data-id="diagram"]');
      await expect(root).toBeVisible();
      expect(await root.locator('img').getAttribute('src')).toContain('root-diagram.svg');
      const before = await objJSON(page, 'diagram');
      const box = (await root.boundingBox())!;
      await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2, { button: 'right' });
      const pending = page.waitForEvent('download');
      await page.locator('.ctx-item[data-act="downloadImage"]').click();
      const download = await pending, output = info.outputPath('complete-diagram.svg');
      await download.saveAs(output);
      expect(await readFile(output, 'utf8')).toBe(full);
      expect(await objJSON(page, 'diagram')).toEqual(before);
    } finally { await close(); }
  });
}

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
