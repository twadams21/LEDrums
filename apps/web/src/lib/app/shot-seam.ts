/* Dev-only screenshot control seam (`window.__LEDRUMS_SHOT__`).

   The hard part of a UI screenshot is not cropping the element — it is getting
   the app into the state where the element exists. This module is a thin adapter
   over the existing engine + shell stores that drives that state deterministically,
   so `pnpm ui-shot --state "view:trigger,cell:kick:0,add-effect:wave"` replaces the
   fragile Playwright click choreography that used to live in `shots.json`.

   It duplicates NO logic: every operation calls the same public store methods the
   UI calls. It is installed only under `import.meta.env.DEV` (see App.svelte's
   dynamic import) so it is dead-code-eliminated from production bundles.

   To teach `ui-shot` a new app state, add ONE method here — never a bespoke click
   script in a preset. */

import type { TriggerLab } from '../trigger-lab/store.svelte';
import type { SettingsPane, ShellStore, View } from './shell-store.svelte';
import { SETTINGS_PANES } from './shell-nav';
import type { BackupSnapshotMeta, ControllerStatus } from '../ws/protocol-types';
import { defaultProject, effectChain, voice, withVelocityCurve } from '@ledrums/core';
import { MASTER_CELL, type EffectsAuthoringApi } from '../trigger-lab/effects-api';
import { addDeclaredZone, setZoneLabel } from './docks/patch-inspector';
import { sectionsDndPreview } from './views/sections-dnd-preview.svelte';
import { pushToast, toastStore, type ToastTone } from '../ui/toast.svelte';
import { mapRegistry } from './map-mode/registry.svelte';

/** Let Svelte's reactivity flush before the next op reads the DOM. Two animation
    frames is enough for a rune update to render; ui-shot adds its own settle before
    capturing. */
function settle(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
}

/** Split on the FIRST separator only, so a value may contain it. */
function splitOnce(text: string, sep: string): [string, string | undefined] {
  const i = text.indexOf(sep);
  return i < 0 ? [text, undefined] : [text.slice(0, i), text.slice(i + sep.length)];
}

