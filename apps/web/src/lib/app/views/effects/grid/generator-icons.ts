/* Generator → lucide icon, for the grid cell face and the Generator picker. Keyed by kind so the
   compiler proves every Generator has one. Names follow each core GeneratorDef's `icon`, except
   Noise: core gives it `waves` like Wave, and two identical glyphs side by side in the picker
   defeat the point of an icon. */
import type { Component } from 'svelte';
import { effectChain } from '@ledrums/core';
import Square from '@lucide/svelte/icons/square';
import Rainbow from '@lucide/svelte/icons/rainbow';
import Waves from '@lucide/svelte/icons/waves';
import Cloudy from '@lucide/svelte/icons/cloudy';
import Sparkles from '@lucide/svelte/icons/sparkles';
import Grid3x3 from '@lucide/svelte/icons/grid-3x3';
import AudioLines from '@lucide/svelte/icons/audio-lines';
import Zap from '@lucide/svelte/icons/zap';
import Image from '@lucide/svelte/icons/image';
import Scissors from '@lucide/svelte/icons/scissors';
import Layers from '@lucide/svelte/icons/layers';
import CircleDot from '@lucide/svelte/icons/circle-dot';

type GeneratorKind = effectChain.GeneratorKind;

export const GENERATOR_ICONS: Readonly<Record<GeneratorKind, Component>> = {
  solid: Square,
  gradient: Rainbow,
  wave: Waves,
  noise: Cloudy,
  particles: Sparkles,
  pattern: Grid3x3,
  meter: AudioLines,
  lightning: Zap,
  scene: Image,
  splice: Scissors,
  slice: Layers,
  dot: CircleDot,
};

export interface GeneratorChoice {
  kind: GeneratorKind;
  label: string;
  description: string;
  icon: Component;
}

/** The picker's list: every Generator core can resolve, in core's display order. */
export function generatorChoices(): GeneratorChoice[] {
  return effectChain.listGenerators().map((def) => ({
    kind: def.id,
    label: def.label,
    description: def.description ?? '',
    icon: GENERATOR_ICONS[def.id],
  }));
}

/** A Generator's display name ("Wave"); the kind id when core does not know it. */
export function generatorLabel(kind: GeneratorKind): string {
  return effectChain.getGeneratorDef(kind)?.label ?? kind;
}
