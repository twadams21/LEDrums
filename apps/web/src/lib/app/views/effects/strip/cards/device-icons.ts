/* Lucide icons for the device cards: one per Generator kind, per Modifier category and per
   Control kind. Follows core's `GeneratorDef.icon` names, with one deliberate exception: core
   gives Noise and Wave the same `waves` icon, which would make two of the eleven picker buttons
   indistinguishable, so Noise takes `cloud` here. */
import type { Component } from 'svelte';
import type { effectChain } from '@ledrums/core';
import Square from '@lucide/svelte/icons/square';
import Rainbow from '@lucide/svelte/icons/rainbow';
import WavesHorizontal from '@lucide/svelte/icons/waves-horizontal';
import Cloud from '@lucide/svelte/icons/cloud';
import Sparkles from '@lucide/svelte/icons/sparkles';
import Grid3x3 from '@lucide/svelte/icons/grid-3x3';
import AudioLines from '@lucide/svelte/icons/audio-lines';
import Zap from '@lucide/svelte/icons/zap';
import Image from '@lucide/svelte/icons/image';
import Scissors from '@lucide/svelte/icons/scissors';
import Layers from '@lucide/svelte/icons/layers';
import Timer from '@lucide/svelte/icons/timer';
import Move from '@lucide/svelte/icons/move';
import Sparkle from '@lucide/svelte/icons/sparkle';
import Palette from '@lucide/svelte/icons/palette';
import TrendingDown from '@lucide/svelte/icons/trending-down';
import Activity from '@lucide/svelte/icons/activity';
import Gauge from '@lucide/svelte/icons/gauge';
import Dices from '@lucide/svelte/icons/dices';
import SlidersHorizontal from '@lucide/svelte/icons/sliders-horizontal';
import Radio from '@lucide/svelte/icons/radio';
import Music from '@lucide/svelte/icons/music';

export const GENERATOR_ICON: Record<effectChain.GeneratorKind, Component> = {
  solid: Square,
  gradient: Rainbow,
  wave: WavesHorizontal,
  noise: Cloud,
  particles: Sparkles,
  pattern: Grid3x3,
  meter: AudioLines,
  lightning: Zap,
  scene: Image,
  splice: Scissors,
  slice: Layers,
};

const MODIFIER_CATEGORY_ICON: Record<string, Component> = {
  temporal: Timer,
  spatial: Move,
  texture: Sparkle,
  color: Palette,
};

export const modifierIcon = (category: string | undefined): Component =>
  (category && MODIFIER_CATEGORY_ICON[category]) || Sparkle;

export const CONTROL_ICON: Record<effectChain.ControlKind, Component> = {
  envelope: TrendingDown,
  lfo: Activity,
  velocity: Gauge,
  random: Dices,
  cc: SlidersHorizontal,
  osc: Radio,
  note: Music,
  audio: AudioLines,
};
