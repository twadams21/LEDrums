'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const {
  buildPatch, renderPatch, renderDevice, SCRIPT_FILES, DEVICE_FILES, PACK_FOLDER,
  READ_ME, READ_ME_TEXT, BUILD_TAG, SOURCE_TAG, pack, packedNames,
} = require('./generate.cjs');
const { read } = require('./amxd.cjs');

function scratch(prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  test.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}
// A throwaway copy of this folder, so --check staleness can be provoked without touching the repo.
function sandbox() {
  const dir = scratch('ledrums-amxd-');
  for (const name of fs.readdirSync(__dirname)) {
    if (fs.statSync(path.join(__dirname, name)).isFile()) fs.copyFileSync(path.join(__dirname, name), path.join(dir, name));
  }
  return dir;
}
const generator = (cwd, ...args) => spawnSync(process.execPath, [path.join(cwd, 'generate.cjs'), ...args], { cwd, encoding: 'utf8' });
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
  for (const kind of ['midi', 'audio']) {
    const dependencies = inspect(kind).patch.dependency_cache.map((entry) => entry.name);
    assert.deepEqual(dependencies, SCRIPT_FILES, `${kind} dependency_cache`);
    // The hand-off folder must carry exactly what both devices declare, and every file must exist.
    for (const name of dependencies) assert.ok(fs.existsSync(path.join(__dirname, name)), name);
  }
  for (const file of SCRIPT_FILES) {
    const source = fs.readFileSync(path.join(__dirname, file), 'utf8');
    for (const match of source.matchAll(/require\('([^']+)'\)/g)) {
      const target = match[1];
      if (target.startsWith('./')) assert.ok(SCRIPT_FILES.includes(target.slice(2)), `${file} -> ${target}`);
      else assert.ok(target.startsWith('node:') || target === 'max-api', `unexpected external ${target}`);
    }
  }
});

for (const kind of ['midi', 'audio']) {
  test(`${kind} .amxd on disk is the deterministic container and carries the Live device fields`, () => {
    const disk = fs.readFileSync(path.join(__dirname, DEVICE_FILES[kind]));
    assert.ok(disk.equals(renderDevice(kind)), 'committed device bytes are stale');
    const device = read(disk);
    assert.equal(device.kind, kind);
    assert.deepEqual(device.patcher, buildPatch(kind, { target: 'amxd' }));
    assert.equal(device.json, renderPatch(kind, { target: 'amxd' }));

    const patch = device.patcher.patcher;
    assert.equal(patch.openinpresentation, 1);
    assert.equal(patch.devicewidth, 1040);
    assert.equal(patch.is_mpe, kind === 'midi' ? 1 : 0);
    assert.equal(patch.external_mpe_tuning_enabled, 0);
    assert.equal(patch.platform_compatibility, 0);
    assert.equal(patch.latency, 0);
    assert.equal(patch.minimum_live_version, '');
    assert.equal(patch.minimum_max_version, '');
    assert.deepEqual(patch.saved_attribute_attributes, { default_plcolor: { expression: '' } });
    // amxdtype is the device fourcc read as a uint32; a real Max MIDI device stores 1835887981.
    assert.equal(patch.project.amxdtype, Buffer.from(device.type, 'latin1').readUInt32BE(0));
    assert.equal(patch.project.amxdtype, kind === 'midi' ? 1835887981 : 1633771873);
    assert.deepEqual(patch.project.contents, { patchers: {} });
    assert.equal(patch.project.devpath, '.');
    assert.equal(patch.project.version, 1);
    assert.equal(patch.project.creationdate, patch.project.modificationdate, 'fixed date, not a wall clock');
    assert.ok(Number.isInteger(patch.project.creationdate));
    assert.deepEqual(patch.dependency_cache.map((entry) => entry.name), SCRIPT_FILES);
  });
}

test('the device label is the build tag; only the loose .maxpat keeps the source warning', () => {
  const labelOf = (patch) => patch.patcher.boxes.find(({ box }) => box.id === 'source-only').box.text;
  for (const kind of ['midi', 'audio']) {
    assert.equal(labelOf(buildPatch(kind, { target: 'amxd' })), BUILD_TAG);
    assert.equal(labelOf(buildPatch(kind)), SOURCE_TAG);
    assert.doesNotMatch(read(fs.readFileSync(path.join(__dirname, DEVICE_FILES[kind]))).json, /not packaged or verified in Live/);
  }
});

