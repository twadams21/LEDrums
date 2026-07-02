// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/svelte';
import OutputStatusPanel from './OutputStatusPanel.svelte';
import type { OutputStatus } from '../../../ws/protocol-types';

const status = (overrides: Partial<OutputStatus> = {}): OutputStatus => ({
  state: 'armed',
  protocol: 'artnet',
  host: '192.168.1.50',
  packetsSent: 12_345,
  lastError: null,
  universeCount: 8,
  ...overrides,
});

/** Value string of the ReadRow whose label matches `label`. */
function rowValue(container: HTMLElement, label: string): string | undefined {
  const rows = [...container.querySelectorAll('.readrow')];
  const row = rows.find((r) => r.querySelector('.k')?.textContent === label);
  return row?.querySelector('.rval')?.textContent ?? undefined;
}

describe('OutputStatusPanel', () => {
  it('shows the offline empty state when there is no output (link down)', () => {
    const { container } = render(OutputStatusPanel, { props: { output: null, packetsPerSec: null } });
    expect(container.querySelector('.offline')).not.toBeNull();
    expect(container.querySelector('.readrows')).toBeNull();
    expect(container.querySelector('.fault')).toBeNull();
    // the state pill reads "Offline" and is muted
    expect(container.querySelector('.pill')?.getAttribute('aria-label')).toBe('Offline');
    expect(container.querySelector('.pill-muted')).not.toBeNull();
  });

  it('renders live values from the output status (armed, transmitting)', () => {
    const { container } = render(OutputStatusPanel, {
      props: { output: status(), packetsPerSec: 1024, port: 6454 },
    });
    expect(container.querySelector('.pill')?.getAttribute('aria-label')).toBe('Armed');
    expect(container.querySelector('.pill-live')).not.toBeNull();
    expect(rowValue(container, 'Packets/s')).toBe('1,024/s');
    expect(rowValue(container, 'Universes')).toBe('8');
    expect(rowValue(container, 'Target')).toBe('192.168.1.50:6454');
    expect(rowValue(container, 'Protocol')).toBe('Art-Net');
    // no error → no fault callout
    expect(container.querySelector('.fault')).toBeNull();
  });

  it('shows "—" for packets/s before a rate is derivable, and the sACN protocol/default port', () => {
    const { container } = render(OutputStatusPanel, {
      props: { output: status({ protocol: 'sacn', host: '239.255.0.1' }), packetsPerSec: null },
    });
    expect(rowValue(container, 'Packets/s')).toBe('—');
    expect(rowValue(container, 'Protocol')).toBe('sACN');
    expect(rowValue(container, 'Target')).toBe('239.255.0.1:5568'); // sACN default port
  });

  it('surfaces lastError as a prominent alert callout (armed-but-erroring)', () => {
    const { container } = render(OutputStatusPanel, {
      props: { output: status({ lastError: 'EHOSTUNREACH 192.168.1.50:6454' }), packetsPerSec: 0 },
    });
    const fault = container.querySelector('.fault');
    expect(fault).not.toBeNull();
    expect(fault?.getAttribute('role')).toBe('alert');
    expect(container.querySelector('.fault-msg')?.textContent).toBe('EHOSTUNREACH 192.168.1.50:6454');
    // the truth the panel must not hide: armed, but 0 packets flowing
    expect(rowValue(container, 'Packets/s')).toBe('0/s');
  });

  it('maps dry-run to the warn tone', () => {
    const { container } = render(OutputStatusPanel, {
      props: { output: status({ state: 'dry-run' }), packetsPerSec: 500 },
    });
    expect(container.querySelector('.pill')?.getAttribute('aria-label')).toBe('Dry-run');
    expect(container.querySelector('.pill-warn')).not.toBeNull();
  });
});
