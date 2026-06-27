/* Tiny shared helpers for the Inspector per-kind editors (S3.1). Pure TS — no Svelte /
   DOM — so the numeric-commit guard is unit-testable and the Patch label read/write share
   one definition across the six Patch editors. The reactive editors are thin consumers. */
import type { TriggerLab } from '../../../trigger-lab/store.svelte';

/** Apply a finite parsed number from a CommitInput; a cleared ('') field is ignored. */
export function onNum(raw: string, apply: (n: number) => void): void {
  if (raw === '') return;
  const n = Number(raw);
  if (Number.isFinite(n)) apply(n);
}

/** The display label for a Patch node id — the stored override, else the fallback. */
export function patchLabel(store: TriggerLab, id: string, fallback: string): string {
  return store.patchLabels[id]?.trim() || fallback;
}

/** Commit a Patch node rename, clearing the override when blank or equal to the fallback. */
export function commitLabel(store: TriggerLab, id: string, fallback: string, raw: string): void {
  const v = raw.trim();
  store.setPatchLabel(id, v && v !== fallback ? v : '');
}
