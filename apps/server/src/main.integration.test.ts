import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { createSocket } from 'node:dgram';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { describe, expect, it } from 'vitest';
import { defaultProject } from '@ledrums/core';
import WebSocket from 'ws';
import type { ClientMessage, ServerMessage } from './ws-protocol';
import { LIVE_STATE_FILE } from './project-storage';

async function freePorts() {
  const tcp = createServer(); tcp.listen(0, '127.0.0.1'); await once(tcp, 'listening');
  const port = (tcp.address() as { port: number }).port;
  await new Promise<void>((r) => tcp.close(() => r()));
  const udp = createSocket('udp4'); udp.bind(0, '127.0.0.1'); await once(udp, 'listening');
  const oscPort = udp.address().port; udp.close();
  return { port, oscPort };
}
async function start(dir: string, mode: string) {
  const { port, oscPort } = await freePorts();
  // Deliberate allowlist: never inherit the operator's tunnel, credentials, hardware or telemetry config.
  const child = spawn(process.execPath, ['--import', 'tsx', 'src/main.ts'], {
    cwd: process.cwd(), env: { PATH: process.env.PATH, HOME: process.env.HOME, TMPDIR: process.env.TMPDIR,
      PORT: String(port), OSC_PORT: String(oscPort), LEDRUMS_PROJECTS_DIR: dir,
      LEDRUMS_ENGINE: mode, LEDRUMS_TELEMETRY: 'off' }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  child.stdout.on('data', (data) => { log += String(data); });
  child.stderr.on('data', (data) => { log += String(data); });
  async function until(test: () => boolean) {
    const end = Date.now() + 8000;
    while (!test()) {
      if (child.exitCode !== null || Date.now() > end) throw new Error(log || 'Server wait timed out');
      await new Promise((r) => setTimeout(r, 10));
    }
  }
  try { await until(() => log.includes('server listening')); }
  catch (error) { child.kill('SIGKILL'); throw error; }
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
  const messages: ServerMessage[] = [];
  ws.on('message', (data, binary) => { if (!binary) messages.push(JSON.parse(data.toString()) as ServerMessage); });
  await once(ws, 'open');
  const states = () => messages.filter((m) => m.t === 'state');
  await until(() => states().length > 0);
  return { messages, states, until,
    send: (msg: ClientMessage) => ws.send(JSON.stringify(msg)),
    async stop() {
      ws.close();
      const exited = once(child, 'exit'); child.kill('SIGTERM');
      const deadline = setTimeout(() => child.kill('SIGKILL'), 8000);
      try { const [code] = await exited; expect(code, log).toBe(0); }
      finally { clearTimeout(deadline); }
    },
  };
}

for (const mode of ['voice', 'legacy']) describe(`real main ${mode} / loopback control only`, () => {
  it('loads, restores once, and cold-recovers the atomic authority with no browser resync', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'ledrums-main-'));
    const old = defaultProject(); old.name = 'old'; old.output.state = 'disabled'; old.output.host = '127.0.0.1'; old.output.broadcast = false;
    const next = structuredClone(old); next.name = 'loaded'; next.inputMap.midiChannel = 9; next.composition.transport.bpm = 177;
    for (const drum of next.kit.drums) drum.hoops = [{ pixelCount: 3, reverse: false }];
    await writeFile(join(dir, 'default.local.json'), JSON.stringify(old));
    await writeFile(join(dir, 'fixture.json'), JSON.stringify(next));
    let app: Awaited<ReturnType<typeof start>> | undefined;
    try {
      app = await start(dir, mode);
      app.send({ t: 'loadProject', name: 'fixture' });
      await app.until(() => app!.states().some((s) => s.project.name === 'loaded'));
      const loaded = app.states().at(-1)!;
      expect(loaded.project.inputMap.midiChannel).toBe(9);
      expect(loaded.project.composition.transport.bpm).toBe(177);
      expect(loaded.model.count).toBe(12);
      const lib = { version: 1, data: { activeShowId: 'show', shows: { show: { id: 'show', authored: { graphs: {}, buses: [], effects: [], presets: [], songs: [] } } } } };
      app.send({ t: 'setShowLibrary', library: lib });
      app.send({ t: 'setProject', patch: { name: 'patched', kit: loaded.project.kit, inputMap: loaded.project.inputMap, output: loaded.project.output } });
      await app.until(() => app!.states().some((s) => s.project.name === 'patched'));
      app.send({ t: 'listBackups' });
      await app.until(() => app!.messages.some((m) => m.t === 'backups'));
      const list = app.messages.find((m) => m.t === 'backups')!;
      if (list.t !== 'backups') throw new Error('No backups');
      const id = list.items.find((m) => m.reason === 'pre-risk')!.id;
      const count = app.states().length;
      app.send({ t: 'restoreBackup', id });
      await app.until(() => app!.states().length > count);
      await new Promise((r) => setTimeout(r, 80));
      expect(app.states()).toHaveLength(count + 1);
      expect(app.states().at(-1)!.project.name).toBe('loaded');
      expect(app.states().at(-1)!.showLibrary).toEqual(lib);
      expect(app.messages.filter((m) => m.t === 'error')).toEqual([]);
      await app.stop(); app = undefined;
      const persisted = JSON.parse(await readFile(join(dir, LIVE_STATE_FILE), 'utf8'));
      expect(persisted.files.project.name).toBe('loaded');
      // The old three-file source still says "old"; only the new atomic authority may win.
      app = await start(dir, mode);
      expect(app.states()[0]!.project.name).toBe('loaded');
      expect(app.states()[0]!.showLibrary).toEqual(lib);
      expect(app.states()[0]!.model.count).toBe(12);
    } finally {
      await app?.stop();
      await rm(dir, { recursive: true, force: true });
    }
  }, 30_000);
});
