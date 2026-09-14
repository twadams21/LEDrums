import { LocalDatagramInput } from '@ledrums/io';
import {
  TRACK_INPUT_MAX_BYTES, trackPacketSchema, type TrackInputsStatus,
} from '@ledrums/protocol';
import { TrackInputRegistry, type TrackInputSink } from './track-input-registry';

/** Loopback IO + bounded registry. Publishing runs at 10 Hz, independently of render ticks. */
export function createTrackInputBridge(options: {
  port: number;
  enabled: boolean;
  sink: TrackInputSink;
  publish(status: TrackInputsStatus): void;
  now?: () => number;
}) {
  const registry = new TrackInputRegistry(options.sink, options.now ?? (() => performance.now()));
  let status: TrackInputsStatus['status'] = 'off';
  let port = Number.isInteger(options.port) && options.port >= 0 && options.port <= 65535 ? options.port : 0;
  let error: string | undefined;
  let lastPublished = '';
  let io: LocalDatagramInput | undefined;
  let timer: ReturnType<typeof setInterval> | undefined;
  let closed = false;
  const snapshot = (): TrackInputsStatus => ({ status, port, ...(error ? { error } : {}), inputs: registry.snapshot() });
  const publish = () => {
    if (closed) return;
    const next = snapshot();
    const signature = JSON.stringify(next);
    if (signature === lastPublished) return;
    lastPublished = signature;
    options.publish(next);
  };
  if (options.enabled && options.port !== port) {
    status = 'error';
    error = 'Invalid track input port';
  } else if (options.enabled) {
    io = new LocalDatagramInput({
      port,
      maxBytes: TRACK_INPUT_MAX_BYTES,
      onStatus: (next) => {
        status = next.status;
        if (next.status === 'listening') { port = next.port; error = undefined; }
        else { error = next.error; registry.close(); }
        publish();
      },
      onMessage: (text, peer) => {
        if (closed || status !== 'listening') return;
        let value: unknown;
        try { value = JSON.parse(text); } catch { return; }
        const parsed = trackPacketSchema.safeParse(value);
        if (!parsed.success) return;
        const packet = parsed.data;
        const result = registry.ingest(packet, peer.port);
        // Registration acknowledgements expose duplicate identity / capacity failures to the
        // device. Data stays fire-and-forget; it never waits for the engine or a reply.
        if (packet.t === 'hello') io?.reply(peer.port, JSON.stringify({ v: 1, t: 'ack', id: packet.id, session: packet.session, seq: packet.seq, ...result }));
      },
    });
    timer = setInterval(publish, 100);
    timer.unref();
  }
  return {
    snapshot,
    close(): void {
      if (closed) return;
      closed = true;
      if (timer) clearInterval(timer);
      io?.close();
      registry.close();
    },
  };
}
