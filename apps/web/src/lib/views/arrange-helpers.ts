import type { Layer, Section, TriggerBinding } from '@ledrums/core';

export function bindingFor(
  bindings: TriggerBinding[],
  drumId: string,
  slot: number,
): TriggerBinding | null {
  return bindings.find((binding) => binding.drumId === drumId && binding.slot === slot) ?? null;
}

export function describeBinding(binding: TriggerBinding | null, layers: Layer[]): string {
  if (!binding) return 'Empty';
  const layer = layers.find((candidate) => candidate.id === binding.layerId);
  const clip = layer?.clips.find((candidate) => candidate.id === binding.clipId);
  return `${layer?.name || binding.layerId} -> ${clip?.name || binding.clipId}`;
}

export function selectedLayerClip(section: Section, layerId: string): string {
  return section.layerClips.find((entry) => entry.layerId === layerId)?.clipId ?? '';
}

export function makeId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}
