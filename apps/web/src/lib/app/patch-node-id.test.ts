import { describe, expect, it } from 'vitest';
import {
  CONTROLLER_ID,
  INPUT_ID,
  KIT_ID,
  TRIGGERS_ID,
  drumNodeId,
  hoopNodeId,
  outputNodeId,
  parsePatchNodeId,
  triggerNodeId,
  type PatchNodeRef,
} from './patch-node-id';

/* GOLDEN TABLE — captured against the baseline parsers (patchEditorFor /
   parseHoopNodeId / parseOutputNodeId at S1 HEAD). Each entry pins the decode of an
   id the live app actually mints or could be handed; the expected values are the
   baseline outputs pasted in as literals — the parity oracle S3 is checked against.

   The OUTPUT entries use the SHIPPING id shapes: `DEFAULT_KIT.outputs` is `[]`, so
   real `OutputConfig.id`s come from core's `reconcileOutputs`, which mints them as
   the strings `output:<n>` — the flow-node ids that ship are therefore the
   double-prefixed `output:output:<n>`, and the decode is a prefix claim (everything
   after the FIRST colon), never a split.

   DECLARED DIVERGENCE from baseline patchEditorFor: the zone Inspector arm is
   retired (11-decisions.md decision 5), so `zone:<drumId>:<zone>` — which nothing
   mints since S1 deleted the v1 topology builder — now decodes as `unknown`
   (baseline returned `{kind:'zone', drumId, zone, slot}`). */
describe('parsePatchNodeId (golden table)', () => {
  const cases: Array<[string, PatchNodeRef]> = [
    // singletons
    [INPUT_ID, { kind: 'input' }],
    [CONTROLLER_ID, { kind: 'controller' }],
    [KIT_ID, { kind: 'kit' }],
    [TRIGGERS_ID, { kind: 'triggers' }],
    // simple structured ids
    ['drum:kick', { kind: 'drum', drumId: 'kick' }],
    ['trigger:snare', { kind: 'trigger', drumId: 'snare' }],
    ['hoop:kick:1', { kind: 'hoop', drumId: 'kick', hoop: 1 }],
    ['hoop:tom2:4', { kind: 'hoop', drumId: 'tom2', hoop: 4 }],
    // shipping output shapes: reconcileOutputs mints OutputConfig.id = `output:<n>`,
    // so the flow-node id is double-prefixed. Prefix claim, never split.
    ['output:output:1', { kind: 'output', outputId: 'output:1' }],
    ['output:output:3', { kind: 'output', outputId: 'output:3' }],
    // simple / custom (non-`output:`-prefixed) OutputConfig ids
    ['output:1', { kind: 'output', outputId: '1' }],
    ['output:out-a', { kind: 'output', outputId: 'out-a' }],
    // adversarial
    ['hoop:weird:id:3', { kind: 'hoop', drumId: 'weird:id', hoop: 3 }],
    ['hoop:kick:x', { kind: 'unknown', id: 'hoop:kick:x' }],
    ['hoop:', { kind: 'unknown', id: 'hoop:' }],
    ['drum:a:b', { kind: 'drum', drumId: 'a:b' }],
    ['trigger:a:b', { kind: 'trigger', drumId: 'a:b' }],
    ['output:', { kind: 'output', outputId: '' }], // matches baseline startsWith/slice
    ['', { kind: 'unknown', id: '' }],
    ['garbage', { kind: 'unknown', id: 'garbage' }],
    ['drum:', { kind: 'unknown', id: 'drum:' }],
    ['trigger:', { kind: 'unknown', id: 'trigger:' }],
    // retired zone arm (decision 5): no longer a recognised kind
    ['zone:tom1:edge', { kind: 'unknown', id: 'zone:tom1:edge' }],
  ];

  it.each(cases)('decodes %j', (id, expected) => {
    expect(parsePatchNodeId(id)).toEqual(expected);
  });

  it('round-trips every encoder through the decoder', () => {
    expect(parsePatchNodeId(hoopNodeId({ drumId: 'kick', hoop: 2 }))).toEqual({ kind: 'hoop', drumId: 'kick', hoop: 2 });
    expect(parsePatchNodeId(outputNodeId('output:1'))).toEqual({ kind: 'output', outputId: 'output:1' });
    expect(parsePatchNodeId(outputNodeId('out-a'))).toEqual({ kind: 'output', outputId: 'out-a' });
    expect(parsePatchNodeId(drumNodeId('tom1'))).toEqual({ kind: 'drum', drumId: 'tom1' });
    expect(parsePatchNodeId(triggerNodeId('snare'))).toEqual({ kind: 'trigger', drumId: 'snare' });
  });

  it('encodes the shipping double-prefixed output id', () => {
    expect(outputNodeId('output:1')).toBe('output:output:1');
  });
});
