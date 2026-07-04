// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/svelte';
import ControllerStatusPanel from './ControllerStatusPanel.svelte';
import type { ControllerStatus, ControllerUniverseRx, DiscoveredController } from '../../../ws/protocol-types';

const uni = (o: Partial<ControllerUniverseRx> = {}): ControllerUniverseRx => ({
  uniNum: 1,
  protocol: 'sACN',
  receiving: true,
  inGood: 44_318,
  inBadSeq: 0,
  priority: 100,
  ...o,
});

const NOW = 1_000_000;

const ctrl = (o: Partial<ControllerStatus> = {}): ControllerStatus => ({
  host: '192.168.1.50',
  reachable: true,
  identity: { host: '192.168.1.50', prodName: 'PixLite A16-S Mk3', nickname: 'Roof Left 1', fwVer: '1.4.2', authReqd: false },
  universes: [uni()],
  rates: { inFrmRate: 40, outFrmRate: 40 },
  health: { tempC: 41, bankVoltsMv: [12_100], ethLinkUp: [true, false] },
  lastSeen: NOW - 400,
  ...o,
});

const candidate = (o: Partial<DiscoveredController> = {}): DiscoveredController => ({
  host: '192.168.1.51',
  prodName: 'PixLite T8-S Mk3',
  nickname: 'Stage Right',
  fwVer: '1.4.0',
  authReqd: false,
  score: 80,
  ...o,
});

/** Value string of the ReadRow whose label matches `label`. */
function rowValue(container: HTMLElement, label: string): string | undefined {
  const rows = [...container.querySelectorAll('.readrow')];
  const row = rows.find((r) => r.querySelector('.k')?.textContent === label);
  return row?.querySelector('.rval')?.textContent ?? undefined;
}

describe('ControllerStatusPanel — adopted + receiving', () => {
  it('renders identity, health, rates and a calm "Receiving" pill with no alert', () => {
    const { container } = render(ControllerStatusPanel, {
      props: { controller: ctrl(), candidates: [], nowMs: NOW },
    });
    expect(container.querySelector('.pill')?.getAttribute('aria-label')).toBe('Receiving');
    expect(container.querySelector('.pill-ok')).not.toBeNull();
    expect(container.querySelector('.alert')).toBeNull();
    expect(rowValue(container, 'Name')).toBe('Roof Left 1');
    expect(rowValue(container, 'Model')).toBe('PixLite A16-S Mk3');
    expect(rowValue(container, 'Firmware')).toBe('1.4.2');
    expect(rowValue(container, 'IP')).toBe('192.168.1.50');
    expect(rowValue(container, 'In / Out')).toBe('40 Hz · 40 Hz');
    expect(rowValue(container, 'Temp')).toBe('41°C');
    expect(rowValue(container, 'Voltage')).toBe('12.1 V');
    expect(rowValue(container, 'Eth link')).toBe('1/2 up');
    // one universe row, not flagged bad, with grouped counts
    const rows = container.querySelectorAll('.uni-row');
    expect(rows.length).toBe(1);
    expect(container.querySelector('.uni-row.bad')).toBeNull();
    expect(container.querySelector('.uni-counts .good')?.textContent).toBe('44,318');
  });
});

describe('ControllerStatusPanel — not receiving (unmissable)', () => {
  it('raises a loud alert and flags the dead universe row', () => {
    const { container } = render(ControllerStatusPanel, {
      props: {
        controller: ctrl({ universes: [uni({ receiving: true }), uni({ uniNum: 2, receiving: false, inGood: 12, inBadSeq: 88 })] }),
        candidates: [],
        nowMs: NOW,
      },
    });
    const alert = container.querySelector('.alert');
    expect(alert).not.toBeNull();
    expect(alert?.getAttribute('role')).toBe('alert');
    expect(container.querySelector('.alert-label')?.textContent).toBe('Not receiving');
    expect(container.querySelector('.pill')?.getAttribute('aria-label')).toBe('Not receiving');
    expect(container.querySelector('.pill-live')).not.toBeNull();
    // exactly the second universe row is flagged bad
    const bad = container.querySelectorAll('.uni-row.bad');
    expect(bad.length).toBe(1);
    expect(bad[0]?.querySelector('.uni-num')?.textContent).toBe('U2');
  });
});

