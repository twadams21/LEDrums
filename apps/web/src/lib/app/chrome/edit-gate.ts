/* Shared copy for the S2 edit gate: why an authoring affordance is dead right now.
   A viewer keeps every add/edit control VISIBLE but disabled — hiding them made the
   chrome bars flicker their `+` on load (presence arrives after first paint) and told
   the reader nothing about why it vanished. The reason names the remedy: the TopBar's
   one-press Take over. */
export const VIEWING_REASON = 'Viewing — take over to edit';

/** No song is selected, so there is nothing to add a section to. */
export const NO_SONG_REASON = 'No song in this show';
