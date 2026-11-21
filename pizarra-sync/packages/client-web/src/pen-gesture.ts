/** Shift previews an axis-aligned segment; releasing it fixes that segment in place. */
export class PenGesture {
  readonly raw: [number, number, ...number[]];
  private axis: 'x' | 'y' = 'x';
  private constrained = false;
  private segmentStart = 0;
  private offset = { x: 0, y: 0 };
  constructor(x: number, y: number) { this.raw = [x, y]; }
  move(x: number, y: number): void { this.raw.push(x + this.offset.x, y + this.offset.y); }
  points(shift: boolean): number[] {
    const wasConstrained = this.constrained;
    this.constrained = shift;
    if ((!shift && !wasConstrained) || this.raw.length - this.segmentStart < 4) return [...this.raw];
    const x = this.raw[this.segmentStart]!, y = this.raw[this.segmentStart + 1]!;
    const endX = this.raw[this.raw.length - 2]!, endY = this.raw[this.raw.length - 1]!;
    const dx = Math.abs(endX - x), dy = Math.abs(endY - y);
    if (dx !== dy) this.axis = dx > dy ? 'x' : 'y';
    const tipX = this.axis === 'x' ? endX : x, tipY = this.axis === 'x' ? y : endY;
    const points = [...this.raw.slice(0, this.segmentStart + 2), tipX, tipY];
    if (!shift) {
      this.offset.x += tipX - endX; this.offset.y += tipY - endY;
      this.raw.splice(this.segmentStart + 2, this.raw.length, tipX, tipY);
      this.segmentStart = this.raw.length - 2;
    }
    return points;
  }
}