export interface ShotSeam {
  /** Close every summoned drawer/modal and drop the inspector selection. */
  reset(): void;
  /** Switch the workspace view (perform · objects · sections · trigger · monitor). */
  setView(view: View): void;
  /** Stage the Settings › Input audio meters WITHOUT capture (GH #214): `running` (a synthetic
      frame), `denied`, `lost`, `unsupported`, or `off`. Nothing here opens a microphone. */
  previewAudioMeter(state?: string): void;
  /** Hold the op sequence for `ms` — for state that lands asynchronously (the debounced show
      sync to the engine), which no amount of rAF settling will cover. */
  wait(ms: number): Promise<void>;
  /** Fire a pad hit through the store's real hit path (`fire` = the selected pad,
      `fire:kick` = that drum's first pad), so a mid-fire frame is capturable. */
  firePad(drumId?: string): void;
  /** Open the Settings modal, optionally on a named section (`settings:outputs`). */
  openSettings(pane?: SettingsPane): void;
  /** Author a non-identity velocity sensitivity curve on a drum (`velocity-curve:kick`,
      bare = the first drum) so the tuned state — not just the empty diagonal — is
      capturable. Writes through the same `setInputMap` gate the pane's own editor uses. */
  previewVelocityCurve(drumId?: string): void;
  /** Seed a representative set of local backups (#123) and open the Backups dialog, so ui-shot can
      capture the snapshot list + reasons + relative times without a live backend history. */
  previewBackups(): void;
  /** Pin the Sections reorder insert line so ui-shot can capture the otherwise drag-only
      state. */
  previewSectionsReorder(): void;
  /** Inject a synthetic controller status and open Settings → Controller, so ui-shot can capture
      the controller surface (incl. the R29 admin-password field + the subnet-recommendation card)
      without a live PixLite on the network. `auth` = adopted + authenticated (calm); `needs`
      = adopted but lost/needs-password (warn → shows the subnet guidance under the lost alert);
      `discover` = nothing adopted (the Discover affordance + recommendation card + Adopt-by-IP).
      The Controller pane is an S2 stub until S4d re-homes the panels; the status injection is
      already the shape that pane will render. */
  mockController(kind?: 'auth' | 'needs' | 'discover'): void;
  /** Push transient toast(s) so ui-shot can capture the top-centre ToastHost stack and its
      per-role tint. `arg` is a single tone (`info`/`success`/`error`); omitted → one of each. */
  previewToasts(tone?: ToastTone): void;
  /** Open Settings with the global control bindings in a representative BOUND state — one
      control bound to a note that collides with a mapped drum zone (so the override warning
      renders), one bound to an OSC address, one left unbound. The live states otherwise need
      real hardware to bind against. */
  previewGlobalControls(): void;
  /** Open Settings with a global control's MIDI (default) or OSC Learn armed, so the
      listening state is capturable without an input device to arm it against. */
  previewGlobalControlLearn(which?: 'midi' | 'osc'): void;
  /** Activate a section of the active song by 1-based position or name (`section:2`) — the same
      `setActiveSection` a Sections-bar chip fires, so a shot can prove what follows the switch. */
  setSection(positionOrName: string): void;
  /** Switch the active song to a canonical library reference for the read-only shot. */
  previewCanonicalReadonly(view?: 'sections' | 'trigger'): void;
  /** Seed a viewer presence state for the disabled-authoring shot. */
  previewViewer(): void;
  /** Effects grid: select a cell (`cell:<row>:<col>`). `<row>` is a row id or label (`kit`,
      `kick`, `Snare`); `<col>` is a grid-column index, `always` / `clock` / `cue`, or `z<slot>`. */
  selectGridCell(spec: string): void;
  /** Add an Effect of Generator `<kind>[:style]` into the selected cell (`add-effect:wave:radial`). */
  addEffectToSelected(spec: string): void;
  /** Fill the selected cell with `n` demo Effects of varied Generators (`effect-stack:3`). */
  fillEffectStack(count: number): void;
  /** MIDI-map mode on (`map-mode`); `map-mode:armed` also arms the first visible mappable
      control, through the overlay's real capture layer (a synthetic primary press). */
  mapMode(armed?: boolean): Promise<void>;
  /** Select the Master cell (the section's master modifier chain). */
  selectMaster(): void;
  /** Apply a comma-separated state spec (`view:trigger,cell:kick:0,add-effect:wave`),
      awaiting a render between ops. This is the interface `ui-shot --state` drives. */
  apply(spec: string): Promise<void>;
}

class ShotSeamImpl implements ShotSeam {
  constructor(
    private readonly store: TriggerLab,
    private readonly shell: ShellStore,
  ) {}

  reset(): void {
    this.shell.setMapMode(false);
    this.store.closeGallery();
    this.store.closeSettings();
    this.shell.closeSettings();
    this.shell.clearSelection();
    sectionsDndPreview.clear();
    toastStore.clear();
  }

  setView(view: View): void {
    this.shell.setView(view);
  }

  previewAudioMeter(state = 'running'): void {
    const frame = { level: 0.72, bass: 0.91, mids: 0.38, highs: 0.16 };
    if (state === 'denied') this.store.previewAudioMeter('error', voice.ZERO_AUDIO_FRAME, 'permission-denied');
    else if (state === 'lost') this.store.previewAudioMeter('device-lost', voice.ZERO_AUDIO_FRAME);
    else if (state === 'unsupported') this.store.previewAudioMeter('error', voice.ZERO_AUDIO_FRAME, 'unsupported');
    else if (state === 'off') this.store.previewAudioMeter('stopped', voice.ZERO_AUDIO_FRAME);
    else {
      this.store.previewAudioMeter('running', frame);
      this.store.sim.setAudio(frame); // audio-reactive faces read the sim table
    }
  }

