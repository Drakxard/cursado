// Application policy, kept separate from the vendored PDF.js implementation.
export const BOARD_PDF_CACHE_PAGES = 3;
export const BOARD_PDF_CACHE_BYTES = 64 * 1024 * 1024;

export class BoardPageViewBuffer {
  #views = new Set();
  #visible = new Set();
  #size = BOARD_PDF_CACHE_PAGES;

  push(view) {
    this.#views.delete(view);
    this.#views.add(view);
    // pagerender fires before canvas allocation. Protect the incoming render
    // until pagerendered accounts for its actual canvas and detail surfaces.
    this.trim(view);
  }
  resize(size, visible = null) {
    this.#size = size;
    if (visible) this.#visible = new Set(visible);
    this.trim();
  }
  has(view) { return this.#views.has(view); }
  [Symbol.iterator]() { return this.#views.values(); }
  get bytes() {
    let bytes = 0;
    for (const view of this.#views) {
      for (const canvas of view.div.querySelectorAll('canvas')) {
        bytes += canvas.width * canvas.height * 4;
      }
    }
    return bytes;
  }
  trim(rendering = null) {
    let bytes = this.bytes;
    for (const view of this.#views) {
      if (this.#views.size <= this.#size && bytes <= BOARD_PDF_CACHE_BYTES) break;
      if (view === rendering || this.#visible.has(view.id)) continue;
      let released = 0;
      for (const canvas of view.div.querySelectorAll('canvas')) released += canvas.width * canvas.height * 4;
      this.#views.delete(view);
      view.destroy();
      bytes -= released;
    }
  }
}
