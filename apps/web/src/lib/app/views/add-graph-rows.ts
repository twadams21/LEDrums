/* Row model for the Add-graph modal: the graph library filtered by the search box, each row
   knowing whether the section already lists that graph. Pure — the dialog is thin over this.
   Library order is preserved (pads first, then authored graphs), so the list never reshuffles
   under the cursor as you type. */

export interface GraphPickRow {
  key: string;
  /** Display name of the graph. */
  label: string;
  /** One-line trigger-source summary ("kick · centre", "midi 36", …). */
  sub: string;
  /** The active section already lists this key — it can still be COPIED, not linked again. */
  inSection: boolean;
}

/** Filter the library to the rows the modal shows. A blank query keeps everything; otherwise a
    row matches when its label or its trigger-source line contains the query (case-insensitive,
    trimmed). */
export function graphPickRows(
  library: ReadonlyArray<{ key: string; label: string }>,
  sectionGraphs: readonly string[],
  sub: (key: string) => string,
  query: string,
): GraphPickRow[] {
  const q = query.trim().toLowerCase();
  const inSection = new Set(sectionGraphs);
  const rows = library.map((g) => ({
    key: g.key,
    label: g.label,
    sub: sub(g.key),
    inSection: inSection.has(g.key),
  }));
  if (!q) return rows;
  return rows.filter((r) => r.label.toLowerCase().includes(q) || r.sub.toLowerCase().includes(q));
}

/** The name a copy is offered under: "<label> copy", matching `duplicateGraph`'s own labelling
    so the prompt shows what you'd get by just accepting it. */
export function copyNameFor(label: string): string {
  return `${label} copy`;
}
