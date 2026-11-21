/** Keeps the original gesture so Shift can be toggled without losing freehand ink. */
export class PenGesture {
  readonly raw: [number, number, ...number[]];
  private axis: 'x' | 'y' = 'x';
  constructor(x: number, y: number) { this.raw = [x, y]; }
  move(x: number, y: number): void { this.raw.push(x, y); }
  points(shift: boolean): number[] {
    if (!shift || this.raw.length < 4) return [...this.raw];
    const [x, y] = this.raw;
    const endX = this.raw[this.raw.length - 2]!, endY = this.raw[this.raw.length - 1]!;
    const dx = Math.abs(endX - x), dy = Math.abs(endY - y);
    if (dx !== dy) this.axis = dx > dy ? 'x' : 'y';
    return this.axis === 'x' ? [x, y, endX, y] : [x, y, x, endY];
  }
}
