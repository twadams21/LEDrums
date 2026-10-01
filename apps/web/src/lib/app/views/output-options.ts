/* Shared form options + value formatters for the output / hoop settings panes — the Select option
   arrays and the pixel-span read-out, ONE source of truth so the panes read the same lists in the
   same order with the same labels. Pure TS, unit-tested. */
import type { PixelSpan } from '../patch-routing';

/** Output protocol options (the controller pane). */
export const PROTOCOL_OPTS = [
  { value: 'artnet', label: 'Art-Net' },
  { value: 'sacn', label: 'sACN (E1.31)' },
];

/** Pixel colour-order options (an output chain). */
export const RGB_OPTS = (['RGB', 'RBG', 'GRB', 'GBR', 'BRG', 'BGR'] as const).map((o) => ({ value: o, label: o }));

/** A pixel span read-out ("first – last"), or an em-dash when there is none. */
export const fmtSpan = (s: PixelSpan | null | undefined): string => (s ? `${s.first} – ${s.last}` : '—');