  wait(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));
  }

  firePad(drumId?: string): void {
    const pad = this.padFor(drumId) ?? this.store.pads[0];
    if (pad) this.store.hit(pad);
  }

  /** The pad `drumId` names, by id or label prefix. The ONE lookup, so the `fire` op's
      pad-vs-generator disambiguation can never accept a name `firePad` would then miss. */
  private padFor(drumId?: string): TriggerLab['pads'][number] | undefined {
    const wanted = drumId?.toLowerCase();
    if (!wanted) return undefined;
    return this.store.pads.find((p) => p.drumId.toLowerCase() === wanted || p.drumLabel.toLowerCase().startsWith(wanted));
  }

  openSettings(pane?: SettingsPane): void {
    // Settings routing lives in the shell store (deep-linkable `?settings=<pane>`),
    // so the seam drives the same method the gear + the URL drive.
    this.shell.openSettings(pane);
  }

  previewBackups(): void {
    // Seed a representative snapshot set (one of each reason, spread across time) so the capture
    // reads like a real recovery list, then open the dialog via its stable TopBar control. The
    // dialog's own refreshBackups() would overwrite this from a live server, but the dev shot
    // session has no backup history — so the seed is what a real machine's list would look like.
    const nowMs = Date.now();
    const seed: BackupSnapshotMeta[] = [
      { id: `${nowMs - 4 * 60_000}-pre-risk`, createdAt: nowMs - 4 * 60_000, reason: 'pre-risk' },
      { id: `${nowMs - 35 * 60_000}-cadence`, createdAt: nowMs - 35 * 60_000, reason: 'cadence' },
      { id: `${nowMs - 3 * 3_600_000}-cadence`, createdAt: nowMs - 3 * 3_600_000, reason: 'cadence' },
      { id: `${nowMs - 27 * 3_600_000}-boot`, createdAt: nowMs - 27 * 3_600_000, reason: 'boot' },
    ];
    this.store.backups = seed;
    const button = document.querySelector<HTMLButtonElement>('button[aria-label="Backups"]');
    button?.click();
    // The dialog's open-effect fires refreshBackups(); a live dev server may answer with its own
    // (near-empty) list and clobber the seed. Re-assert across a few frames so the capture shows the
    // representative set. Dev-only.
    let frames = 0;
    const reassert = (): void => {
      this.store.backups = seed;
      if (frames++ < 30) requestAnimationFrame(reassert);
    };
    requestAnimationFrame(reassert);
  }

  previewSectionsReorder(): void {
    this.shell.setView('sections');
    const sections = this.store.activeSong?.sections ?? [];
    if (sections.length === 0) return;
    // Pin the vertical insert-line in an interior gap (between the first two columns when
    // there are ≥2, else the leading gap) so it reads as a mid-setlist reorder target.
    sectionsDndPreview.set({ kind: 'section', index: sections.length >= 2 ? 1 : 0 });
  }

  mockController(kind: 'auth' | 'needs' | 'discover' = 'auth'): void {
    if (this.store.canTakeover) this.store.takeover();
    this.shell.openSettings('controller');
    // Nothing adopted — the un-adopted branch (Discover + recommendation card + Adopt-by-IP). The
    // recommendation comes from the real NIC list the panel's mount requests, so this captures
    // the true "different IP addresses" guidance, not a stub.
    if (kind === 'discover') {
      this.store.controllerStatus = null;
      let f = 0;
      const hold = (): void => {
        this.store.controllerStatus = null; // resist the dev server's own (null) status echoes
        if (f++ < 30) requestAnimationFrame(hold);
      };
      requestAnimationFrame(hold);
      return;
    }
    const reachable = kind === 'auth';
    // A representative adopted PixLite (authReqd true so the panel's password field is the point of
    // interest). The same shape the server's `controllerStatus` broadcast carries.
    const status: ControllerStatus = {
      host: '192.168.1.50',
      reachable,
      identity: {
        host: '192.168.1.50',
        prodName: 'PixLite A4-S Mk3',
        nickname: 'Kick Left',
        fwVer: '1.4.2',
        authReqd: true,
      },
      universes: reachable
        ? [
            { uniNum: 0, protocol: 'sACN', receiving: true, inGood: 44_318, inBadSeq: 0, priority: 100 },
            { uniNum: 1, protocol: 'sACN', receiving: true, inGood: 44_012, inBadSeq: 0, priority: 100 },
          ]
        : [],
      rates: reachable ? { inFrmRate: 44, outFrmRate: 44 } : {},
      health: reachable ? { tempC: 41, bankVoltsMv: [12_100], ethLinkUp: [true, false] } : {},
      lastSeen: reachable ? Date.now() : Date.now() - 8_000,
      testPattern: null,
    };
    this.store.controllerStatus = status;
    // The pane's mount sends `watchController`, and a dev server with no adopted controller may
    // answer with a null `controllerStatus` that would wipe the synthetic one. Re-assert across a few
    // frames so the injected status is what the panel renders when ui-shot captures. Dev-only.
    let frames = 0;
    const reassert = (): void => {
      this.store.controllerStatus = status;
      if (frames++ < 30) requestAnimationFrame(reassert);
    };
    requestAnimationFrame(reassert);
  }

  previewVelocityCurve(drumId?: string): void {
    this.claimEdit(() => {
      const project = this.store.project;
      if (!project) return;
      const wanted = drumId?.toLowerCase();
      const drum = wanted
        ? project.kit.drums.find((d) => d.id.toLowerCase() === wanted)
        : project.kit.drums[0];
      if (!drum) return;
      // A gate plus a lift: silent below a light tap, then an ease-out that gives the quiet
      // hits most of the range. Non-identity in every way the plot can show at once —
      // handles moved on both axes, a curved profile, and a bent strength.
      this.store.setInputMap(
        withVelocityCurve(project.inputMap, drum.id, {
          h0: { x: 0.18, y: 0 },
          h1: { x: 0.9, y: 1 },
          profile: 'bend',
          strength: 0.62,
        }),
      );
    });
    this.openSettings('zones');
  }

  previewGlobalControls(): void {
    this.claimEdit(() => {
      // The override warning still deserves a picture, but the editors can no longer PRODUCE
      // that state — `setGlobalControlBinding` now refuses a note a drum zone already owns
      // (`binding-claims`). The one route left is a pasted patch, which reaches the server as
      // a bulk `setProject` and never passes the guard. So this writes the colliding binding
      // straight onto the project, exactly as an imported patch would deliver it.
      const project = this.store.project;
      const mapped = project?.inputMap.midiNotes[0];
      if (project && mapped) {
        project.inputMap.globalControls = {
          ...project.inputMap.globalControls,
          nextSong: { midiNote: mapped.note },
        };
      } else {
        this.store.setGlobalControlBinding('nextSong', { midiNote: 36 });
      }
      this.store.setGlobalControlBinding('nextSection', { oscAddress: '/ledrums/next_section' });
      this.store.setGlobalControlBinding('prevSection', { midiNote: 101, oscAddress: '/ledrums/prev_section' });
      // One of each remaining kind, so the capture covers the whole catalogue's shapes:
      // a momentary hold, and the continuous CC-bound dimmer.
      this.store.setGlobalControlBinding('panicBlackoutMomentary', { midiNote: 102 });
      this.store.setGlobalControlBinding('masterBrightness', { midiCc: 7, oscAddress: '/ledrums/brightness' });
      // prevSong deliberately left unbound — the empty state belongs in the same frame.
    });
    this.openSettings();
  }

  previewGlobalControlLearn(which: 'midi' | 'osc' = 'midi'): void {
    this.claimEdit(() => {
      this.store.setGlobalControlBinding('nextSong', { midiNote: 100 });
      if (which === 'osc') this.store.startOscLearn({ kind: 'global-control', action: 'nextSection' });
      else this.store.startMidiLearn({ kind: 'global-control', action: 'nextSection' });
    });
    this.openSettings();
  }

  setSection(positionOrName: string): void {
    const sections = this.store.activeSong?.sections ?? [];
    const section = /^\d+$/.test(positionOrName)
      ? sections[Number(positionOrName) - 1]
      : sections.find((candidate) => candidate.name.toLowerCase() === positionOrName.toLowerCase());
    if (section) this.store.setActiveSection(section.id);
  }

  previewCanonicalReadonly(view: 'sections' | 'trigger' = 'trigger'): void {
    const local = this.store.songs[0];
    if (!local) return;
    const libraryId = this.store.exportSongToLibrary(local.id);
    if (!libraryId) return;
    this.store.importSongReference(libraryId);
    this.store.setActiveSong(libraryId);
    this.shell.setView(view);
  }

  previewViewer(): void {
    this.store.presence = { editorId: 'shot-editor', youAreEditor: false, clientCount: 2 };
    this.shell.setView('sections');
  }

  /**
   * Run an authoring mutation once this client actually HOLDS the edit lock.
   *
   * `takeover()` only sends a request — `isViewer` flips when the server grants it, so a
   * mutation called synchronously straight after is silently dropped by the viewer guard
   * and the capture shows stale state. Retry across a few frames until it lands (the same
   * shape `previewBackups` / `mockController` use to outlast a server echo). Dev-only.
   */
  private claimEdit(mutate: () => void): Promise<void> {
    return new Promise((resolve) => {
      if (this.store.canTakeover) this.store.takeover();
      if (!this.store.isViewer && this.store.project) {
        mutate();
        resolve();
        return;
      }
      let frames = 0;
      const attempt = (): void => {
        if (!this.store.isViewer && this.store.project) {
          mutate();
          resolve();
          return;
        }
        if (frames++ >= 60) {
          resolve();
          return;
        }
        requestAnimationFrame(attempt);
      };
      requestAnimationFrame(attempt);
    });
  }

  previewToasts(tone?: ToastTone): void {
    // ttl:0 keeps them pinned for the capture (no auto-dismiss race). Oldest-first so the
    // host renders info → success → error top-to-bottom when showing the full set.
    const tones: ToastTone[] = tone ? [tone] : ['info', 'success', 'error'];
    const messages: Record<ToastTone, string> = {
      info: 'Pasted 3 layers.',
      success: 'Section copied.',
      error: 'That clipboard content isn’t from LEDrums.',
    };
    for (const t of tones) pushToast(messages[t], { tone: t, ttl: 0 });
  }

  /** The store implements the Effects authoring contract once store-wire lands. */
  private get effects(): EffectsAuthoringApi {
    return this.store.effectsApi;
  }

  selectGridCell(spec: string): void {
    const cell = resolveGridCell(this.effects, spec);
    if (!cell) throw new Error(`cell: no grid cell "${spec}"`);
    this.effects.selectCell(cell);
  }

  addEffectToSelected(spec: string): void {
    if (this.store.canTakeover) this.store.takeover();
    const cell = this.effects.selectedCell;
    if (cell === null || cell === MASTER_CELL) throw new Error('add-effect: select a grid cell first (cell:<row>:<col>)');
    const [kind, style] = splitOnce(spec, ':');
    this.effects.addEffect(cell, kind as effectChain.GeneratorKind, style);
  }

  fillEffectStack(count: number): void {
    if (this.store.canTakeover) this.store.takeover();
    const cell = this.effects.selectedCell;
    if (cell === null || cell === MASTER_CELL) throw new Error('effect-stack: select a grid cell first (cell:<row>:<col>)');
    for (let i = 0; i < count; i++) {
      const [kind, style] = DEMO_STACK[i % DEMO_STACK.length]!;
      this.effects.addEffect(cell, kind, style);
    }
    // Leave the cell (not its last Effect) as the selection, like a click on it.
    this.effects.selectCell(cell);
  }

  selectMaster(): void {
    this.effects.selectCell(MASTER_CELL);
  }

  async mapMode(armed = false): Promise<void> {
    this.shell.setMapMode(true);
    if (!armed) return;
    await settle(); // the overlay installs its capture layer once the mode renders
    const entry = mapRegistry.entries.find((e) => e.node.isConnected && e.node.getBoundingClientRect().width > 0);
    if (!entry) throw new Error('map-mode:armed: no mappable control is on screen');
    entry.node.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, composed: true, button: 0 }));
  }

  async apply(spec: string): Promise<void> {
    for (const token of spec.split(',')) {
      const trimmed = token.trim();
      if (!trimmed) continue;
      const idx = trimmed.indexOf(':');
      const op = (idx >= 0 ? trimmed.slice(0, idx) : trimmed).trim();
      const arg = idx >= 0 ? trimmed.slice(idx + 1).trim() : undefined;
      await this.runOp(op, arg);
      await settle();
    }
  }

  private runOp(op: string, arg?: string): void | Promise<void> {
    switch (op) {
      // wait:<ms> — hold the sequence. The show reaches the server on a 300ms debounce, so a
      // capture that authors an Effect and then fires it has to let the sync land in between.
      case 'wait':
        return this.wait(Number(arg) || 0);
      case 'reset':
        this.reset();
        break;
      case 'configured-zones': {
        if (this.store.link === 'open') throw new Error('configured-zones requires an offline preview');
        this.store.project = defaultProject();
        this.store.setInputMap(addDeclaredZone(setZoneLabel(this.store.project.inputMap, 'kick', 0, 'Head center'), 'kick', 2, 'Rim'));
        break;
      }
      case 'view':
        if (arg) this.setView(arg as View);
        break;
      // fire[:<drum>] — hit a pad through the real hit path (bare = the first pad).
      case 'fire':
        this.firePad(arg || undefined);
        break;
      case 'settings':
        // `settings` opens the modal on its default pane; `settings:outputs` deep-links a section.
        this.openSettings(arg && (SETTINGS_PANES as readonly string[]).includes(arg) ? (arg as SettingsPane) : undefined);
        break;
      case 'backups':
        this.previewBackups();
        break;
      case 'sections-reorder':
        this.previewSectionsReorder();
        break;
      case 'controller':
        this.mockController(arg === 'needs' ? 'needs' : arg === 'discover' ? 'discover' : 'auth');
        break;
      case 'expanded':
        // Flip the Advatek expanded/normal controller mode — the ONLY control over the output-port
        // count (8 expanded / 4 normal). Drives kit.outputs reconcile so Settings › Outputs
        // can be captured at either count. `expanded` / `expanded:on` → on; `expanded:off` → off.
        this.store.setKitGlobal({ expanded: arg !== 'off' });
        break;
      case 'velocity-curve':
        this.previewVelocityCurve(arg);
        break;
      case 'global-controls':
        this.previewGlobalControls();
        break;
      case 'global-control-learn':
        this.previewGlobalControlLearn(arg === 'osc' ? 'osc' : 'midi');
        break;
      case 'audio-meter':
        this.previewAudioMeter(arg);
        break;
      case 'section':
        if (arg) this.setSection(arg);
        break;
      case 'canonical-readonly':
        this.previewCanonicalReadonly(arg === 'sections' ? 'sections' : 'trigger');
        break;
      case 'viewer':
        this.previewViewer();
        break;
      case 'toast':
      case 'toasts':
        this.previewToasts(arg as ToastTone | undefined);
        break;
      case 'cell':
        if (arg) this.selectGridCell(arg);
        break;
      case 'add-effect':
        if (arg) this.addEffectToSelected(arg);
        break;
      case 'effect-stack':
        this.fillEffectStack(Number(arg) || 1);
        break;
      case 'master':
        this.selectMaster();
        break;
      case 'map-mode':
        return this.mapMode(arg === 'armed');
      default:
        console.warn(`[shot-seam] unknown state op "${op}"`);
    }
  }
}

