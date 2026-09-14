import { arch, cpus, platform, release } from 'node:os';
import { buildWorkload, audioMessage, midiMessages, emptyShow, fingerprint, AUDIO_HZ, MIDI_BURST_MS } from './workload.mjs';
import { Observations, assertTiming } from './observations.mjs';
import { assertPresenceSafe, assertStateSafe, validateOptions } from './options.mjs';

/** Injectable WebSocket + clock/timers let node:test exercise every guard/close path without
 * binding a socket, starting a server, rendering a benchmark or touching external software. */
export async function runBenchmark(options, {
  WebSocket,
  now = () => performance.now(),
  timers = { setInterval, clearInterval, setTimeout, clearTimeout },
  signal,
} = {}) {
  validateOptions(options); // BEFORE even connecting
  if (!WebSocket) throw new Error('Provide the existing server ws dependency');
  if (signal?.aborted) throw new Error('Benchmark aborted before connect');
  const processors = cpus();
  const client = {
    os: platform(), osRelease: release(), arch: arch(), node: process.version,
    cpu: processors[0]?.model ?? 'unknown', logicalCpuCount: processors.length,
  };
  return new Promise((resolve) => {
    const connectedAt = now();
    const ws = new WebSocket(options.url, { handshakeTimeout: options.timeoutMs, maxPayload: 32 * 1024 * 1024 });
    const observations = new Observations(options);
    let phase = 'handshake';
    let phaseStarted = connectedAt;
    let state = null;
    let presence = null;
    let latestTiming = null;
    let projectHash = null;
    let libraryHash = null;
    let workload = null;
    let baselineEpoch = null;
    let epoch = null;
    let baseRevision = null;
    let runStarted = null;
    let lastStatsAt = connectedAt;
    let lastTimingAt = connectedAt;
    let lastTimingEnd = -1;
    let cleanupAllowed = false;
    let mutated = false;
    let cleanupAck = null;
    let lastAudio = -1;
    let lastBurst = -1;
    const sent = { audioFrames: 0, midiMessages: 0, midiBursts: 0, skippedAudioFrames: 0, skippedMidiBursts: 0 };
    let poll = null;

    const elapsed = () => runStarted === null ? 0 : now() - runStarted;
    const send = (message) => {
      if (ws.readyState !== WebSocket.OPEN) throw new Error('Socket not open');
      if (ws.bufferedAmount > 1024 * 1024) throw new Error('Client WS backlog exceeded 1MiB; refusing to queue more synthetic input');
      ws.send(JSON.stringify(message), (error) => { if (error) void finish(error); });
    };

    function closeSocket() {
      if (ws.readyState === WebSocket.CLOSED) return Promise.resolve();
      return new Promise((done) => {
        const closed = () => { timers.clearTimeout(deadline); done(); };
        const deadline = timers.setTimeout(() => { ws.terminate(); done(); }, 1000);
        ws.once('close', closed);
        ws.close();
      });
    }

    async function clearRuntime() {
      if (!mutated) return 'not-mutated';
      if (!cleanupAllowed || ws.readyState !== WebSocket.OPEN) return 'skipped-unsafe-or-disconnected';
      // Never reconstruct/overwrite a previous Show from persisted libraries. Clear only this
      // session's ephemeral runtime, and wait for the public setShow revision acknowledgement.
      return new Promise((done) => {
        const deadline = timers.setTimeout(() => {
          cleanupAck = null;
          done('unconfirmed-timeout');
        }, 1000);
        cleanupAck = (message) => {
          if (message.t !== 'state' || message.sessionId !== state.sessionId ||
              message.showRevision !== baseRevision + 2 || message.output?.state !== 'disabled') return;
          timers.clearTimeout(deadline);
          cleanupAck = null;
          done('cleared-ephemeral-runtime');
        };
        try {
          send({ t: 'audioFeatures', level: 0, bass: 0, mids: 0, highs: 0 });
          send({ t: 'setShow', show: emptyShow() });
        } catch {
          timers.clearTimeout(deadline);
          cleanupAck = null;
          done('unconfirmed-send-failure');
        }
      });
    }

    async function finish(error = null) {
      if (phase === 'closing' || phase === 'closed') return;
      const stoppedInPhase = phase;
      phase = 'closing';
      timers.clearInterval(poll);
      signal?.removeEventListener('abort', abort);
      const result = observations.snapshot();
      if (!error && (!result.serverTiming.count || !result.preview.frames || !result.observedVoiceCount.max)) {
        error = new Error('No measured timing windows, preview frames or active synthetic voices; result is not a valid run');
      }
      const actualElapsedMs = elapsed();
      const cleanup = await clearRuntime();
      await closeSocket();
      phase = 'closed';
      if (!error && cleanup !== 'cleared-ephemeral-runtime') error = new Error(`Runtime cleanup ${cleanup}`);
      resolve({
        format: 'ledrums-perf-dev-v1', ok: !error, error: error ? String(error.message ?? error) : null,
        observation: 'Machine-local dev-server observation only. No proportional prediction for the newer live machine.',
        limits: 'No hardware, MIDI device, audio device, DAW, desktop shell or browser rendering measured. WS arrival gaps are not physical input-to-light latency.',
        metadata: {
          url: options.url, client, host: latestTiming?.host ?? null,
          targetHz: latestTiming?.targetHz ?? null, sessionId: state?.sessionId ?? null,
          warmupMs: options.warmupMs, durationMs: options.durationMs, actualClientElapsedMs: actualElapsedMs,
          serverRecordingEpochMs: epoch, workload: workload?.metadata ?? null,
          stoppedInPhase, cleanup, emissions: sent,
        },
        ...result,
      });
    }

    function abort() { void finish(new Error('Benchmark interrupted')); }

    function preflight() {
      if (phase !== 'handshake' || !state || !presence || !latestTiming) return;
      assertStateSafe(state);
      assertPresenceSafe(presence);
      assertTiming(latestTiming);
      if (options.warmupMs < latestTiming.warmupMs + latestTiming.windowMs) {
        throw new Error(`--warmup must be at least ${(latestTiming.warmupMs + latestTiming.windowMs) / 1000}s to cover recorder warmup plus a full window`);
      }
      workload = buildWorkload(state, options.voices);
      baselineEpoch = latestTiming.recordingStartedAtMs;
      baseRevision = state.showRevision;
      projectHash = fingerprint(state.project);
      libraryHash = fingerprint([state.showLibrary, state.songLibrary]);
      phase = 'adopting';
      phaseStarted = now();
      cleanupAllowed = mutated = true;
      send({ t: 'setShow', show: workload.show });
    }

    function pump() {
      if (phase === 'closing' || phase === 'closed') return;
      try {
        if (phase !== 'running') {
          if (now() - phaseStarted > options.timeoutMs) {
            throw new Error(`Timed out in ${phase}; need state + sole-editor presence + stats.timing, then setShow acknowledgement`);
          }
          return;
        }
        if (now() - lastStatsAt > options.timeoutMs || now() - lastTimingAt > options.timeoutMs) {
          cleanupAllowed = false; // the last disabled-output observation is no longer current
          throw new Error('Server stats/timing stopped advancing; current server state is no longer observable');
        }
        const ms = elapsed();
        if (ms >= options.warmupMs + options.durationMs) { void finish(); return; }
        const audioIndex = Math.floor(ms * AUDIO_HZ / 1000);
        if (audioIndex > lastAudio) {
          sent.skippedAudioFrames += Math.max(0, audioIndex - lastAudio - 1);
          send(audioMessage(audioIndex));
          lastAudio = audioIndex;
          sent.audioFrames++;
        }
        const burstIndex = Math.floor(ms / MIDI_BURST_MS);
        if (burstIndex > lastBurst) {
          sent.skippedMidiBursts += Math.max(0, burstIndex - lastBurst - 1);
          for (const message of midiMessages(workload, burstIndex)) { send(message); sent.midiMessages++; }
          lastBurst = burstIndex;
          sent.midiBursts++;
        }
      } catch (error) { void finish(error); }
    }

    ws.on('message', (data, binary) => {
      try {
        if (phase === 'closed') return;
        if (binary) {
          if (phase !== 'running') return;
          if (data.length !== state.model.count * 3) throw new Error('Preview byte count disagrees with server pixel model');
          observations.preview(elapsed(), data.length);
          return;
        }
        const message = JSON.parse(data.toString());
        if (phase === 'closing') { cleanupAck?.(message); return; }
        if (message.t === 'error') throw new Error(`Server error: ${message.message ?? message.error ?? JSON.stringify(message)}`);
        if (message.t === 'presence') {
          try { assertPresenceSafe(message); } catch (error) { cleanupAllowed = false; throw error; }
          presence = message;
        } else if (message.t === 'state') {
          try { assertStateSafe(message); } catch (error) { cleanupAllowed = false; throw error; }
          if (state && message.sessionId !== state.sessionId) { cleanupAllowed = false; throw new Error('Server session changed'); }
          if (projectHash && (fingerprint(message.project) !== projectHash ||
              fingerprint([message.showLibrary, message.songLibrary]) !== libraryHash)) {
            cleanupAllowed = false;
            throw new Error('Project/library changed during benchmark; isolation lost');
          }
          if (phase === 'running' && message.showRevision !== baseRevision + 1) {
            cleanupAllowed = false;
            throw new Error('Runtime show changed externally; refusing to clear someone else\'s show');
          }
          state = message;
          if (phase === 'adopting') {
            if (message.showRevision !== baseRevision + 1) {
              cleanupAllowed = false;
              throw new Error('Unexpected setShow acknowledgement revision');
            }
            phase = 'running';
            runStarted = phaseStarted = now();
            pump();
          }
        } else if (message.t === 'stats') {
          if (message.output?.state !== 'disabled') {
            cleanupAllowed = false;
            throw new Error('Server output is no longer disabled; stopping without changing it');
          }
          if (!message.voice || !Number.isInteger(message.voice.voiceCount) || message.voice.voiceCount < 0 ||
              !Array.isArray(message.voice.voices) || message.voice.voices.length !== message.voice.voiceCount) {
            throw new Error('Need complete voice-mode server stats');
          }
          if (message.timing) {
            assertTiming(message.timing);
            latestTiming = message.timing;
            if (message.timing.windowEndMs > lastTimingEnd) {
              lastTimingAt = now();
              lastTimingEnd = message.timing.windowEndMs;
            }
          }
          // Ordinary stats are 100 Hz, new timing windows only 1 Hz. Keep the last timing
          // separately for metadata/preflight; missing/stalled telemetry is timeout-guarded.
          lastStatsAt = now();
          if (phase === 'running') {
            if (message.timing?.recordingStartedAtMs > baselineEpoch) {
              if (epoch !== null && epoch !== message.timing.recordingStartedAtMs) {
                cleanupAllowed = false;
                throw new Error('Timing epoch changed during run');
              }
              epoch = message.timing.recordingStartedAtMs;
            }
            if (message.stats?.pixelCount !== state.model.count) throw new Error('Stats pixel count changed');
            if (message.voice.voices.some((v) => !workload.show.effects.some((e) => e.id === v.effectId))) {
              cleanupAllowed = false;
              throw new Error('Unexpected non-benchmark voice; isolation lost');
            }
            observations.stats(message, elapsed(), epoch);
          }
        }
        preflight();
      } catch (error) { void finish(error); }
    });
    ws.on('error', (error) => { cleanupAllowed = false; void finish(error); });
    ws.on('close', () => {
      if (phase !== 'closing' && phase !== 'closed') { cleanupAllowed = false; void finish(new Error('Server closed before measurement finished')); }
    });
    signal?.addEventListener('abort', abort, { once: true });
    poll = timers.setInterval(pump, 10);
  });
}
