// The WS wire contract is defined once in `@ledrums/protocol` (app-shared, NOT pure
// `@ledrums/core`) and imported by both the web client and the server. This module
// re-exports those types for the web's existing import paths and adds the web-side
// runtime helper (`decodeServer`) that parses inbound server frames.
export type {
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

/**
 * Parse a text WS payload into a typed ServerMessage, or null if malformed/unknown. The
 * single-source runtime schema (`serverMessageSchema` in `@ledrums/protocol`) narrows `t` and
 * validates every payload field; anything that fails is dropped (null), which the caller in
 * `client.ts` treats as an ignored frame — the same silent-drop contract the old cast had.
 */
export function decodeServer(raw: string): ServerMessage | null {
  let obj: unknown;
  try {
    obj = JSON.parse(raw);
  } catch {
    return null;
  }
  const result = serverMessageSchema.safeParse(obj);
  return result.success ? result.data : null;
}
