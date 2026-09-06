import type { TriggerGraph } from './types';

/** Resolve an authored graph by its key without consulting Object.prototype. */
export function graphAt(
  graphs: Readonly<Record<string, TriggerGraph>>,
  key: string | undefined,
): TriggerGraph | undefined {
  return key !== undefined && Object.hasOwn(graphs, key) ? graphs[key] : undefined;
}
