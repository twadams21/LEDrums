/* The registry of mappable controls (effect chains S07b). The `mappable` attachment adds a
   control's element + spec here on mount and removes it on unmount; the map-mode overlay reads
   it to draw outlines and badges and to hit-test clicks. One registry per app: controls mount
   anywhere in the tree (strip cards, chrome, views), and an attachment has no component
   context to look a scoped one up from. A scoped overlay (the styleguide) filters by DOM
   containment instead. */

import type { MappableSpec } from '../../trigger-lab/map-api';

export interface MappableEntry {
  readonly node: HTMLElement;
  readonly spec: MappableSpec;
}

export class MapRegistry {
  private list = $state.raw<readonly MappableEntry[]>([]);
  private byNode = new WeakMap<Element, MappableEntry>();

  /** Every registered control, in registration (≈ DOM mount) order. */
  get entries(): readonly MappableEntry[] {
    return this.list;
  }

  /** Register a control; returns its unregister. */
  register(node: HTMLElement, spec: MappableSpec): () => void {
    const entry: MappableEntry = { node, spec };
    this.byNode.set(node, entry);
    this.list = [...this.list, entry];
    return () => {
      if (this.byNode.get(node) === entry) this.byNode.delete(node);
      this.list = this.list.filter((e) => e !== entry);
    };
  }

  /** The registered control an event path passes through (innermost first), or null. */
  entryOnPath(path: readonly EventTarget[]): MappableEntry | null {
    for (const target of path) {
      const entry = target instanceof Element ? this.byNode.get(target) : undefined;
      if (entry) return entry;
    }
    return null;
  }
}

export const mapRegistry = new MapRegistry();
