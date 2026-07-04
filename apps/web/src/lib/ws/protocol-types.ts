// The WS wire contract is defined once in `@ledrums/protocol` (app-shared, NOT pure
// `@ledrums/core`) and imported by both the web client and the server. This module
// re-exports those types for the web's existing import paths and adds the web-side
// runtime helper (`decodeServer`) that parses inbound server frames.
export type {
  ClientMessage,
  ControllerStatus,
  ControllerUniverseRx,
  DiscoveredController,
  EffectSpec,
  MonitorEvent,
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

import type { ServerMessage } from '@ledrums/protocol';

const SERVER_TYPES = new Set<ServerMessage['t']>([
  'state',
  'stats',
  'input',
  'monitor',
  'projects',
  'presence',
  'showLibrary',
  'songLibrary',
  'controllerDiscovery',
  'controllerStatus',
  'error',
]);

/** Parse a text WS payload into a typed ServerMessage, or null if malformed/unknown. */
export function decodeServer(raw: string): ServerMessage | null {
  let obj: unknown;
  try {
    obj = JSON.parse(raw);
  } catch {
    return null;
  }
  if (
    !obj ||
    typeof obj !== 'object' ||
    typeof (obj as { t?: unknown }).t !== 'string' ||
    !SERVER_TYPES.has((obj as { t: ServerMessage['t'] }).t)
  ) {
    return null;
  }
  return obj as ServerMessage;
}
