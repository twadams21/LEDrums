import { describe, expectTypeOf, it } from 'vitest';
import type { EffectGenerator, ParamSpec } from '@ledrums/core';
import type { EffectSpec, MonitorEventType, OutputStatus, ShowLibraryBlob } from './index';

// These are compile-time assertions: they pin the three shapes that S4.3 reconciled
// between the server (`ws-protocol.ts`) and the web (`lib/ws/protocol-types.ts`) so the
// wire contract has exactly one definition here. A regression in any of them fails
// `pnpm typecheck`; the `it` block keeps vitest happy at runtime.
describe('protocol wire contract (reconciled shapes)', () => {
  it('pins paramSpec, universeCount, and ShowLibraryBlob to one definition', () => {
    // (1) EffectSpec.paramSpec is core's ParamSpec[] — the same type as
    //     EffectGenerator.paramSpec the server maps from listEffects().
    expectTypeOf<EffectSpec['paramSpec']>().toEqualTypeOf<ParamSpec[]>();
    expectTypeOf<EffectSpec['paramSpec']>().toEqualTypeOf<EffectGenerator['paramSpec']>();

    // (2) OutputStatus.universeCount is required (the server always sets it).
    expectTypeOf<OutputStatus['universeCount']>().toEqualTypeOf<number>();
    expectTypeOf<OutputStatus>().toHaveProperty('universeCount').toBeNumber();

    // (3) ShowLibraryBlob is the single opaque versioned envelope.
    expectTypeOf<ShowLibraryBlob>().toEqualTypeOf<{ version: number; data: unknown }>();

    // (4) Monitor events use the shared operational taxonomy that server, web,
    //     and output diagnostics extend.
    expectTypeOf<MonitorEventType>().toEqualTypeOf<
      'input' | 'output' | 'effect' | 'graph' | 'system' | 'persistence' | 'error'
    >();
  });
});
