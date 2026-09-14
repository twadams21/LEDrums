import { voice } from '@ledrums/core';
import {
  TRACK_INPUT_LIMIT, TRACK_INPUT_TIMEOUT_MS, trackInputAddress,
  type TrackPacket, type TrackInputInfo,
} from '@ledrums/protocol';

export interface TrackInputSink {
  /** Incoming MIDI/CC admission; absent permits every channel. */
  acceptsMidiChannel?(channel: number): boolean;
  /** Dispatch directly: owned releases and disconnect cleanup bypass later policy changes. */
  midi(input: { note: number; velocity: number; on: boolean; channel: number }): void;
  cc(input: { controller: number; value: number; channel: number }): void;
  osc(address: string, value: number, edge?: 'press' | 'release'): void;
  audio(id: string, frame: voice.AudioFeatureFrame): void;
}
interface Entry {
  info: TrackInputInfo;
  session: string;
  port: number;
  seq: number;
  seenAt: number;
  audioAt: number;
  rateAt: number;
  rateCount: number;
  notes: Map<string, { note: number; channel: number }>;
  controls: Set<string>;
}
const MAX_EVENTS_PER_SECOND = 512;
const MAX_HELD_NOTES = 128;
export type TrackAdmission = { ok: true } | { ok: false; reason: string };

/** Bounded device identity, lease, ordering and input lifetime behind one ingest seam.
 * Time and the input sink are injected. Neither a device nor a label becomes an editor.
 * Only the current session per retained ID is remembered: replacement/eviction discards
 * its replay history, rather than archiving an unbounded set of retired nonces. */
export class TrackInputRegistry {
  private readonly entries = new Map<string, Entry>();
  constructor(private readonly sink: TrackInputSink, private readonly now: () => number) {}

  ingest(packet: TrackPacket, port: number): TrackAdmission {
    const now = this.now();
    this.expire(now);
    let entry = this.entries.get(packet.id);
    if (packet.t === 'hello') {
      if (entry?.info.connected && (entry.session !== packet.session || entry.port !== port)) {
        return { ok: false, reason: 'duplicate-id' };
      }
      if (entry?.session === packet.session && entry.info.kind !== packet.kind) return { ok: false, reason: 'kind-changed' };
      if (!entry || entry.session !== packet.session) {
        // Only a new runtime nonce resets ordering. Timeout/bye retain the current entry.
        // Prefer evicting the oldest disconnected entry; never evict a playing device.
        if (!entry && this.entries.size >= TRACK_INPUT_LIMIT) {
          const oldest = [...this.entries.entries()].filter(([, e]) => !e.info.connected).sort((a, b) => a[1].seenAt - b[1].seenAt)[0];
          if (!oldest) return { ok: false, reason: 'capacity' };
          this.entries.delete(oldest[0]);
        }
        entry = {
          info: { id: packet.id, name: packet.name, kind: packet.kind, connected: false, lastNote: null, lastChannel: null, received: 0, dropped: 0, audio: { ...voice.ZERO_AUDIO_FRAME } },
          session: packet.session, port, seq: packet.seq - 1, seenAt: now,
          audioAt: Number.NEGATIVE_INFINITY, rateAt: now, rateCount: 0, notes: new Map(), controls: new Set(),
        };
        this.entries.set(packet.id, entry);
      }
    }
    if (!entry || entry.session !== packet.session || entry.port !== port) return { ok: false, reason: 'register-first' };
    // A departed/timed-out runtime must renew with a HIGHER sequence hello. Same-runtime
    // port/identity round trips are valid; delayed hellos/data still cannot reset ordering.
    // A fresh bye can advance the barrier without repeating disconnect cleanup.
    if (!entry.info.connected && packet.t !== 'hello' && packet.t !== 'bye') return { ok: false, reason: 'register-first' };
    if (packet.seq <= entry.seq) return { ok: false, reason: 'out-of-order' };
    entry.info.dropped += Math.max(0, packet.seq - entry.seq - 1);
    entry.seq = packet.seq;
    if (now - entry.rateAt >= 1000) { entry.rateAt = now; entry.rateCount = 0; }
    if (++entry.rateCount > MAX_EVENTS_PER_SECOND) return { ok: false, reason: 'rate-limit' };
    entry.seenAt = now;
    if (packet.t === 'hello') { entry.info.connected = true; entry.info.name = packet.name; return { ok: true }; }
    if (packet.t === 'bye') { this.disconnect(entry); return { ok: true }; }
    if ((packet.t === 'midi' || packet.t === 'cc') && entry.info.kind !== 'midi') return { ok: false, reason: 'wrong-kind' };
    if (packet.t === 'audio' && entry.info.kind !== 'audio') return { ok: false, reason: 'wrong-kind' };
    if (packet.t === 'midi' || packet.t === 'cc') {
      // Gate before raw/global controls, named OSC values and held-note bookkeeping.
      // A release belongs to its admitted press, even if policy has changed since then.
      const heldRelease = packet.t === 'midi' && (!packet.on || packet.velocity === 0)
        && entry.notes.has(`${packet.channel}:${packet.note}`);
      if (!heldRelease && this.sink.acceptsMidiChannel?.(packet.channel) === false) return { ok: false, reason: 'channel-filtered' };
    }
    entry.info.received++;
    const address = (control: string) => trackInputAddress(packet.id, control);
    switch (packet.t) {
      case 'midi': {
        const on = packet.on && packet.velocity > 0;
        const key = `${packet.channel}:${packet.note}`;
        if (on && !entry.notes.has(key) && entry.notes.size >= MAX_HELD_NOTES) return { ok: false, reason: 'note-capacity' };
        if (on) entry.notes.set(key, { note: packet.note, channel: packet.channel });
        else entry.notes.delete(key);
        entry.info.lastNote = packet.note;
        entry.info.lastChannel = packet.channel;
        if (on || !this.noteHeldElsewhere(key, entry)) {
          this.sink.midi({ note: packet.note, velocity: on ? packet.velocity : 0, on, channel: packet.channel });
        }
        // Explicit release edges let the host release momentary controls without firing
        // graphs or sequence resets. Gates remain separate, modulation-only values.
        this.sink.osc(address(`midi/${packet.channel}/note/${packet.note}`), on ? packet.velocity / 127 : 0, on ? 'press' : 'release');
        this.sink.osc(address(`midi/${packet.channel}/gate/${packet.note}`), on ? packet.velocity / 127 : 0);
        break;
      }
      case 'cc':
        this.sink.cc({ controller: packet.controller, value: packet.value, channel: packet.channel });
        entry.controls.add(address(`midi/${packet.channel}/cc/${packet.controller}`));
        this.sink.osc(address(`midi/${packet.channel}/cc/${packet.controller}`), packet.value / 127);
        break;
      case 'audio': {
        const frame = { level: packet.level, bass: packet.bass, mids: packet.mids, highs: packet.highs };
        entry.info.audio = frame;
        entry.audioAt = now;
        this.sink.audio(packet.id, frame);
        for (const band of voice.AUDIO_BANDS) this.sink.osc(address(`audio/${band}`), frame[band]);
        break;
      }
      case 'macro': this.sink.osc(address(`macro/${packet.index}`), packet.value); break;
    }
    return { ok: true };
  }

