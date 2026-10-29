import { expect, test } from "@playwright/test";
import { calibrate, connectPeer, drawStroke, injectSticky, objectIds, uniqueRoom } from "./helpers";

test("mobile keeps the editable room title and sharing controls on screen", async ({ browser }) => {
  const mobileRoom = uniqueRoom("mobile-title");
  const mobileTitle = `Mi clase ${mobileRoom}`;
  const a = await connectPeer(browser, mobileRoom, {
    touch: true,
    viewport: { width: 390, height: 844 },
  });
  try {
    const title = a.page.locator(".room-pill [contenteditable]");
    await expect(title).toBeVisible();
    const share = (await a.page.locator('[data-testid="share"]').boundingBox())!;
    const titleRect = (await title.boundingBox())!;
    expect(share.x + share.width).toBeLessThanOrEqual(390);
    expect(titleRect.width).toBeGreaterThan(40);
    expect(titleRect.x).toBeGreaterThanOrEqual(0);
    await title.fill(mobileTitle);
    await title.press("Enter");
    await expect(title).toHaveText(mobileTitle);
    await a.page.screenshot({ path: "test-results/mobile-controls.png" });
  } finally {
    await a.close();
  }
});

test("middle-button panning preserves the drawing tool and creates no stroke", async ({
  browser,
}) => {
  const a = await connectPeer(browser, uniqueRoom("middle-pan"));
  try {
    await a.page.keyboard.press("p");
    const initial = await calibrate(a.page);
    const box = (await a.page.locator("#board").boundingBox())!;
    const x = box.x + box.width / 2;
    const y = box.y + box.height / 2;
    await a.page.mouse.move(x, y);
    await a.page.mouse.down({ button: "middle" });
    await a.page.mouse.move(x + 120, y + 70, { steps: 5 });
    await a.page.mouse.up({ button: "middle" });
    const after = await calibrate(a.page);
    expect(after.ox - initial.ox).toBeCloseTo(120, 0);
    expect(after.oy - initial.oy).toBeCloseTo(70, 0);
    expect(await objectIds(a.page)).toEqual([]);
    // Draw without pressing a tool shortcut again: the previous tool must still be active.
    await a.page.mouse.move(x, y);
    await a.page.mouse.down();
    await a.page.mouse.move(x + 80, y + 30, { steps: 4 });
    await a.page.mouse.up();
    await expect.poll(() => objectIds(a.page)).toHaveLength(1);
  } finally {
    await a.close();
  }
});

test("room names update readable URLs while old and new links keep the same board; help is in the menu", async ({
  browser,
}) => {
  const room = uniqueRoom("room-title");
  const titleSuffix = Math.random().toString(36).slice(2, 8);
  const title = `Clase de biología ${titleSuffix}`;
  const slug = `clase-de-biologia-${titleSuffix}`;
  const a = await connectPeer(browser, room);
  const b = await connectPeer(browser, room);
  try {
    const url = a.page.url();
    await injectSticky(a.page, { id: "before-rename", x: 100, y: 100 });
    // Open Share before renaming as well: it must refresh its link on the next open.
    await a.page.locator('[data-testid="share"]').click();
    await a.page.keyboard.press("Escape");
    const name = a.page.locator(".room-pill [contenteditable]");
    await name.fill(title);
    await name.press("Enter");
    await expect(b.page.locator(".room-pill strong")).toHaveText(title);
    await expect(a.page).toHaveURL(new RegExp(`/${slug}$`));
    await expect(b.page).toHaveURL(new RegExp(`/${slug}$`));
    const renamedUrl = a.page.url();
    await a.page.locator('[data-testid="share"]').click();
    await expect(a.page.locator(".share-url")).toHaveValue(renamedUrl);
    await a.page.keyboard.press("Escape");
    await name.fill("Cancelar este cambio");
    await name.press("Escape");
    await expect(name).toHaveText(title);
    await a.page.reload();
    await expect(a.page.locator(".room-pill strong")).toHaveText(title);
    await expect.poll(() => objectIds(a.page)).toContain("before-rename");
    await b.page.goto(url); // An old query-string link must still open the populated board.
    await expect(b.page.locator(".room-pill strong")).toHaveText(title);
    await expect.poll(() => objectIds(b.page)).toContain("before-rename");
    await expect(b.page).toHaveURL(renamedUrl);
    await expect(a.page.locator("#help-btn")).toHaveCount(0);
    await a.page.locator("#nav-toggle").click();
    await a.page.locator('.app-menu [data-act="help"]').click();
    await expect(a.page.locator("dialog[open]")).toBeVisible();
  } finally {
    await a.close();
    await b.close();
  }
});

test("Ctrl+V pastes a real clipboard image once even after copying board objects", async ({
  browser,
}) => {
  const a = await connectPeer(browser, uniqueRoom("native-paste"), { clipboard: true });
  try {
    await drawStroke(a.page);
    await a.page.keyboard.press("v");
    await a.page.keyboard.press("Control+a");
    await a.page.keyboard.press("Control+c");
    await a.page.waitForTimeout(100);
    await a.page.evaluate(async () => {
      const canvas = document.createElement("canvas");
      canvas.width = 20;
      canvas.height = 20;
      canvas.getContext("2d")!.fillRect(0, 0, 20, 20);
      const blob = await new Promise<Blob>((resolve) => canvas.toBlob((blob) => resolve(blob!)));
      await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
    });
    await a.page.keyboard.press("Control+v");
    await expect(a.page.locator(".komu-image")).toHaveCount(1);
    await expect(a.page.locator(".komu-image img")).toHaveJSProperty("naturalWidth", 20);
    await expect.poll(() => objectIds(a.page)).toHaveLength(2);
    await a.page.waitForTimeout(500);
    expect(await objectIds(a.page)).toHaveLength(2);
  } finally {
    await a.close();
  }
});
