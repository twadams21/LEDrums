/** Subscribe a Svelte effect to a JSON document's deep edits WITHOUT materializing a snapshot.
 * Reads keys as well as values, so adding/deleting an optional field or array element invalidates
 * the subscription too. Documents are acyclic plain data; no clone/JSON/signature is built here.
 * Keep independent documents in separate effects so an active-show drag never walks the song pool.
 */
export function trackDocument(value: unknown): void {
  if (value === null || typeof value !== 'object') return;
  for (const key in value) trackDocument((value as Record<string, unknown>)[key]);
}
