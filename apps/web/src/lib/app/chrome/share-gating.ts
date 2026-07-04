/* Pure share-visibility predicate (S08).
 *
 * ShareInfo shows the room's public URL + PIN. On the desktop build those come from the server the
 * shell spawns, and are only meaningful once that server is actually running: a URL/PIN shown while
 * the app is still starting — or while an OTA update is downloading and the server is about to
 * restart — is dead (the mid-update PIN never connects). So on desktop we additionally gate the
 * surface on the `running` boot stage. In a plain browser there is no desktop boot lifecycle, so
 * this must never gate — hence the `isDesktop` short-circuit. */

import type { BootStage } from '../boot-reducer';

export function shareVisible(hasTunnel: boolean, isDesktop: boolean, stage: BootStage): boolean {
  return hasTunnel && (!isDesktop || stage === 'running');
}
