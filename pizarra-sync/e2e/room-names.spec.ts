import { expect, test } from "@playwright/test";
import { connectPeer, injectSticky, objectIds, uniqueRoom } from "./helpers";

test("an existing named board upgrades to a short link and its previous two-segment link still opens it", async ({
  browser,
}) => {
  const room = uniqueRoom("legacy-room");
  const title = uniqueRoom("nombre-anterior");
  const a = await connectPeer(browser, room);
  try {
    await injectSticky(a.page, { id: "legacy-content", x: 100, y: 100 });
    // Simulate the title-only metadata written by the previously published client.
    await a.page.evaluate((name) => {
      const doc = (
        window as unknown as {
          __komuboard: {
            doc: { getMap(key: string): { set(key: string, value: string): void } };
          };
        }
      ).__komuboard.doc;
      doc.getMap("metadata").set("title", name);
    }, title);
    await expect(a.page).toHaveURL(new RegExp(`/${title}$`));
    await a.page.goto(`/${room}/${title}`);
    await expect(a.page.locator(".room-pill strong")).toHaveText(title);
    await expect.poll(() => objectIds(a.page)).toContain("legacy-content");
    await expect(a.page).toHaveURL(new RegExp(`/${title}$`));
  } finally {
    await a.close();
  }
});

test("short names cannot redirect another board, even when claimed concurrently", async ({
  request,
}) => {
  const worker = process.env.E2E_WORKER_URL || "http://127.0.0.1:8787";
  const title = uniqueRoom("reserved-name");
  const ids = [uniqueRoom("owner-a"), uniqueRoom("owner-b")];
  const replies = await Promise.all(
    ids.map((roomId) =>
      request.post(`${worker}/rooms/rename`, {
        data: { roomId, title },
      }),
    ),
  );
  expect(replies.map((response) => response.status()).sort()).toEqual([200, 409]);
  const winner = replies.findIndex((response) => response.status() === 200);
  const resolved = await request.get(`${worker}/rooms/resolve?name=${title}`);
  expect((await resolved.json()).roomId).toBe(ids[winner]);
});

test("renaming twice leaves only the latest name visible and keeps the populated board", async ({
  browser,
}) => {
  const room = uniqueRoom("rename-twice");
  const a = await connectPeer(browser, room);
  const b = await connectPeer(browser, uniqueRoom("different-board"));
  const first = uniqueRoom("primera-clase");
  const second = uniqueRoom("nueva-clase");
  try {
    await injectSticky(a.page, { id: "retained", x: 100, y: 100 });
    const name = a.page.locator(".room-pill [contenteditable]");
    await name.fill(first);
    await name.press("Enter");
    await expect(a.page).toHaveURL(new RegExp(`/${first}$`));
    await name.fill(second);
    await name.press("Enter");
    await expect(a.page).toHaveURL(new RegExp(`/${second}$`));
    expect(new URL(a.page.url()).pathname).toBe(`/${second}`);
    expect(new URL(a.page.url()).search).toBe("");
    const otherUrl = b.page.url();
    const otherName = b.page.locator(".room-pill [contenteditable]");
    await otherName.fill(second);
    await otherName.press("Enter");
    await expect(b.page.locator(".komu-toast")).toContainText("ya está en uso");
    expect(b.page.url()).toBe(otherUrl);
    expect(await objectIds(b.page)).toEqual([]);
    await a.page.reload();
    await expect(a.page.locator(".room-pill strong")).toHaveText(second);
    await expect.poll(() => objectIds(a.page)).toContain("retained");
    await expect(a.page).toHaveURL(new RegExp(`/${second}$`));
  } finally {
    await a.close();
    await b.close();
  }
});