/** The grid cell a `cell:<row>:<col>` spec names, or null (see {@link ShotSeam.selectGridCell}). */
export function resolveGridCell(api: EffectsAuthoringApi, spec: string): effectChain.EffectCell | null {
  const [rowSpec, colSpec] = splitOnce(spec, ':');
  const needle = rowSpec.trim().toLowerCase();
  const row =
    api.gridRows.find((r) => r.id.toLowerCase() === needle) ?? api.gridRows.find((r) => r.label.toLowerCase() === needle);
  if (!row || colSpec === undefined) return null;
  const c = colSpec.trim().toLowerCase();
  const zone = /^z(\d+)$/.exec(c);
  const col = /^\d+$/.test(c)
    ? api.gridColumns[Number(c)]
    : api.gridColumns.find((g) =>
        zone ? g.column.kind === 'zone' && g.column.slot === Number(zone[1]) : g.column.kind === c,
      );
  return col ? { row: row.id, column: col.column } : null;
}

/** The Generators `effect-stack:<n>` cycles through, so a stacked cell shows varied faces. */
const DEMO_STACK: ReadonlyArray<readonly [effectChain.GeneratorKind, string?]> = [
  ['wave', 'radial'],
  ['particles'],
  ['solid'],
  ['noise'],
  ['gradient'],
  ['lightning'],
];

/** Attach the seam to `window`. Idempotent; dev-only (guard at the call site). */
export function installShotSeam(store: TriggerLab, shell: ShellStore): void {
  (window as unknown as { __LEDRUMS_SHOT__?: ShotSeam }).__LEDRUMS_SHOT__ = new ShotSeamImpl(store, shell);
}
