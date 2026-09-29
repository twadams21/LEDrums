/**
 * panel.ts — lil-gui control panel + keyboard triggers.   (STUB — owned by the ACTIONS agent)
 *
 * CONTRACT
 *  createPanel(ctx: ActionContext): { gui: GUI; dispose(): void }
 *    Called once by main.ts. Builds the lil-gui: folders for Forces / Look / Sampler / Particles (each filled by that
 *    module's register*Panel(folder) — those modules own their own controls), a "Drum pads" folder (one button per pad
 *    + an action dropdown that reassigns pad.actionId), and an "Actions" folder (one button per ACTIONS entry).
 *    Keyboard: 1..4 fire drum pads 1..4 (DRUM_PADS order), then 5,6,7,8,9,0 fire ACTIONS[0..5]. Ignored while typing in
 *    inputs or with modifier keys held. KEY_BINDINGS documents the mapping.
 *  KEY_BINDINGS: string[]  = ['1','2','3','4','5','6','7','8','9','0']
 */
import GUI from 'three/examples/jsm/libs/lil-gui.module.min.js';
import { ACTIONS, DRUM_PADS, runAction, triggerPad, type ActionContext } from './actions';
import { registerForcePanel } from './forces';
import { registerLookPanel } from './look';
import { registerSamplerPanel } from './sampler';
import { registerParticlePanel } from './particles';

export const KEY_BINDINGS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'];

export function createPanel(ctx: ActionContext): { gui: GUI; dispose(): void } {
  const gui = new GUI({ title: 'LED particle lab' });

  registerForcePanel(gui.addFolder('Forces'));
  registerLookPanel(gui.addFolder('Look'));
  registerSamplerPanel(gui.addFolder('LED sampler'));
  registerParticlePanel(gui.addFolder('Particles').close());

  const padFolder = gui.addFolder('Drum pads');
  DRUM_PADS.forEach((pad, i) => {
    const key = KEY_BINDINGS[i] ?? '';
    padFolder.add({ fire: () => triggerPad(ctx, pad.id) }, 'fire').name(`[${key}] ${pad.label}`);
  });
  const assign = { ...Object.fromEntries(DRUM_PADS.map((p) => [p.id, p.actionId])) } as Record<string, string>;
  DRUM_PADS.forEach((pad) => {
    padFolder.add(assign, pad.id, ACTIONS.map((a) => a.id)).name(`${pad.label} does`).onChange((v: string) => {
      pad.actionId = v;
    });
  });

  const actFolder = gui.addFolder('Actions');
  ACTIONS.forEach((a, j) => {
    const key = KEY_BINDINGS[DRUM_PADS.length + j] ?? '';
    actFolder.add({ run: () => runAction(ctx, a.id) }, 'run').name(key ? `[${key}] ${a.label}` : a.label);
  });

  const onKey = (e: KeyboardEvent): void => {
    if (e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT')) return;
    const idx = KEY_BINDINGS.indexOf(e.key);
    if (idx < 0) return;
    if (idx < DRUM_PADS.length) triggerPad(ctx, DRUM_PADS[idx]!.id);
    else {
      const a = ACTIONS[idx - DRUM_PADS.length];
      if (a) runAction(ctx, a.id);
    }
  };
  window.addEventListener('keydown', onKey);

  return {
    gui,
    dispose() {
      window.removeEventListener('keydown', onKey);
      gui.destroy();
    },
  };
}
