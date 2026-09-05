/** Persisted authoring-envelope versions, shared by browser migration and server preflight.
 * These are format identities, not schemas. The browser owns migration/hydration; the server
 * accepts only current versions rather than guessing at historical field semantics. */
export const SHOWS_VERSION = 2;
/** v1 show hoop target ids were 0-based; browser migration shifts them to 1-based. */
export const SHOWS_PRIOR_VERSION = 1;
export const SONGS_VERSION = 1;
