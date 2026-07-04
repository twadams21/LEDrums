/**
 * PixLite Mk3 client types — the seam surface the server builds on.
 *
 * All types here are platform-agnostic plain data (no Node/DOM). The client
 * interface below is deliberately small; every HTTP / JSON-ordering / auth /
 * queue concern lives behind it (see `client.ts`).
 */

/** Identity of a controller, from the unauthenticated `GET /ver` probe (§7.15). */
export interface ControllerIdentity {
  /** The host the identity was read from (the probe fills this in). */
  host: string;
  /** e.g. `"PixLite A16-S Mk3"`. */
  prodName: string;
  /** User-assigned label, e.g. `"Roof Left 1"`. */
  nickname: string;
  /** Firmware version, e.g. `"1.2.3"`. */
  fwVer: string;
  /** Supported API versions: `[{ maj: "v1", min: [0,3] }, ...]`. */
  apiVer: ApiVersion[];
  /** True if the admin password is non-empty (auth required for management calls). */
  authReqd: boolean;
}

export interface ApiVersion {
  maj: string;
  min: number[];
}

/**
 * Per-universe receive stats (`ethProt.inUni.sACN` / `.artNet`, §7.13). The
 * controller stores these as parallel arrays; the client zips them into one
 * record per universe. **`timedOut === false` means the universe IS receiving.**
 */
export interface UniverseRx {
  uniNum: number;
  /** false = actively receiving valid data on this universe. */
  timedOut: boolean;
  inGood: number;
  inBadSeq: number;
  /** Packets dropped for lower-than-active priority (sACN only). */
  inLowPri?: number;
  /** Currently active priority 0–200 (sACN only). */
  priority?: number;
  /** Source description, e.g. `"Your Lighting Software"` (sACN only). */
  sourceName?: string;
}

/** Combined pixel-data frame rates (`pixData`, §7.13). */
export interface FrameRates {
  /** Detected network protocol rx frame rate (Hz). */
  inFrmRate?: number;
  /** Pixel output frame rate (Hz). */
  outFrmRate?: number;
}

/** Device health (`dev`, `pixPwrOuts`, `eth.extp`, §7.13). */
export interface ControllerHealth {
  /** Current temperature (°C). */
  tempC?: number;
  /** Per-bank input voltage (mV). */
  bankVoltsMv?: number[];
  /** Per-port power status: `"Good" | "Inactv" | "OvrCur" | "FuseBlwn"`. */
  portStatus?: string[];
  /** Per-external-port ethernet link state. */
  ethLinkUp?: boolean[];
}

/**
 * Parsed statistics from a `statisticRead`. Fields are optional because the
 * response only carries the members named in the request's `path`. `raw` is the
 * untouched `statistic` object for anything the typed view doesn't surface yet.
 */
export interface ControllerStats {
  universes: { sACN: UniverseRx[]; artNet: UniverseRx[] };
  rates: FrameRates;
  health: ControllerHealth;
  raw: Record<string, unknown>;
}

/**
 * Params for the controller's built-in test-data mode (`modeTestData`, §7.7.2).
 * Defined here as the seam for S49 (controller test patterns) — the client
 * serializes it in strict member order (op, color, colorRes, pixPortNum, pixNum).
 */
export interface ModeTestDataParams {
  op: 'setColor' | 'rgbwCycle' | 'colorFade';
  /** RGBW, only used when `op === 'setColor'`. */
  color?: [number, number, number, number];
  colorRes?: '8Bit' | '16Bit';
  /** 0 = all ports. */
  pixPortNum?: number;
  /** 0 = all pixels. */
  pixNum?: number;
}

/**
 * The deep-module seam. The server depends on this interface and injects either
 * {@link HttpPixliteClient} (real) or {@link FakePixliteClient} (tests).
 * `packages/core` never touches any of it.
 */
export interface PixliteClient {
  /** The controller host this client is bound to. */
  readonly host: string;
  /** Unauthenticated identity read (`GET /ver`). null on timeout / non-PixLite. */
  probe(timeoutMs?: number): Promise<ControllerIdentity | null>;
  /** Read statistic members by dot-path (max 10; `[""]` = whole object). */
  statisticRead(paths: string[]): Promise<ControllerStats>;
  /** Flash the status LED for `durationS` seconds (0 disables, 121 = continuous). */
  identify(durationS: number): Promise<void>;
  /** Drive built-in test patterns (S49). Serialized like any other request. */
  modeTestData(params: ModeTestDataParams): Promise<void>;
  /** Return the controller to live mode (§7.7.1) — the exit from {@link modeTestData}. Once test
   * data is running the controller ignores the network stream; this is how S49 gives it back. */
  modeLive(): Promise<void>;
}
