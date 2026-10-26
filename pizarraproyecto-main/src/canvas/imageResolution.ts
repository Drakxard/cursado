export const PREVIEW_LEVELS = [256, 512, 1024, 2048, 4096] as const

export function previewLevel(side: number, previous?: number): number {
  // Separate upward and downward thresholds so tiny zoom reversals do not thrash.
  if (previous && side <= previous * 1.15 && side > previous * .425) return previous
  return PREVIEW_LEVELS.find(level => level >= side) ?? 4096
}
