export const HELP = `Usage: node scripts/perf-dev/run.mjs --url ws://127.0.0.1:4399/ws --allow-mutations
  --voices 8       requested concurrent spatial voices (1..32)
  --warmup 5       seconds before measurement (0..120; must cover server warmup + window)
  --duration 15    measured seconds (2..120)
  --help

Connects ONLY to an already-running isolated LEDrums dev server. Starts no software.
Requires a literal loopback, non-default port, disabled output, non-default OSC port,
manual transport, browser/WS audio source and sole-editor ownership. Never takes over or changes output/input settings.
Replaces ephemeral runtime Show; clears it on safe completion, never saves a library.
JSON goes to stdout. Every result is a machine-local observation, not a live-machine prediction.`;

export function assertIsolatedUrl(raw) {
  let url;
  try { url = new URL(raw); } catch { throw new Error('Provide --url ws://127.0.0.1:<isolated-port>/ws'); }
  if (url.protocol !== 'ws:' || !['127.0.0.1', '[::1]'].includes(url.hostname) ||
      !url.port || ['80', '443', '4321', '5173', '9000'].includes(url.port) ||
      url.pathname !== '/ws' || url.username || url.password || url.search || url.hash) {
    throw new Error('Refusing non-isolated URL: use literal loopback ws://127.0.0.1:<non-default-port>/ws, no credentials/query');
  }
  return url.href;
}

export function parseOptions(args) {
  if (args.length === 1 && args[0] === '--help') return { help: true };
  const options = { voices: 8, warmupMs: 5000, durationMs: 15000, allowMutations: false, timeoutMs: 10_000 };
  const seen = new Set();
  for (let i = 0; i < args.length; i++) {
    const key = args[i];
    if (seen.has(key)) throw new Error(`Repeated option ${key}`);
    seen.add(key);
    if (key === '--allow-mutations') { options.allowMutations = true; continue; }
    if (!['--url', '--voices', '--warmup', '--duration'].includes(key)) throw new Error(`Unknown option ${key}`);
    const raw = args[++i];
    if (!raw || raw.startsWith('--')) throw new Error(`Missing value for ${key}`);
    if (key === '--url') { options.url = raw; continue; }
    const value = Number(raw);
    if (!Number.isFinite(value) || value < 0) throw new Error(`Invalid ${key}`);
    if (key === '--voices') options.voices = value;
    else if (key === '--warmup') options.warmupMs = value * 1000;
    else options.durationMs = value * 1000;
  }
  validateOptions(options);
  return options;
}

export function validateOptions(options) {
  // This guard also runs inside the injectable runner, not only its CLI.
  if (options.allowMutations !== true) throw new Error('Refusing mutation without explicit --allow-mutations');
  assertIsolatedUrl(options.url);
  if (!Number.isInteger(options.voices) || options.voices < 1 || options.voices > 32) throw new Error('--voices must be 1..32');
  if (!Number.isFinite(options.warmupMs) || options.warmupMs < 0 || options.warmupMs > 120_000) throw new Error('--warmup must be 0..120 seconds');
  if (!Number.isFinite(options.durationMs) || options.durationMs < 2000 || options.durationMs > 120_000) throw new Error('--duration must be 2..120 seconds');
  if (!Number.isFinite(options.timeoutMs) || options.timeoutMs < 1 || options.timeoutMs > 30_000) throw new Error('Invalid timeout');
}

export function assertStateSafe(state) {
  if (state?.output?.state !== 'disabled' || state?.project?.output?.state !== 'disabled') {
    throw new Error('Refusing: server must report output disabled (not merely blackout/muted). No output setting will be changed.');
  }
  if (!Number.isInteger(state.osc?.port) || state.osc.port <= 0 || state.osc.port === 9000) {
    throw new Error('Refusing: isolated server must report a non-default OSC port');
  }
  if (state.tunnel && state.tunnel.status !== 'off') throw new Error('Refusing: isolated server must not share a tunnel');
  if (state.project.composition?.transport?.source !== 'manual') throw new Error('Refusing: use an isolated manual-clock project; benchmark never changes tempo/source');
  if (state.project.inputMap?.trackAudioInput != null) throw new Error('Refusing: this workload requires the browser/WS audio source, not a selected track; no input setting will be changed');
  if (!Number.isInteger(state.model?.count) || state.model.count < 1) throw new Error('Need a nonempty server pixel model');
  if (!Number.isInteger(state.showRevision) || typeof state.sessionId !== 'string' || !state.sessionId) throw new Error('Need server session/revision identity');
}

export function assertPresenceSafe(presence) {
  if (presence?.youAreEditor !== true || presence.clientCount !== 1) {
    throw new Error('Refusing: benchmark must be the isolated server\'s sole client/editor; no takeover will be sent');
  }
}
