import { expect, test } from "@playwright/test";
import {
  type BoardWindow,
  connectPeer,
  injectImage,
  injectSticky,
  objectIds,
  objJSON,
  uniqueRoom,
} from "./helpers";

test("concurrent edits converge, preserve independent additions and stay isolated from another room", async ({
  browser,
}) => {
  const room = uniqueRoom("concurrent");
  const a = await connectPeer(browser, room);
  const b = await connectPeer(browser, room);
  const other = await connectPeer(browser, uniqueRoom("isolated"));
  try {
    await injectSticky(a.page, { id: "shared", x: 0, y: 0 });
    await expect.poll(() => objectIds(b.page)).toContain("shared");

    for (const peer of [a, b]) {
      await peer.page.evaluate(() => {
        (window as unknown as BoardWindow).__komuboard.provider.disconnect();
      });
    }
    // Both edit the same existing Y.Map while disconnected: a real concurrent conflict.
    for (const [peer, x] of [
      [a, 100],
      [b, 200],
    ] as const) {
      await peer.page.evaluate((value) => {
        const doc = (window as unknown as BoardWindow).__komuboard.doc;
        const shape = doc.getMap("objects").get("shared") as unknown as {
          set(key: string, value: number): void;
        };
        doc.transact(() => shape.set("x", value));
      }, x);
    }
    await injectSticky(a.page, { id: "from-a", x: 300, y: 100 });
    await injectSticky(b.page, { id: "from-b", x: 500, y: 100 });
    for (const peer of [a, b]) {
      await peer.page.evaluate(() => {
        (window as unknown as BoardWindow).__komuboard.provider.connect();
      });
    }
    for (const peer of [a, b]) {
      await expect
        .poll(async () => (await objectIds(peer.page)).sort())
        .toEqual(["from-a", "from-b", "shared"]);
    }
    await expect.poll(() => objJSON(a.page, "shared")).toEqual(await objJSON(b.page, "shared"));
    expect(await objectIds(other.page)).toEqual([]);
  } finally {
    await a.close();
    await b.close();
    await other.close();
  }
});

test("an uploaded image reaches another peer and survives every client leaving", async ({
  browser,
  request,
}) => {
  const worker = process.env.E2E_WORKER_URL || "http://127.0.0.1:8787";
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
    "base64",
  );
  const upload = await request.post(`${worker}/upload`, {
    headers: { "content-type": "image/png" },
    data: png,
  });
  expect(upload.ok()).toBeTruthy();
  const { key } = await upload.json();
  const room = uniqueRoom("image-retain");
  const a = await connectPeer(browser, room);
  const b = await connectPeer(browser, room);
  await injectImage(a.page, {
    id: "retained-image",
    x: 50,
    y: 50,
    width: 200,
    height: 150,
    src: key,
  });
  await expect.poll(() => objectIds(b.page)).toContain("retained-image");
  await expect(b.page.locator(".komu-image img")).toHaveJSProperty("naturalWidth", 1);
  await a.close();
  await b.close();
  const fresh = await connectPeer(browser, room);
  try {
    await expect.poll(() => objectIds(fresh.page)).toContain("retained-image");
    await expect(fresh.page.locator(".komu-image img")).toHaveJSProperty("naturalWidth", 1);
  } finally {
    await fresh.close();
  }
});
