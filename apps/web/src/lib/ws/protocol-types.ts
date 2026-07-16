// The WS wire contract is defined once in `@ledrums/protocol` (app-shared, NOT pure
// `@ledrums/core`) and imported by both the web client and the server. This module
// re-exports those types for the web's existing import paths and adds the web-side
// runtime helper (`decodeServer`) that parses inbound server frames.
export type {
  BackupReason,
  BackupSnapshotMeta,
  ClientMessage,
  ControllerStatus,
  ControllerTestPattern,
  ControllerUniverseRx,
  DiscoveredController,
  EffectSpec,
  MonitorEvent,
  NetworkAdapter,
  OutputStatus,
  SerializedDrum,
  SerializedModel,
  ServerMessage,
  ShowLibraryBlob,
  SongLibraryBlob,
  TunnelInfo,
  VoiceStat,
  VoiceStats,
} from '@ledrums/protocol';

import { serverMessageSchema } from '@ledrums/protocol';
import type { ServerMessage } from '@ledrums/protocol';

// The known server discriminants, DERIVED from the schema (never hand-maintained) — used only to
// decide whether a *failed* parse is a recognised-but-malformed server frame (worth a dev warning)
// versus genuine noise. Mirrors `clientMessageTypes` in the protocol package.
const serverMessageTypes: ReadonlySet<string> = new Set(
  serverMessageSchema.options.map((opt) => opt.shape.t.value),
);

/**
 * Parse a text WS payload into a typed ServerMessage, or null if malformed/unknown. The
 * single-source runtime schema (`serverMessageSchema` in `@ledrums/protocol`) narrows `t` and
 * validates every payload field; anything that fails is dropped (null), which the caller in
 * `client.ts` treats as an ignored frame — the same silent-drop contract the old cast had.
 *
 * In dev only (`import.meta.env.DEV`), a frame whose `t` is a *known* server type but which fails
 * validation (version skew, a buggy server payload) emits a `console.warn` so the frame does not
 * vanish without a trace and freeze the UI. Production behaviour is unchanged: silent null.
 */
export function decodeServer(raw: string): ServerMessage | null {
  let obj: unknown;
  try {
    obj = JSON.parse(raw);
  } catch {
    return null;
  }
  const result = serverMessageSchema.safeParse(obj);
  if (result.success) return result.data;

  if (import.meta.env.DEV) {
    const t = (obj as { t?: unknown } | null)?.t;
    if (typeof t === 'string' && serverMessageTypes.has(t)) {
      const issues = result.error.issues
        .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
        .join('; ');
      console.warn(`[decodeServer] dropped malformed "${t}" server frame — ${issues}`);
    }
  }
  return null;
}
