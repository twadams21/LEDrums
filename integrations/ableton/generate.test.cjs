'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { buildPatch, renderPatch, SCRIPT_FILES } = require('./generate.cjs');
function inspect(kind) {
  const patch = buildPatch(kind).patcher;
  const boxes = new Map(patch.boxes.map(({ box }) => [box.id, box]));
  const lines = patch.lines.map(({ patchline }) => patchline);
  const cord = (from, outlet, to, inlet = 0) => lines.find((line) => line.source[0] === from && line.source[1] === outlet && line.destination[0] === to && line.destination[1] === inlet);
  return { patch, boxes, lines, cord };
}

for (const kind of ['midi', 'audio']) {
  test(`${kind} .maxpat bytes exactly match the deterministic generator; no binary or machine paths`, () => {
    const file = path.join(__dirname, `ledrums-${kind}.maxpat`);
    const disk = fs.readFileSync(file, 'utf8');
    assert.equal(disk, renderPatch(kind));
    assert.deepEqual(JSON.parse(disk), buildPatch(kind));
    assert.doesNotMatch(disk, /(?:\/Users\/|\/home\/|[A-Z]:\\\\|bootpath|patcherrelativepath|host.?token)/i);
    assert.match(disk, /not packaged or verified in Live/);
  });
  test(`${kind} graph has unique object IDs and valid connection/parameter endpoints`, () => {
    const { patch, boxes, lines } = inspect(kind);
    assert.equal(boxes.size, patch.boxes.length);
    const unique = new Set();
    for (const line of lines) {
      const [source, outlet] = line.source;
      const [destination, inlet] = line.destination;
      assert.ok(boxes.has(source), source); assert.ok(boxes.has(destination), destination);
      assert.ok(outlet >= 0 && outlet < boxes.get(source).numoutlets, `${source} outlet ${outlet}`);
      assert.ok(inlet >= 0 && inlet < boxes.get(destination).numinlets, `${destination} inlet ${inlet}`);
      const key = JSON.stringify([line.source, line.destination]);
      assert.ok(!unique.has(key), `duplicate wire ${key}`); unique.add(key);
    }
    for (const [id, names] of Object.entries(patch.parameters)) {
      if (id === 'parameterbanks') continue;
      assert.ok(boxes.has(id));
      assert.equal(names[0], boxes.get(id).saved_attribute_attributes.valueof.parameter_longname);
    }
    for (const box of boxes.values()) {
      if (!box.presentation) continue;
      const [x, y, width, height] = box.presentation_rect;
      assert.ok(x >= 0 && y >= 0 && width > 0 && height > 0);
      assert.ok(x + width <= patch.devicewidth && y + height <= 169, `${box.id} fits M4L presentation`);
    }
  });
  test(`${kind} ID/name are stored-only Blobs, template identity blank; macros stable normalized parameters`, () => {
    const { boxes } = inspect(kind);
    for (const id of ['source-id', 'source-name']) {
      const box = boxes.get(id);
      const parameter = box.saved_attribute_attributes.valueof;
      assert.match(box.text, /pattr .*@parameter_enable 1/);
      assert.equal(parameter.parameter_invisible, 1, 'Stored Only, never Hidden (2)');
      assert.equal(parameter.parameter_type, 3, 'Blob');
    }
    assert.deepEqual(boxes.get('source-id').restore, ['']);
    assert.deepEqual(boxes.get('source-id').saved_attribute_attributes.valueof.parameter_initial, ['']);
    const port = boxes.get('port').saved_attribute_attributes.valueof;
    assert.equal(port.parameter_initial[0], 4322);
    assert.equal(port.parameter_invisible, 1);
    for (let index = 1; index <= 8; index++) {
      const box = boxes.get(`macro-${index}`);
      const parameter = box.saved_attribute_attributes.valueof;
      assert.equal(box.maxclass, 'live.dial');
      assert.equal(box.parameter_enable, 1);
      assert.equal(parameter.parameter_longname, `LEDrums Macro ${index}`);
      assert.equal(parameter.parameter_invisible, 0);
      assert.equal(parameter.parameter_type, 0);
      assert.equal(parameter.parameter_mmin, 0); assert.equal(parameter.parameter_mmax, 1);
    }
  });
  test(`${kind} restoration waits for Live + Node, start is last, disposal is explicit`, () => {
    const { boxes, cord } = inspect(kind);
    assert.match(boxes.get('node').text, /^node.script max-bridge.cjs .*@autostart 1 .*@defer 1$/);
    assert.ok(cord('live-ready-order', 1, 'live-ready-flag', 1));
    assert.ok(cord('live-ready-order', 0, 'node-ready-flag'));
    assert.ok(cord('node-ready-order', 1, 'node-ready-flag', 1));
    assert.ok(cord('node-ready-order', 0, 'live-ready-flag'));
    assert.ok(cord('both-ready-live', 0, 'replay'));
    assert.ok(cord('both-ready-node', 0, 'replay'));
    assert.ok(cord('replay', boxes.get('replay').numoutlets - 1, 'source-id'));
    assert.ok(cord('replay', 0, 'start'));
    assert.ok(cord('from-node', 1, 'source-id'), 'generated UUID writes the stored parameter');
    assert.ok(cord('from-node', 2, 'status-set'));
    assert.ok(cord('status-set', 0, 'status'));
    assert.ok(cord('close', 0, 'dispose')); assert.ok(cord('dispose', 0, 'node'));
    assert.ok(cord('new-identity', 0, 'node'));
    assert.ok(![...boxes.values()].some((box) => /^(?:loadbang|shell|udpsend|udpreceive|live.remote~)\b/.test(box.text ?? '')));
  });
}

