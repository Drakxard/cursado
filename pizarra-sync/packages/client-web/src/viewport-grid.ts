type GridView = { scale: number; x: number; y: number; width: number; height: number };

/** Draw the background once per camera frame, without rasterizing viewport-sized CSS gradients. */
export class ViewportGrid {
  readonly element = document.createElement('canvas');
  private readonly tile = document.createElement('canvas');
  private readonly observer: MutationObserver;
  private view: GridView | undefined;
  private color: string | undefined;

  constructor(private readonly container: HTMLElement) {
    this.element.className = 'canvas-grid';
    this.element.setAttribute('aria-hidden', 'true');
    container.prepend(this.element);
    this.observer = new MutationObserver(() => {
      this.color = undefined;
      if (this.view) this.draw(this.view);
    });
    this.observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'style', 'class'] });
    this.observer.observe(container, { attributes: true, attributeFilter: ['data-grid'] });
  }

  draw(view: GridView): void {
    this.view = view;
    const { scale, x, y, width, height } = view;
    const ratio = window.devicePixelRatio || 1;
    const pixelWidth = Math.max(1, Math.ceil(width * ratio)), pixelHeight = Math.max(1, Math.ceil(height * ratio));
    const canvas = this.element;
    if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
      canvas.width = pixelWidth; canvas.height = pixelHeight;
    }
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    this.color ??= getComputedStyle(canvas).color;
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = this.color; ctx.strokeStyle = this.color;
    const lod = Math.log2(1 / scale), step = Math.floor(lod);
    const fine = 24 * scale * 2 ** step, fade = 1 - (lod - step);
    const lines = this.container.dataset.grid === 'lines';
    const tier = (spacing: number, alpha: number) => {
      ctx.globalAlpha = alpha;
      const ox = ((x % spacing) + spacing) % spacing, oy = ((y % spacing) + spacing) % spacing;
      ctx.beginPath();
      if (lines) {
        ctx.lineWidth = 1;
        for (let px = ox; px <= width; px += spacing) { ctx.moveTo(px, 0); ctx.lineTo(px, height); }
        for (let py = oy; py <= height; py += spacing) { ctx.moveTo(0, py); ctx.lineTo(width, py); }
        ctx.stroke();
      } else {
        // Rasterize a single small tile, then repeat it; no per-dot paths or gradients.
        const size = Math.ceil(spacing * ratio);
        this.tile.width = this.tile.height = size;
        const tile = this.tile.getContext('2d')!;
        tile.fillStyle = this.color!;
        tile.beginPath(); tile.arc(size / 2, size / 2, 1.6 * size / spacing, 0, Math.PI * 2); tile.fill();
        const pattern = ctx.createPattern(this.tile, 'repeat');
        if (!pattern) return;
        pattern.setTransform(new DOMMatrix().translate(ox - spacing / 2, oy - spacing / 2).scale(spacing / size));
        ctx.fillStyle = pattern; ctx.fillRect(0, 0, width, height);
      }
    };
    tier(fine * 2, 1); tier(fine, fade);
    ctx.globalAlpha = 1;
  }

  destroy(): void {
    this.observer.disconnect(); this.element.remove();
    this.element.width = this.element.height = this.tile.width = this.tile.height = 0;
  }
}