describe('ControllerStatusPanel — LOST', () => {
  it('shows the lost alert with a humanized last-seen age', () => {
    const { container } = render(ControllerStatusPanel, {
      props: { controller: ctrl({ reachable: false, lastSeen: NOW - 12_000 }), candidates: [], nowMs: NOW },
    });
    expect(container.querySelector('.pill')?.getAttribute('aria-label')).toBe('Lost');
    expect(container.querySelector('.pill-live')).not.toBeNull();
    expect(container.querySelector('.alert-label')?.textContent).toBe('Controller lost');
    expect(container.querySelector('.alert-msg')?.textContent).toContain('last seen 12s ago');
  });
});

describe('ControllerStatusPanel — un-adopted + discovery', () => {
  it('shows the Discover affordance and lists ranked candidates', () => {
    const { container, getByText } = render(ControllerStatusPanel, {
      props: { controller: null, candidates: [candidate({ host: '192.168.1.50', nickname: 'Roof' }), candidate()], nowMs: NOW },
    });
    // no identity rows when nothing is adopted
    expect(container.querySelector('.readrows')).toBeNull();
    expect(getByText('Discover controllers')).toBeTruthy();
    const cands = container.querySelectorAll('.candidate');
    expect(cands.length).toBe(2);
    expect(cands[0]?.querySelector('.cand-name')?.textContent).toBe('Roof');
  });

  it('fires onAdopt with the candidate host when Adopt-IP is clicked', async () => {
    const onAdopt = vi.fn();
    const { getAllByText } = render(ControllerStatusPanel, {
      props: { controller: null, candidates: [candidate({ host: '192.168.1.77' })], nowMs: NOW, onAdopt },
    });
    await fireEvent.click(getAllByText('Adopt-IP')[0]!);
    expect(onAdopt).toHaveBeenCalledWith('192.168.1.77');
  });
});

describe('ControllerStatusPanel — actions', () => {
  it('fires onIdentify and onDiscover from the adopted panel', async () => {
    const onIdentify = vi.fn();
    const onDiscover = vi.fn();
    const { getByText } = render(ControllerStatusPanel, {
      props: { controller: ctrl(), candidates: [], nowMs: NOW, onIdentify, onDiscover },
    });
    await fireEvent.click(getByText('Identify'));
    await fireEvent.click(getByText('Re-scan'));
    expect(onIdentify).toHaveBeenCalledOnce();
    expect(onDiscover).toHaveBeenCalledOnce();
  });

  it('offers "Point output here" only when the output host has drifted from the controller', async () => {
    const onAdopt = vi.fn();
    const { queryByText, rerender, getByText } = render(ControllerStatusPanel, {
      props: { controller: ctrl(), candidates: [], nowMs: NOW, outputHost: '192.168.1.50', onAdopt },
    });
    expect(queryByText('Point output here')).toBeNull(); // aligned → no resync affordance
    await rerender({ controller: ctrl(), candidates: [], nowMs: NOW, outputHost: '192.168.1.99', onAdopt });
    await fireEvent.click(getByText('Point output here'));
    expect(onAdopt).toHaveBeenCalledWith('192.168.1.50');
  });

  it('disables the actions for a viewer (canEdit=false)', () => {
    const { getByText } = render(ControllerStatusPanel, {
      props: { controller: ctrl(), candidates: [], nowMs: NOW, canEdit: false },
    });
    expect((getByText('Identify').closest('button') as HTMLButtonElement).disabled).toBe(true);
    expect((getByText('Re-scan').closest('button') as HTMLButtonElement).disabled).toBe(true);
  });
});
