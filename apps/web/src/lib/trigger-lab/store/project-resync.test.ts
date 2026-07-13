import { describe, expect, it } from 'vitest';
import { defaultProject, type OutputConfig } from '@ledrums/core';
import { projectResyncMessages } from './project-resync';

/* The pure undo-resync diff (S3): given the live project and a restored snapshot, emit ONLY the
   granular WS messages whose slice moved — never the untouched slices, so an undo does not hammer
   the engine. */

describe('projectResyncMessages', () => {
  it('emits nothing when the two projects are equal (a trigger-only undo)', () => {
    const live = defaultProject();
    const restored = structuredClone(live);
    expect(projectResyncMessages(live, restored)).toEqual([]);
  });

  it('emits nothing when there is no restored project (undo to offline)', () => {
    expect(projectResyncMessages(defaultProject(), null)).toEqual([]);
  });

  it('emits only setKitOutputs when outputs differ', () => {
    const restored = defaultProject();
    const drumId = restored.kit.drums[0]!.id;
    const outputs: OutputConfig[] = [
      { id: '1', channelsPerPixel: 3, segments: [{ drumId, hoopStart: 0, hoopEnd: 1 }] },
    ];
    restored.kit.outputs = outputs;
    const live = defaultProject(); // live still has the seed outputs
    const msgs = projectResyncMessages(live, restored);
    expect(msgs).toEqual([{ t: 'setKitOutputs', outputs }]);
  });

  it('emits only setKitTransform for the changed drum', () => {
    const restored = defaultProject();
    const drumId = restored.kit.drums[0]!.id;
    const live = structuredClone(restored);
    live.kit.drums[0]!.pixelsPerHoop = 999; // the live drum drifted from the restored one
    const msgs = projectResyncMessages(live, restored);
    expect(msgs).toHaveLength(1);
    expect(msgs[0]).toMatchObject({ t: 'setKitTransform', drumId });
  });

  it('emits only setKitGlobal when the mirror differs', () => {
    const restored = defaultProject();
    restored.kit.global.mirror = 'none';
    const live = structuredClone(restored);
    live.kit.global.mirror = 'x';
    expect(projectResyncMessages(live, restored)).toEqual([{ t: 'setKitGlobal', mirror: 'none' }]);
  });

  it('emits only setInputMap when the input map differs', () => {
    const restored = defaultProject();
    const live = structuredClone(restored);
    live.inputMap = { ...live.inputMap, midiChannel: 9 };
    expect(projectResyncMessages(live, restored)).toEqual([{ t: 'setInputMap', inputMap: restored.inputMap }]);
  });

  it('emits only setOutput when output settings differ', () => {
    const restored = defaultProject();
    const live = structuredClone(restored);
    live.output.fps = 30;
    expect(projectResyncMessages(live, restored)).toEqual([{ t: 'setOutput', ...restored.output }]);
  });

  it('emits every changed slice at once (mixed edit)', () => {
    const restored = defaultProject();
    const live = structuredClone(restored);
    live.kit.global.mirror = 'y';
    live.output.fps = 12;
    const kinds = projectResyncMessages(live, restored).map((m) => m.t).sort();
    expect(kinds).toEqual(['setKitGlobal', 'setOutput']);
  });
});
