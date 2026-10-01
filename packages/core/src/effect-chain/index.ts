/**
 * Effect chains — the authored Effect model (schema + types), the Generator registry, and the
 * one resolver seam that turns authored Effects into voice-engine play actions. Pure.
 */
export * from './types';
export * from './generators';
export * from './resolver';
export * from './runtime';
export * from './library';
export * from './master';
// The Splice / Slice card's param list (the web device cards read it; it has no Styles).
export { spliceGeneratorParamSpec } from './resolve-splice';
export * from './input-mappings';