  /** Called at low-rate status cadence, not on every render tick. */
  snapshot(): TrackInputInfo[] {
    const now = this.now();
    this.expire(now);
    return [...this.entries.values()].map((e) => ({ ...e.info, audio: { ...e.info.audio } }));
  }

  private expire(now: number): void {
    for (const entry of this.entries.values()) {
      if (!entry.info.connected) continue;
      if (now - entry.seenAt > TRACK_INPUT_TIMEOUT_MS) { this.disconnect(entry); continue; }
      if (Number.isFinite(entry.audioAt) && now - entry.audioAt > voice.AUDIO_STALE_MS) {
        this.clearAudio(entry);
      }
    }
  }
  private clearAudio(entry: Entry): void {
    entry.audioAt = Number.NEGATIVE_INFINITY;
    entry.info.audio = { ...voice.ZERO_AUDIO_FRAME };
    this.sink.audio(entry.info.id, entry.info.audio);
    for (const band of voice.AUDIO_BANDS) this.sink.osc(trackInputAddress(entry.info.id, `audio/${band}`), 0);
  }
  private disconnect(entry: Entry): void {
    if (!entry.info.connected) return;
    entry.info.connected = false;
    for (const [key, { note, channel }] of entry.notes) {
      if (!this.noteHeldElsewhere(key, entry)) this.sink.midi({ note, channel, velocity: 0, on: false });
      this.sink.osc(trackInputAddress(entry.info.id, `midi/${channel}/gate/${note}`), 0);
      this.sink.osc(trackInputAddress(entry.info.id, `midi/${channel}/note/${note}`), 0, 'release');
    }
    entry.notes.clear();
    for (const address of entry.controls) this.sink.osc(address, 0);
    entry.controls.clear();
    this.clearAudio(entry);
    for (let i = 1; i <= 8; i++) this.sink.osc(trackInputAddress(entry.info.id, `macro/${i}`), 0);
  }
  private noteHeldElsewhere(key: string, owner: Entry): boolean {
    for (const entry of this.entries.values()) if (entry !== owner && entry.info.connected && entry.notes.has(key)) return true;
    return false;
  }
  close(): void {
    for (const entry of this.entries.values()) if (entry.info.connected) this.disconnect(entry);
    this.entries.clear();
  }
}