test('--check passes on the committed tree, generation repeats byte-identically, and staleness fails', () => {
  const dir = sandbox();
  assert.equal(generator(dir, '--check').status, 0, 'committed .maxpat/.amxd must already be current');
  const digest = () => [...Object.values(DEVICE_FILES), 'ledrums-midi.maxpat', 'ledrums-audio.maxpat']
    .map((name) => fs.readFileSync(path.join(dir, name)).toString('base64'));
  const first = digest();
  assert.equal(generator(dir).status, 0);
  assert.deepEqual(digest(), first, 'two generator runs must produce identical bytes');

  const stale = path.join(dir, DEVICE_FILES.midi);
  const bytes = fs.readFileSync(stale);
  fs.writeFileSync(stale, bytes.subarray(0, bytes.length - 1));
  const failed = generator(dir, '--check');
  assert.equal(failed.status, 1);
  assert.match(failed.stderr, /Regenerate LEDrums MIDI\.amxd/);
  assert.equal(generator(dir).status, 0, 'regenerating repairs it');
  assert.equal(generator(dir, '--check').status, 0);
});

test('--pack writes exactly the hand-off set and refuses a folder that already holds anything', () => {
  const dir = scratch('ledrums-pack-');
  const folder = pack(dir);
  assert.equal(folder, path.join(dir, PACK_FOLDER));
  assert.deepEqual(fs.readdirSync(folder).sort(), packedNames());
  assert.deepEqual(packedNames(), [...Object.values(DEVICE_FILES), ...SCRIPT_FILES, READ_ME].sort());
  // No tests, CLI, generator or .maxpat may travel with the devices.
  for (const name of fs.readdirSync(folder)) {
    assert.doesNotMatch(name, /\.test\.cjs$|\.maxpat$|^generate\.cjs$|^synthetic-sender\.cjs$|^test-helpers\.cjs$|^amxd\.cjs$|^README\.md$/, name);
  }
  for (const kind of ['midi', 'audio']) {
    const packed = fs.readFileSync(path.join(folder, DEVICE_FILES[kind]));
    assert.ok(packed.equals(fs.readFileSync(path.join(__dirname, DEVICE_FILES[kind]))), `${kind} packed bytes differ from the committed device`);
  }
  for (const name of SCRIPT_FILES) {
    assert.ok(fs.readFileSync(path.join(folder, name)).equals(fs.readFileSync(path.join(__dirname, name))), name);
  }
  const before = fs.readdirSync(folder).sort();
  assert.throws(() => pack(dir), /--pack never deletes/);
  assert.deepEqual(fs.readdirSync(folder).sort(), before, 'a refused pack must not delete or change anything');
  assert.throws(() => pack(), /--pack needs a destination folder/);
  // An empty pre-made folder is fine; only content is refused.
  const second = scratch('ledrums-pack2-');
  fs.mkdirSync(path.join(second, PACK_FOLDER));
  assert.deepEqual(fs.readdirSync(pack(second)).sort(), packedNames());
});

test('READ ME FIRST stays short, numbered and truthful about the status strings it promises', () => {
  const lines = READ_ME_TEXT.replace(/\n$/, '').split('\n');
  assert.ok(lines.length <= 25, `READ ME FIRST is ${lines.length} lines`);
  assert.equal(lines.filter((line) => /^\s*\d+\. /.test(line)).length, 10, 'ten numbered steps');
  const runtime = fs.readFileSync(path.join(__dirname, 'device-runtime.cjs'), 'utf8');
  for (const quoted of READ_ME_TEXT.matchAll(/"([^"]+)"/g)) {
    const text = quoted[1];
    if (text.startsWith('LEDrums MIDI') || text.startsWith('LEDrums Audio') || text.startsWith('LEDrums-Node')) continue;
    assert.ok(runtime.includes(text), `READ ME FIRST promises a status the device never prints: ${text}`);
  }
  assert.match(READ_ME_TEXT, /FIRST TEST BUILD/);
  assert.match(READ_ME_TEXT, /0\.3\.2/);
  assert.match(READ_ME_TEXT, /Max for Live/);
});
