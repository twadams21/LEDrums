/** Persisted authoring-envelope versions, shared by browser migration and server preflight.
 * These are format identities, not schemas. The browser owns migration/hydration; the server
 * accepts only known versions rather than guessing at historical field semantics.
 *
 * `SHOWS_VERSION` / `SONGS_VERSION` are the retired graph-model formats: the server stores them
 * as archives (it never runs them) and the web's legacy import reads them. */
export const SHOWS_VERSION = 2;
/** v1 show hoop target ids were 0-based; browser migration shifts them to 1-based. */
export const SHOWS_PRIOR_VERSION = 1;
export const SONGS_VERSION = 1;
/** Effect-chains show library: sections carry `effects` / `master`. The current format. */
export const SHOWS_VERSION_EFFECTS = 3;
/** Effect-chains song library: library songs carry effect sections and their canvas scenes. */
export const SONGS_VERSION_EFFECTS = 2;
