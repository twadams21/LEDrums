import { execFileSync, spawn } from 'node:child_process';
import { connect, createServer } from 'node:net';
import { createSocket } from 'node:dgram';
import { mkdtemp, open, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { describe, expect, it } from 'vitest';
import { defaultProject } from '@ledrums/core';
import WebSocket from 'ws';
import type { ClientMessage, ServerMessage } from './ws-protocol';
import { LIVE_STATE_FILE } from './project-storage';

async function freePorts() {
  const tcp = createServer(); tcp.listen(0); await once(tcp, 'listening');
  const port = (tcp.address() as { port: number }).port;
  await new Promise<void>((r) => tcp.close(() => r()));
  const udp = createSocket('udp4'); udp.bind(0, '127.0.0.1'); await once(udp, 'listening');
  const oscPort = udp.address().port; udp.close();
  return { port, oscPort };
}
async function start(dir: string, mode: string) {
  const { port, oscPort } = await freePorts();
  // Deliberate allowlist: never inherit the operator's tunnel, credentials, hardware or telemetry config.
  // Optional isolated, actually injected SEA (not a CJS-only approximation) runs the SAME
  // load/restore/shutdown/cold-recovery assertions. Never inherit app credentials/output config.
  const child = spawn(process.env.P11_SEA_BINARY ?? process.execPath,
    process.env.P11_SEA_BINARY ? [] : ['--import', 'tsx', 'src/main.ts'], {
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
  let stopped: Promise<void> | undefined;
  function stop(): Promise<void> {
    return stopped ??= (async () => {
      // Keep the editor connected: server teardown must not revoke accepted queued work.
      const exited = once(child, 'exit'); child.kill('SIGTERM');
      const deadline = setTimeout(() => child.kill('SIGKILL'), 8000);
      try { const [code] = await exited; expect(code, log).toBe(0); }
      finally { clearTimeout(deadline); ws.terminate(); }
    })();
  }
  return { messages, states, until, stop,
    disconnect: () => ws.close(),
    async viewer() {
      const viewer = new WebSocket(`ws://127.0.0.1:${port}/ws`);
      await once(viewer, 'open');
      return { send: (msg: ClientMessage) => viewer.send(JSON.stringify(msg)),
        async roundTrip() { const pong = once(viewer, 'pong'); viewer.ping(); await pong; },
        close: () => viewer.terminate() };
    },
    send: (msg: ClientMessage) => ws.send(JSON.stringify(msg)),
    async roundTrip() { const pong = once(ws, 'pong'); ws.ping(); await pong; },
    async untilIngressClosed() {
      const end = Date.now() + 4000;
      while (await new Promise<boolean>((resolve) => {
        const socket = connect(port, '127.0.0.1');
        socket.on('connect', () => { socket.destroy(); resolve(true); });
        socket.on('error', () => { socket.destroy(); resolve(false); });
      })) {
        if (Date.now() > end) throw new Error('Shutdown still accepts connections');
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
    },
  };
}

for (const mode of ['voice', 'legacy']) describe(`real ${process.env.P11_SEA_BINARY ? 'SEA' : 'source'} main ${mode} / loopback control only`, () => {
  it.skipIf(process.platform === 'win32').each([false, true])('SIGTERM drains the accepted FIFO edit and rejects new actions (peer disconnect=%s)', async (disconnect) => {
    const dir = await mkdtemp(join(tmpdir(), 'ledrums-shutdown-'));
    const project = defaultProject(); project.name = 'queued-load';
    project.output.state = 'disabled'; project.output.host = '127.0.0.1'; project.output.broadcast = false;
    await writeFile(join(dir, 'default.local.json'), JSON.stringify(project));
    const fifo = join(dir, 'blocked.json'); execFileSync('mkfifo', [fifo]);
    let app: Awaited<ReturnType<typeof start>> | undefined;
    let writer: Awaited<ReturnType<typeof open>> | undefined;
    let completion: Promise<void> | undefined;
    let viewer: Awaited<ReturnType<Awaited<ReturnType<typeof start>>['viewer']>> | undefined;
    const library = { version: 2, data: { activeShowId: 'accepted', shows: {} } };
    try {
      app = await start(dir, mode);
      viewer = await app.viewer();
      app.send({ t: 'loadProject', name: 'blocked' });
      // Opening the writer acknowledges that real main is waiting inside named-project read.
      writer = await open(fifo, 'w');
      app.send({ t: 'setShowLibrary', library });
      await app.roundTrip(); // wire-ordered ping proves the edit reached dispatch before SIGTERM
      completion = app.stop();
      await app.untilIngressClosed(); // positive shutdown barrier, not a timing-only sleep
      app.send({ t: 'setShowLibrary', library: { ...library, data: { ...library.data, activeShowId: 'too-late' } } });
      viewer.send({ t: 'takeover' }); // must not steal the accepted edit's authorization
      app.send({ t: 'setOutput', fps: 12 });
      await viewer.roundTrip();
      if (disconnect) app.disconnect();
      // Leave time for the old early-close behavior to revoke the editor before releasing IO.
      await new Promise((resolve) => setTimeout(resolve, 100));
      await writer.writeFile(JSON.stringify(project)); await writer.close(); writer = undefined;
      await completion; completion = undefined; app = undefined;
      const persisted = JSON.parse(await readFile(join(dir, LIVE_STATE_FILE), 'utf8'));
      expect(persisted.files.showLibrary).toEqual(library);
      expect(persisted.files.project.output.fps).toBe(project.output.fps);
      app = await start(dir, mode);
      expect(app.states()[0]!.showLibrary).toEqual(library);
    } finally {
      await writer?.close();
      viewer?.close();
      await (completion ?? app?.stop());
      await rm(dir, { recursive: true, force: true });
    }
  }, 30_000);

  it.skipIf(process.platform === 'win32')('ordinary takeover still revokes queued edits at execution', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'ledrums-takeover-'));
    const project = defaultProject(); project.output.state = 'disabled';
    project.output.host = '127.0.0.1'; project.output.broadcast = false;
    await writeFile(join(dir, 'default.local.json'), JSON.stringify(project));
    const fifo = join(dir, 'blocked.json'); execFileSync('mkfifo', [fifo]);
    let app: Awaited<ReturnType<typeof start>> | undefined;
    let viewer: Awaited<ReturnType<Awaited<ReturnType<typeof start>>['viewer']>> | undefined;
    let writer: Awaited<ReturnType<typeof open>> | undefined;
    try {
      app = await start(dir, mode); viewer = await app.viewer();
      app.send({ t: 'loadProject', name: 'blocked' }); writer = await open(fifo, 'w');
      app.send({ t: 'setShowLibrary', library: { version: 2, data: { activeShowId: 'revoked', shows: {} } } });
      await app.roundTrip();
      viewer.send({ t: 'takeover' }); await viewer.roundTrip();
      await writer.writeFile(JSON.stringify(project)); await writer.close(); writer = undefined;
      // A later FIFO read response proves the authoring queue passed the revoked library edit.
      viewer.send({ t: 'listProjects' });
      // Request from the original socket too so its own captured messages carry the barrier.
      app.send({ t: 'listProjects' });
      await app.until(() => app!.messages.some((message) => message.t === 'projects'));
      await app.stop(); app = undefined;
      expect(JSON.parse(await readFile(join(dir, LIVE_STATE_FILE), 'utf8')).files.showLibrary).toBeNull();
    } finally {
      await writer?.close(); viewer?.close(); await app?.stop();
      await rm(dir, { recursive: true, force: true });
    }
  }, 30_000);

  it('rejects unsupported library pushes before they can enter live storage', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'ledrums-library-version-'));
    const project = defaultProject(); project.name = 'version-check'; project.output.state = 'disabled';
    project.output.host = '127.0.0.1'; project.output.broadcast = false;
    await writeFile(join(dir, 'default.local.json'), JSON.stringify(project));
    await writeFile(join(dir, 'fixture.json'), JSON.stringify(project));
    let app: Awaited<ReturnType<typeof start>> | undefined;
    try {
      app = await start(dir, mode);
      app.send({ t: 'setShowLibrary', library: { version: 1, data: { shows: {} } } });
      app.send({ t: 'setSongLibrary', library: { version: 2, data: { songs: {} } } });
      await app.until(() => app!.messages.filter((message) => message.t === 'error').length === 2);
      expect(app.messages.filter((message) => message.t === 'error').map((message) => message.message))
        .toEqual([expect.stringMatching(/Unsupported show library version/), expect.stringMatching(/Unsupported song library version/)]);
      app.send({ t: 'loadProject', name: 'fixture' });
      await app.until(() => app!.states().length === 2);
      expect(app.states()[1]!.showLibrary).toBeNull();
      expect(app.states()[1]!.songLibrary).toBeNull();
      await app.stop(); app = undefined;
      const saved = JSON.parse(await readFile(join(dir, LIVE_STATE_FILE), 'utf8'));
      expect(saved.files.showLibrary).toBeNull(); expect(saved.files.songLibrary).toBeNull();
    } finally { await app?.stop(); await rm(dir, { recursive: true, force: true }); }
  }, 30_000);

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
      const lib = { version: 2, data: { activeShowId: 'show', shows: { show: { id: 'show', authored: { graphs: {}, buses: [], effects: [], presets: [], songs: [] } } } } };
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
