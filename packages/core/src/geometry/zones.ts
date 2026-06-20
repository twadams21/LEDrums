/**
 * Drum zones (plan A4). The design lists five zones (center / edge / rim-tip /
 * rim-shoulder / shell); MVP collapses rim-tip + rim-shoulder into `rim`, mapping
 * the four zones onto normalized hoop height (0 = head side, 1 = shell side).
 */
export const ZONES = ['center', 'edge', 'rim', 'shell'] as const;
export type Zone = (typeof ZONES)[number];

/** Classify a pixel into a zone from its normalized hoop position (0..1). */
export function classifyZone(normHoop: number): Zone {
  if (normHoop < 0.25) return 'center';
  if (normHoop < 0.5) return 'edge';
  if (normHoop < 0.75) return 'rim';
  return 'shell';
}