test('musical MIDI stays one direct cord ordered before the deferred analysis copy', () => {
  const { boxes, cord, lines } = inspect('midi');
  assert.equal(boxes.get('midi-in').text, 'midiin');
  assert.equal(boxes.get('midi-out').text, 'midiout');
  assert.equal(cord('midi-in', 0, 'midi-out').order, 0);
  assert.equal(cord('midi-in', 0, 'midi-defer').order, 1);
  assert.equal(boxes.get('midi-defer').text, 'deferlow');
  assert.ok(cord('midi-defer', 0, 'midi-send')); assert.ok(cord('midi-send', 0, 'node'));
  assert.equal(lines.filter((line) => line.destination[0] === 'midi-out').length, 1);
});

test('stereo audio stays direct; independent crossover/RMS branches form one ordered snapshot', () => {
  const { boxes, cord, lines } = inspect('audio');
  assert.equal(boxes.get('audio-in').text, 'plugin~');
  assert.equal(boxes.get('audio-out').text, 'plugout~');
  assert.ok(cord('audio-in', 0, 'audio-out', 0)); assert.ok(cord('audio-in', 1, 'audio-out', 1));
  assert.equal(lines.filter((line) => line.destination[0] === 'audio-out').length, 2);
  assert.equal(boxes.get('sample-clock').text, 'qmetro 34');
  assert.match(boxes.get('rms-size').text, /\$f1 \* 0\.02/);
  assert.match(boxes.get('high-cutoff').text, /12000/);
  assert.match(boxes.get('high-cutoff').text, /\$f1 \* 0\.45/);
  for (let side = 0; side < 2; side++) {
    assert.ok(cord('audio-in', side, `sub-${side}`));
    assert.ok(cord(`sub-${side}`, 1, `bass-${side}`));
    assert.ok(cord(`bass-${side}`, 1, `mids-${side}`));
    assert.ok(cord(`mids-${side}`, 1, `highs-${side}`));
    assert.ok(cord('high-cutoff', 0, `highs-${side}`, 1));
    for (let band = 0; band < 4; band++) {
      const index = band * 2 + side;
      assert.equal(boxes.get(`rms-${index}`).text, 'average~ 960 rms');
      assert.ok(cord('rms-size', 0, `rms-${index}`));
      assert.ok(cord(`rms-${index}`, 0, `snapshot-${index}`));
      assert.ok(cord('sample-order', index, `snapshot-${index}`));
      assert.ok(cord(`snapshot-${index}`, 0, 'rms-pack', index));
    }
  }
  assert.ok(cord('rms-pack', 0, 'rms-send')); assert.ok(cord('rms-send', 0, 'node'));
});

test('every local runtime dependency is included in the dependency manifest, no npm installs', () => {
  const dependencies = inspect('midi').patch.dependency_cache.map((entry) => entry.name);
  assert.deepEqual(dependencies, SCRIPT_FILES);
  for (const file of SCRIPT_FILES) {
    const source = fs.readFileSync(path.join(__dirname, file), 'utf8');
    for (const match of source.matchAll(/require\('([^']+)'\)/g)) {
      const target = match[1];
      if (target.startsWith('./')) assert.ok(SCRIPT_FILES.includes(target.slice(2)), `${file} -> ${target}`);
      else assert.ok(target.startsWith('node:') || target === 'max-api', `unexpected external ${target}`);
    }
  }
});
