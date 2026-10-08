/* Lucide components for the Generator kinds, keyed by kind. The names follow core's
   `GeneratorDef.icon` (effect-chain/generators/*); a Record keyed by kind makes a new kind a
   type error here rather than a silently missing icon. */
import type { Component } from 'svelte';
import type { effectChain } from '@ledrums/core';
import Square from '@lucide/svelte/icons/square';
import Rainbow from '@lucide/svelte/icons/rainbow';
import Waves from '@lucide/svelte/icons/waves';
import Sparkles from '@lucide/svelte/icons/sparkles';
import Grid3x3 from '@lucide/svelte/icons/grid-3x3';
import AudioLines from '@lucide/svelte/icons/audio-lines';
import Zap from '@lucide/svelte/icons/zap';
import ImageIcon from '@lucide/svelte/icons/image';
import Scissors from '@lucide/svelte/icons/scissors';
import Layers from '@lucide/svelte/icons/layers';
import CircleDot from '@lucide/svelte/icons/circle-dot';

export const GENERATOR_ICON: Record<effectChain.GeneratorKind, Component> = {
  solid: Square,
  gradient: Rainbow,
  wave: Waves,
  noise: Waves,
  particles: Sparkles,
  pattern: Grid3x3,
  meter: AudioLines,
  lightning: Zap,
  scene: ImageIcon,
  splice: Scissors,
  slice: Layers,
  dot: CircleDot,
};
