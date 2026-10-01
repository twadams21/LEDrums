/** Persisted authoring-envelope versions, shared by browser migration and server preflight.
 * These are format identities, not schemas. The browser owns migration/hydration; the server
 * accepts only current versions rather than guessing at historical field semantics. */
export const SHOWS_VERSION = 2;
/** v1 show hoop target ids were 0-based; browser migration shifts them to 1-based. */
export const SHOWS_PRIOR_VERSION = 1;
export const SONGS_VERSION = 1;
/** Effect-chains show library: sections carry `effects` / `master`, no graphs. The web writes it
 * from effect-chains S05; the constants above stay until the graph model is retired (S08). */
export const SHOWS_VERSION_EFFECTS = 3;
/** Effect-chains song library: library songs carry effect sections and their canvas scenes. */
export const SONGS_VERSION_EFFECTS = 2;
