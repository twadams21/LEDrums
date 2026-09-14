/** App-wide ingress policy, shared by WebSocket and local track devices. An unknown channel
 * is not allowed to bypass an explicit selection. null is the existing omni setting. */
export function acceptsMidiChannel(received: number | undefined, selected: number | null): boolean {
  return selected === null || received === selected;
}
