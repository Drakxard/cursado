// Client helpers for uploaded images. Bytes live in R2 (served by the worker); the Yjs doc holds only
// the R2 key, which we resolve to a serve URL here — keyed off the same worker host the realtime
// connection uses, so it works in dev (separate vite + worker origins) and prod alike.
import { MAX_UPLOAD_BYTES, UPLOAD_IMAGE_TYPES, UPLOAD_IMAGE_EXT } from "@komuboard/shared";
import { createUploadQueue } from './upload-queue';

import { t } from "./i18n";

const WORKER_HOST = import.meta.env.VITE_WORKER_HOST ?? "127.0.0.1:8787";

/** Resolve an image object's R2 key to the worker's serve URL (GET /img/:key). */
export function imageSrcUrl(key: string): string {
  return `${WORKER_HOST.includes("127.0.0.1") || WORKER_HOST.includes("localhost") ? location.protocol : "https:"}//${WORKER_HOST}/img/${key}`;
}

const MAX_DIM = 2048; // downscale anything larger so phone photos don't bloat the board / R2
const ACCEPTED = new Set<string>(UPLOAD_IMAGE_TYPES); // the shared worker+client allow-list

export interface UploadResult {
  /** R2 content-hash key (store this in the image object's `src`). */
  key: string;
  /** The image's intrinsic dimensions — used to size the placed box (aspect-correct). */
  width: number;
  height: number;
}

/** A user-presentable failure (bad type / too large / network). The message is safe to show in a toast. */
export class UploadError extends Error {
  constructor(message: string, public readonly status?: number, public readonly retryable = false) { super(message) }
}
const queuedUpload = createUploadQueue();

function uploadUrl(): string {
  return `${WORKER_HOST.includes("127.0.0.1") || WORKER_HOST.includes("localhost") ? location.protocol : "https:"}//${WORKER_HOST}/upload`;
}

/** Decode a file far enough to read its pixels + intrinsic size. Prefers createImageBitmap (fast,
 *  off-thread) and falls back to an <img> for browsers/types it can't decode. */
async function decode(
  file: Blob,
): Promise<{ source: CanvasImageSource; width: number; height: number }> {
  if (typeof createImageBitmap === "function") {
    try {
      const bmp = await createImageBitmap(file);
      return { source: bmp, width: bmp.width, height: bmp.height };
    } catch {
      /* fall through to the <img> path (e.g. a format createImageBitmap rejects) */
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return { source: img, width: img.naturalWidth, height: img.naturalHeight };
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Validate, optionally downscale, and upload an image file to R2 via the worker. Returns the stored
 *  key + the image's intrinsic size. Throws UploadError with a user-facing message on any failure. */
export async function uploadImage(file: File, options: { reuseExisting?: boolean; onWait?: (ms: number) => void } = {}): Promise<UploadResult> {
  if (!ACCEPTED.has(file.type)) {
    throw new UploadError(t("toast.imageTypeUnsupported"));
  }
  const isGif = file.type === "image/gif"; // canvas re-encoding would flatten the animation → never downscale

  const { source, width, height } = await decode(file);
  if (!width || !height) throw new UploadError(t("toast.imageEmpty"));

  let blob: Blob = file;
  let contentType = file.type;
  const tooLarge = Math.max(width, height) > MAX_DIM || file.size > MAX_UPLOAD_BYTES;
  if (!isGif && tooLarge) {
    const scale = Math.min(1, MAX_DIM / Math.max(width, height));
    const w = Math.max(1, Math.round(width * scale));
    const h = Math.max(1, Math.round(height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new UploadError(t("toast.imageProcessFailed"));
    ctx.drawImage(source, 0, 0, w, h);
    // PNG keeps transparency; everything else re-encodes as WebP (smaller for photos).
    contentType = file.type === "image/png" ? "image/png" : "image/webp";
    blob = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new UploadError(t("toast.imageProcessFailed")))),
        contentType,
        0.9,
      ),
    );
  }
  if ("close" in source && typeof source.close === "function") source.close(); // release the ImageBitmap

  if (blob.size > MAX_UPLOAD_BYTES) {
    throw new UploadError(t("toast.imageTooLarge"));
  }

  if (options.reuseExisting) {
    const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
    const hash = [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
    const key = `${hash}.${UPLOAD_IMAGE_EXT[contentType]}`;
    try {
      if ((await fetch(imageSrcUrl(key), { method: 'HEAD' })).ok) return { key, width, height };
    } catch { /* The queued upload will report a recoverable network error. */ }
  }

  let res: Response;
  try {
    res = await queuedUpload(uploadUrl(), {
      method: "POST",
      headers: { "content-type": contentType },
      body: blob,
    }, options.onWait);
  } catch {
    throw new UploadError(t("toast.uploadFailedConnection"), 0, true);
  }
  if (!res.ok) throw new UploadError(res.status === 429
    ? 'El servidor sigue limitando las subidas. Podés reintentar sin perder lo que ya se subió. (HTTP 429)'
    : `${t("toast.uploadFailed")} (HTTP ${res.status})`, res.status, res.status === 429 || res.status >= 500);
  const { key } = (await res.json()) as { key?: string };
  if (!key) throw new UploadError(t("toast.uploadFailed"));
  return { key, width, height };
}
