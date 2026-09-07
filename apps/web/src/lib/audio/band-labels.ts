/** Display names for the four audio feature bands (GH #214) — one home so the node card, the
    inspector's band switch and the settings meters agree. */
import { voice } from '@ledrums/core';

export const AUDIO_BAND_LABELS: Readonly<Record<voice.AudioBand, string>> = {
  level: 'Level',
  bass: 'Bass',
  mids: 'Mids',
  highs: 'Highs',
};

export function audioBandLabel(band: voice.AudioBand): string {
  return AUDIO_BAND_LABELS[band] ?? band;
}

/** Select options in display order. */
export const AUDIO_BAND_OPTIONS: ReadonlyArray<{ value: voice.AudioBand; label: string }> = voice.AUDIO_BANDS.map((b) => ({ value: b, label: AUDIO_BAND_LABELS[b] }));
