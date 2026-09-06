export type NavArrowDirection = 'prev' | 'next';

export function navArrowLabel(direction: NavArrowDirection, unit: string): string {
  return `${direction === 'prev' ? 'Previous' : 'Next'} ${unit}`;
}

export function navArrowTip(
  direction: NavArrowDirection,
  unit: string,
  disabled: boolean,
  binding?: string | null,
  invite?: string | null,
): string {
  return [navArrowLabel(direction, unit), disabled ? `no ${unit} that way` : null, binding || invite || null]
    .filter(Boolean)
    .join(' · ');
}
