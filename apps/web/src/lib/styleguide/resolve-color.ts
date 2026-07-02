/* Resolve a design token to its authored value + the browser-resolved sRGB colour.
   Runs in the artifact itself (client-side), so the readouts can never drift from
   tokens.css: the authored string comes from the live custom property, the resolved
   hex from a canvas round-trip (canvas normalizes any CSS colour — incl. OKLCH —
   into sRGB bytes). */

let probe: CanvasRenderingContext2D | null | undefined;

function ctx2d(): CanvasRenderingContext2D | null {
  if (probe === undefined) {
    const canvas = document.createElement('canvas');
    canvas.width = 1;
    canvas.height = 1;
    probe = canvas.getContext('2d', { willReadFrequently: true });
  }
  return probe;
}

/** The authored value of a custom property, e.g. `oklch(0.845 0.190 128)`. */
export function tokenRaw(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

/** Browser-resolved sRGB for a token: `#aef04a`, or `rgba(…)` when translucent.
    Empty string when the value isn't a colour (shadows, durations, …). */
export function tokenResolved(name: string): string {
  const el = document.createElement('span');
  el.style.color = `var(${name})`;
  document.body.appendChild(el);
  const computed = getComputedStyle(el).color;
  el.remove();

  const c = ctx2d();
  if (!c || !computed) return '';
  c.clearRect(0, 0, 1, 1);
  c.fillStyle = '#000';
  c.fillStyle = computed; // invalid values keep the previous fillStyle
  c.fillRect(0, 0, 1, 1);
  const [r, g, b, a] = c.getImageData(0, 0, 1, 1).data as unknown as [number, number, number, number];
  if (a === 0) return '';
  const hex = (n: number) => n.toString(16).padStart(2, '0');
  if (a < 255) return `rgba(${r}, ${g}, ${b}, ${(a / 255).toFixed(2)})`;
  return `#${hex(r)}${hex(g)}${hex(b)}`;
}
