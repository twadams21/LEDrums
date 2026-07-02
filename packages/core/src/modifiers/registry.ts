/**
 * Modifier registry — mirrors `effects/registry.ts`. A flat list of {@link ModifierDef}s
 * keyed by id, with duplicate-id detection at module load. S30–S32 grow this list behind
 * the same interface; the compositor only ever reaches modifiers through {@link
 * tryGetModifier} + the chain runner.
 */
import type { ModifierDef } from './types';
import { trail } from './impl/trail';
// S32
import { slide } from './impl/slide';
import { blur } from './impl/blur';
import { posterize } from './impl/posterize';
import { feedback } from './impl/feedback';
import { kaleidoscope } from './impl/kaleidoscope';
import { freeze } from './impl/freeze';
import { flicker } from './impl/flicker';
import { chromatic } from './impl/chromatic';

const ALL: ModifierDef<any>[] = [
  trail,
  // S32 — modifier second wave (Slide/Blur/Posterize/Feedback/Kaleidoscope/Freeze/Flicker/Chromatic)
  slide,
  blur,
  posterize,
  feedback,
  kaleidoscope,
  freeze,
  flicker,
  chromatic,
];

const registry = new Map<string, ModifierDef<any>>();
for (const m of ALL) {
  if (registry.has(m.id)) throw new Error(`Duplicate modifier id: ${m.id}`);
  registry.set(m.id, m);
}

export function getModifier(id: string): ModifierDef<any> {
  const m = registry.get(id);
  if (!m) throw new Error(`Unknown modifier: ${id}`);
  return m;
}

export function tryGetModifier(id: string): ModifierDef<any> | undefined {
  return registry.get(id);
}

export function listModifiers(): ModifierDef<any>[] {
  return [...registry.values()];
}

export function modifierIds(): string[] {
  return [...registry.keys()];
}
