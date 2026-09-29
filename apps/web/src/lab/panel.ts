/**
 * panel.ts — lil-gui control panel + keyboard triggers.   (OWNED by the ACTIONS agent)
 *
 * CONTRACT
 *  createPanel(ctx: ActionContext): { gui: GUI; dispose(): void }
 *    Folder order: Pads, Actions, Forces, Look, LEDs, Particles. Each module's controls come from its own
 *    register*Panel(folder).
 *  KEY_BINDINGS: string[]  = ['1'..'9','0']
 *    1-4  fire the drum pads (DRUM_PADS order; each pad's action is reassignable in the Pads folder)
 *    5-0  fire KEY_ACTION_IDS directly (no drum: a random drum is the origin for origin-based actions)
 *  KEY_ACTION_IDS: string[]  the action ids bound to keys 5,6,7,8,9,0
 *  Keys are ignored while typing in inputs or with modifier keys held. Pressing a key also pulses its panel button.
 */
import GUI from 'three/examples/jsm/libs/lil-gui.module.min.js';
import { ACTIONS, ACTION_HELP, DRUM_PADS, runAction, triggerPad, type ActionContext } from './actions';
import { registerForcePanel } from './forces';
import { registerLookPanel } from './look';
import { registerSamplerPanel } from './sampler';
import { registerParticlePanel, particleParams } from './particles';

export const KEY_BINDINGS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'];
/** actions on keys 5,6,7,8,9,0 (the pad defaults burst/shockwave/recolour/spin are already on the pads) */
export const KEY_ACTION_IDS = ['next-shape', 'surge', 'scatter', 'freeze', 'flash', 'reset'];

type Ctl = ReturnType<GUI['add']>;

function pulse(c: Ctl | undefined): void {
  const el = c?.domElement?.parentElement?.parentElement as HTMLElement | null | undefined;
  if (!el) return;
  el.style.transition = 'none';
  el.style.filter = 'brightness(2.2)';
  requestAnimationFrame(() => {
    el.style.transition = 'filter 0.3s ease-out';
    el.style.filter = '';
  });
}

export function createPanel(ctx: ActionContext): { gui: GUI; dispose(): void } {
  const gui = new GUI({ title: 'LED particle lab' });
  const buttonFor = new Map<string, Ctl>(); // key -> controller, for the press pulse

  // ---- Pads ------------------------------------------------------------------------------------
  const padFolder = gui.addFolder('Pads');
  const actionOptions = Object.fromEntries(ACTIONS.map((a) => [a.label, a.id]));
  DRUM_PADS.forEach((pad, i) => {
    const key = KEY_BINDINGS[i] ?? '';
    const btn = padFolder.add({ fire: () => triggerPad(ctx, pad.id) }, 'fire').name(`[${key}] ${pad.label}`);
    buttonFor.set(key, btn);
    const sel = { action: pad.actionId };
    padFolder
      .add(sel, 'action', actionOptions)
      .name(`${pad.label} does`)
      .onChange((v: string) => {
        pad.actionId = v;
      });
  });

  // ---- Actions ---------------------------------------------------------------------------------
  const actFolder = gui.addFolder('Actions');
  const actionKey = (id: string): string => {
    const j = KEY_ACTION_IDS.indexOf(id);
    return j >= 0 ? (KEY_BINDINGS[DRUM_PADS.length + j] ?? '') : '';
  };
  ACTIONS.forEach((a) => {
    const key = actionKey(a.id);
    const btn = actFolder.add({ run: () => runAction(ctx, a.id) }, 'run').name(key ? `[${key}] ${a.label}` : a.label);
    const help = ACTION_HELP[a.id];
    if (help) btn.domElement.title = help;
    if (key) buttonFor.set(key, btn);
  });

  // ---- module folders --------------------------------------------------------------------------
  const forces = gui.addFolder('Forces');
  registerForcePanel(forces);
  forces.close();

  const look = gui.addFolder('Look');
  registerLookPanel(look);
  look.add({ randomise: () => randomiseLook(look) }, 'randomise').name('Randomise look');
  look.close();

  registerSamplerPanel(gui.addFolder('LEDs'));
  registerParticlePanel(gui.addFolder('Particles').close());

  // ---- keyboard --------------------------------------------------------------------------------
  const onKey = (e: KeyboardEvent): void => {
    if (e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT')) return;
    const idx = KEY_BINDINGS.indexOf(e.key);
    if (idx < 0) return;
    pulse(buttonFor.get(e.key));
    if (idx < DRUM_PADS.length) triggerPad(ctx, DRUM_PADS[idx]!.id);
    else {
      const id = KEY_ACTION_IDS[idx - DRUM_PADS.length];
      if (id) runAction(ctx, id);
    }
  };
  window.addEventListener('keydown', onKey);

  // params are changed by actions (shape, surge, ...): keep the sliders honest unless one is being edited
  const refresh = setInterval(() => {
    if (gui.domElement.contains(document.activeElement)) return;
    for (const c of gui.controllersRecursive()) c.updateDisplay();
  }, 400);

  return {
    gui,
    dispose() {
      clearInterval(refresh);
      window.removeEventListener('keydown', onKey);
      gui.destroy();
    },
  };
}

/** Jitter the numeric Look controls within their own ranges and pick a fresh ambient palette. */
function randomiseLook(folder: GUI): void {
  for (const c of folder.controllersRecursive()) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ctl = c as any;
    const v = ctl.getValue();
    if (typeof v !== 'number' || ctl._min === undefined || ctl._max === undefined) continue;
    const span = ctl._max - ctl._min;
    const next = v + (Math.random() - 0.5) * span * 0.35;
    ctl.setValue(Math.min(ctl._max, Math.max(ctl._min, next)));
  }
  const h = Math.random();
  const rgb = (hh: number, s: number, l: number): [number, number, number] => {
    const a = s * Math.min(l, 1 - l);
    const f = (n: number): number => {
      const k = (n + hh * 12) % 12;
      return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    };
    const c = [f(0), f(8), f(4)] as [number, number, number];
    const m = Math.max(...c, 1e-3);
    return [c[0] / m, c[1] / m, c[2] / m];
  };
  particleParams.ambientColorA = rgb(h, 0.95, 0.55);
  particleParams.ambientColorB = rgb((h + 0.2 + Math.random() * 0.25) % 1, 0.9, 0.55);
}
