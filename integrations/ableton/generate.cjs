'use strict';

// Reproducible Max for Live PATCH SOURCE, authored 2026-09-14. No Max/Live invocation.
// Do not rename these JSON files to .amxd; the later template/save/freeze gate is in README.
const fs = require('node:fs');
const path = require('node:path');
const { DEFAULT_PORT } = require('./packets.cjs');
const { PUBLISH_MS, RMS_WINDOW_MS, DEFAULT_SETTINGS } = require('./audio.cjs');
const SCRIPT_FILES = [
  'max-bridge.cjs', 'device-runtime.cjs', 'packets.cjs', 'midi.cjs',
  'audio.cjs', 'session.cjs', 'udp.cjs',
];

function buildPatch(kind) {
  if (kind !== 'midi' && kind !== 'audio') throw new Error('Unknown device type');
  const title = `LEDrums ${kind === 'midi' ? 'MIDI' : 'Audio'}`;
  const boxes = [];
  const lines = [];
  const parameters = {};
  function box(id, maxclass, text, inputs, outputs, rect, extra = {}) {
    boxes.push({ box: {
      id, maxclass, ...(text ? { text } : {}), numinlets: inputs, numoutlets: outputs,
      patching_rect: rect, ...extra,
    } });
    return id;
  }
  const obj = (id, text, inputs, outputs, x, y, width = 180, extra = {}) => box(id, 'newobj', text, inputs, outputs, [x, y, width, 22], extra);
  const msg = (id, text, x, y, width = 130) => box(id, 'message', text, 2, 1, [x, y, width, 22]);
  const wire = (from, outlet, to, inlet = 0, order) => lines.push({ patchline: {
    source: [from, outlet], destination: [to, inlet], ...(order === undefined ? {} : { order }),
  } });
  function label(id, text, rect, font = 11) {
    return box(id, 'comment', text, 1, 0, rect, {
      presentation: 1, presentation_rect: rect, fontsize: font,
    });
  }
  function parameter(id, longName, shortName, initial, type, visibility, min, max) {
    parameters[id] = [longName, shortName, 0];
    return { valueof: {
      parameter_longname: longName, parameter_shortname: shortName, parameter_type: type,
      // Max enum: 0 Automated and Stored; 1 Stored Only; 2 Hidden (NOT persistent).
      parameter_invisible: visibility, parameter_initial_enable: 1, parameter_initial: [initial],
      ...(min === undefined ? {} : { parameter_mmin: min, parameter_mmax: max }),
    } };
  }
  function storedBlob(id, variable, longName, initial, x, y) {
    obj(id, `pattr ${variable} @parameter_enable 1`, 1, 3, x, y, 275, {
      varname: variable, restore: [initial],
      saved_attribute_attributes: parameter(id, longName, longName, initial, 3, 1),
    });
  }
  function number(id, shortName, value, min, max, rect, selector, type = 0) {
    box(id, 'live.numbox', '', 1, 2, rect, {
      varname: id, presentation: 1, presentation_rect: rect, parameter_enable: 1,
      saved_attribute_attributes: parameter(id, `LEDrums ${shortName}`, shortName, value, type, 1, min, max),
    });
    obj(`${id}-send`, `prepend ${selector}`, 1, 1, rect[0], 430 + rect[1], 190);
    wire(id, 0, `${id}-send`); wire(`${id}-send`, 0, 'node');
  }

  label('title', title, [12, 5, 145, 23], 14);
  label('source-only', 'Patch source — not packaged or verified in Live', [160, 8, 325, 20]);
  label('status', 'Waiting for Max device and Node', [490, 8, 535, 22], 12);
  label('name-label', 'Source name', [12, 32, 90, 18]);
  label('port-label', 'UDP port · loopback only', [275, 32, 165, 18]);
  label('identity-label', 'Source ID', [12, 71, 75, 18]);
  label('identity-value', 'Created after stored parameters restore', [85, 71, 340, 18]);
  label('saved-hint', 'Save the Set after New identity. Existing mappings keep the old ID.', [490, 69, 540, 20]);

  obj('node', 'node.script max-bridge.cjs @autostart 1 @watch 0 @defer 1', 1, 2, 20, 1000, 420);
  obj('from-node', 'route ready identity status', 2, 4, 20, 1040, 225);
  wire('node', 0, 'from-node');
  obj('status-set', 'prepend set', 1, 1, 450, 1040, 90);
  wire('from-node', 2, 'status-set'); wire('status-set', 0, 'status');
  obj('node-log', 'print LEDrums-Node', 1, 0, 600, 1040, 140);
  wire('node', 1, 'node-log');

  storedBlob('source-id', 'source_id', 'LEDrums Source ID', '', 20, 270);
  obj('id-fan', 't l l', 1, 2, 20, 310, 60);
  obj('identity-send', 'prepend identity', 1, 1, 20, 350, 130);
  obj('identity-set', 'prepend set', 1, 1, 170, 350, 95);
  wire('from-node', 1, 'source-id');
  wire('source-id', 0, 'id-fan');
  wire('id-fan', 1, 'identity-set'); wire('identity-set', 0, 'identity-value');
  wire('id-fan', 0, 'identity-send'); wire('identity-send', 0, 'node');

  storedBlob('source-name', 'source_name', 'LEDrums Source Name', title, 320, 270);
  box('name-editor', 'textedit', title, 1, 4, [12, 49, 250, 22], {
    varname: 'source_name_editor', keymode: 1, outputmode: 1, lines: 1, wordwrap: 0,
    presentation: 1, presentation_rect: [12, 49, 250, 22],
  });
  obj('name-route', 'route text', 2, 2, 320, 230, 85);
  obj('name-fan', 't l l', 1, 2, 320, 310, 60);
  obj('name-set', 'prepend set', 1, 1, 460, 350, 95);
  obj('name-send', 'prepend name', 1, 1, 320, 350, 115);
  wire('name-editor', 0, 'name-route'); wire('name-route', 0, 'source-name');
  wire('source-name', 0, 'name-fan');
  wire('name-fan', 1, 'name-set'); wire('name-set', 0, 'name-editor');
  wire('name-fan', 0, 'name-send'); wire('name-send', 0, 'node');
  number('port', 'UDP Port', DEFAULT_PORT, 1024, 65535, [275, 49, 80, 22], 'port', 1);

  box('new-identity-button', 'live.text', 'New identity', 1, 2, [365, 32, 115, 40], {
    texton: 'New identity', mode: 0, parameter_enable: 0,
    presentation: 1, presentation_rect: [365, 32, 115, 40],
  });
  obj('identity-bang', 'route bang', 2, 2, 660, 200, 90);
  obj('identity-press', 'sel 1', 2, 2, 660, 230, 60);
  msg('new-identity', 'new-identity', 660, 270);
  wire('new-identity-button', 0, 'identity-bang');
  wire('identity-bang', 0, 'new-identity');
  wire('identity-bang', 1, 'identity-press'); wire('identity-press', 0, 'new-identity');
  wire('new-identity', 0, 'node');

  // BOTH readiness signals are necessary. Node can boot before Live has restored pattr.
  // Node restarts request the same saved state; live.thisdevice save/preset bangs never mint.
  obj('live-ready', 'live.thisdevice', 1, 3, 20, 120, 110);
  obj('live-ready-order', 't b 1', 1, 2, 20, 160, 60);
  obj('node-ready-order', 't b 1', 1, 2, 170, 160, 60);
  obj('live-ready-flag', 'int 0', 2, 1, 20, 200, 60);
  obj('node-ready-flag', 'int 0', 2, 1, 170, 200, 60);
  obj('both-ready-live', 'sel 1', 2, 2, 20, 235, 60);
  obj('both-ready-node', 'sel 1', 2, 2, 170, 235, 60);
  wire('live-ready', 0, 'live-ready-order'); wire('from-node', 0, 'node-ready-order');
  wire('live-ready-order', 1, 'live-ready-flag', 1); wire('live-ready-order', 0, 'node-ready-flag');
  wire('node-ready-order', 1, 'node-ready-flag', 1); wire('node-ready-order', 0, 'live-ready-flag');
  wire('node-ready-flag', 0, 'both-ready-live'); wire('live-ready-flag', 0, 'both-ready-node');

  const replay = ['source-id', 'source-name', 'port'];
  for (let index = 1; index <= 8; index++) {
    const x = 12 + (index - 1) * 58;
    const id = `macro-${index}`;
    box(id, 'live.dial', '', 1, 2, [x, 95, 50, 64], {
      varname: id, presentation: 1, presentation_rect: [x, 95, 50, 64], parameter_enable: 1,
      saved_attribute_attributes: parameter(id, `LEDrums Macro ${index}`, `Macro ${index}`, 0, 0, 0, 0, 1),
    });
    obj(`${id}-send`, `prepend macro ${index}`, 1, 1, x, 400, 115);
    wire(id, 0, `${id}-send`); wire(`${id}-send`, 0, 'node');
    replay.push(id);
  }
  if (kind === 'audio') {
    const controls = [
      ['gain', 'Gain', 0, 4], ['floorDb', 'Floor dB', -90, -20],
      ['attackMs', 'Attack ms', 0, 1000], ['releaseMs', 'Release ms', 0, 1000],
    ];
    controls.forEach(([key, shortName, min, max], i) => {
      const x = 490 + i * 120;
      label(`${key}-label`, shortName, [x, 95, 115, 18]);
      number(key, shortName, DEFAULT_SETTINGS[key], min, max, [x, 116, 100, 22], `analysis ${key}`);
      replay.push(key);
    });
    label('path-hint', 'Stereo passes directly. Analysis only: Level / Bass / Mids / Highs, ≤30 Hz.', [490, 145, 540, 18]);
    audioPath();
    replay.push('dsp-state');
  } else {
    label('path-hint', 'MIDI passes directly. The Node tap never gates the instrument.', [490, 100, 530, 20]);
    label('routing-hint', 'Global MIDI routing + track-scoped note, gate, CC and macro addresses.', [490, 123, 535, 20]);
    obj('midi-in', 'midiin', 1, 1, 20, 660, 65);
    obj('midi-out', 'midiout', 1, 0, 20, 740, 65);
    obj('midi-defer', 'deferlow', 1, 1, 150, 700, 80);
    obj('midi-send', 'prepend midi', 1, 1, 150, 740, 120);
    wire('midi-in', 0, 'midi-out', 0, 0); // Musical path FIRST; no JS/network round trip.
    wire('midi-in', 0, 'midi-defer', 0, 1);
    wire('midi-defer', 0, 'midi-send'); wire('midi-send', 0, 'node');
  }
  obj('replay', `t ${Array(replay.length + 1).fill('b').join(' ')}`, 1, replay.length + 1, 20, 580, 470);
  wire('both-ready-live', 0, 'replay'); wire('both-ready-node', 0, 'replay');
  replay.forEach((target, i) => wire('replay', replay.length - i, target));
  msg('start', `start ${kind}`, 530, 580);
  wire('replay', 0, 'start'); wire('start', 0, 'node');
  obj('close', 'closebang', 0, 1, 850, 1000, 85);
  msg('dispose', 'dispose', 850, 1040, 85);
  wire('close', 0, 'dispose'); wire('dispose', 0, 'node');

  function audioPath() {
    obj('audio-in', 'plugin~', 1, 2, 20, 660, 70);
    obj('audio-out', 'plugout~', 2, 0, 20, 940, 75);
    wire('audio-in', 0, 'audio-out', 0, 0); wire('audio-in', 1, 'audio-out', 1, 0);
    obj('dsp-state', 'dspstate~', 1, 3, 1040, 660, 90);
    obj('dsp-send', 'prepend dsp', 1, 1, 1040, 700, 115);
    obj('rms-size', `expr max(1\\, min(19200\\, int($f1 * ${RMS_WINDOW_MS / 1000})))`, 1, 1, 1040, 740, 310);
    obj('high-cutoff', 'expr min(12000.\\, $f1 * 0.45)', 1, 1, 1040, 780, 250);
    obj('sample-clock', `qmetro ${PUBLISH_MS}`, 2, 1, 1040, 820, 95);
    wire('dsp-state', 0, 'sample-clock', 0, 0);
    wire('dsp-state', 0, 'dsp-send', 0, 1); wire('dsp-send', 0, 'node');
    wire('dsp-state', 1, 'rms-size', 0, 0); wire('dsp-state', 1, 'high-cutoff', 0, 1);
    obj('sample-order', 't b b b b b b b b', 1, 8, 1040, 860, 210);
    obj('rms-pack', 'pack f f f f f f f f', 8, 1, 560, 940, 190);
    obj('rms-send', 'prepend rms', 1, 1, 560, 980, 110);
    wire('sample-clock', 0, 'sample-order'); wire('rms-pack', 0, 'rms-send'); wire('rms-send', 0, 'node');
    for (let side = 0; side < 2; side++) {
      const x = 150 + side * 430;
      for (const [edge, frequency, column] of [['sub', 20, 0], ['bass', 250, 1], ['mids', 2000, 2], ['highs', 12000, 3]]) {
        obj(`${edge}-${side}`, `cross~ ${frequency}`, 2, 2, x + column * 100, 700, 95);
      }
      wire('audio-in', side, `sub-${side}`, 0, 1);
      wire(`sub-${side}`, 1, `bass-${side}`);
      wire(`bass-${side}`, 1, `mids-${side}`, 0, 1);
      wire(`mids-${side}`, 1, `highs-${side}`, 0, 1);
      wire('high-cutoff', 0, `highs-${side}`, 1, side);
      const sources = [['audio-in', side], [`bass-${side}`, 0], [`mids-${side}`, 0], [`highs-${side}`, 0]];
      sources.forEach(([source, outlet], band) => {
        const index = band * 2 + side;
        const rms = `rms-${index}`;
        // Initial 960 samples = 20ms at 48k. dspstate~ sets N = sampleRate * 20ms.
        obj(rms, 'average~ 960 rms', 1, 1, x + band * 100, 780, 130);
        obj(`snapshot-${index}`, 'snapshot~', 1, 1, x + band * 100, 860, 90);
        wire(source, outlet, rms, 0, source === 'audio-in' ? 2 : 0);
        wire('rms-size', 0, rms, 0, index);
        wire(rms, 0, `snapshot-${index}`);
        // Right-to-left: pack's hot Level-L inlet is updated LAST. One atomic four-band frame.
        wire('sample-order', index, `snapshot-${index}`);
        wire(`snapshot-${index}`, 0, 'rms-pack', index);
      });
    }
  }
  return { patcher: {
    fileversion: 1, classnamespace: 'box', rect: [0, 0, 1400, 1120],
    default_fontsize: 12, default_fontname: 'Arial', openinpresentation: 1, devicewidth: 1040,
    ...(kind === 'midi' ? { is_mpe: 1 } : {}), boxes, lines,
    parameters: { ...parameters, parameterbanks: {
      0: { index: 0, name: 'LEDrums macros', parameters: Array.from({ length: 8 }, (_, i) => `macro-${i + 1}`) },
    } },
    dependency_cache: SCRIPT_FILES.map((name) => ({ name, type: 'TEXT', implicit: 1 })),
    autosave: 0,
  } };
}

function renderPatch(kind) { return `${JSON.stringify(buildPatch(kind), null, 2)}\n`; }
function generate({ check = false } = {}) {
  for (const kind of ['midi', 'audio']) {
    const file = path.join(__dirname, `ledrums-${kind}.maxpat`);
    const source = renderPatch(kind);
    if (check) {
      if (!fs.existsSync(file) || fs.readFileSync(file, 'utf8') !== source) throw new Error(`Regenerate ${path.basename(file)} with node integrations/ableton/generate.cjs`);
    } else fs.writeFileSync(file, source);
  }
}
if (require.main === module) {
  const args = process.argv.slice(2);
  if (args.some((arg) => arg !== '--check') || args.length > 1) {
    console.error('Usage: node integrations/ableton/generate.cjs [--check]'); process.exitCode = 1;
  } else {
    try { generate({ check: args.includes('--check') }); }
    catch (error) { console.error(error.message); process.exitCode = 1; }
  }
}
module.exports = { SCRIPT_FILES, buildPatch, renderPatch, generate };
