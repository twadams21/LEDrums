/**
 * PixLite Mk3 controller client (HTTP-only v1). A deep module: a small
 * {@link PixliteClient} interface with two adapters (real HTTP + in-memory
 * fake), a pure subnet-sweep discovery helper, and the strict-order JSON /
 * auth / sequential-queue machinery hidden inside. `packages/core` never
 * touches any of this.
 */
export type {
  PixliteClient,
  ControllerIdentity,
  ApiVersion,
  UniverseRx,
  FrameRates,
  ControllerHealth,
  ControllerStats,
  ModeTestDataParams,
} from './types';
export {
  HttpPixliteClient,
  nodeHttpTransport,
  probe,
  type HttpPixliteClientOptions,
  type HttpTransport,
  type HttpRequestSpec,
  type HttpResponse,
  type ProbeOptions,
} from './client';
export {
  sweep,
  expandCidr,
  expandTargets,
  type Prober,
  type RankedCandidate,
  type SweepOptions,
} from './sweep';
export {
  FakePixliteClient,
  makeFakeProber,
  defaultIdentity,
  defaultStats,
  type FakePixliteClientOptions,
} from './fake';
export { PixliteError } from './protocol';
export { authHash, EMPTY_PASSWORD_AUTH } from './auth';
