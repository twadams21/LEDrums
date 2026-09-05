import type { ParamSpec } from './types';
import type { ParamSpec as VoiceParamSpec } from '../voice/types';

/** Canonical generator → voice parameter adapter. Numeric specs must carry ranges into
 * modulation; a missing spec silently disables the corresponding mapping. */
export function mapVoiceParamSpec(spec: ParamSpec): VoiceParamSpec {
  if (spec.type === 'number') {
    return {
      key: spec.key, label: spec.label, kind: 'number',
      min: spec.min, max: spec.max, step: spec.step, unit: spec.unit,
      default: typeof spec.default === 'number' ? spec.default : 0, envable: true,
    };
  }
  if (spec.type === 'bool') {
    return { key: spec.key, label: spec.label, kind: 'bool', default: typeof spec.default === 'boolean' ? spec.default : false };
  }
  if (spec.type === 'enum') {
    const options = spec.options ?? [];
    return { key: spec.key, label: spec.label, kind: 'enum', options, default: typeof spec.default === 'string' ? spec.default : options[0] ?? '' };
  }
  return { key: spec.key, label: spec.label, kind: 'color', default: typeof spec.default === 'string' ? spec.default : '#ffffff' };
}
