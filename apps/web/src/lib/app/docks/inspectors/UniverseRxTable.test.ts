// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/svelte';
import UniverseRxTable from './UniverseRxTable.svelte';
import type { ControllerUniverseRx } from '../../../ws/protocol-types';

const uni = (o: Partial<ControllerUniverseRx> = {}): ControllerUniverseRx => ({
  uniNum: 1,
  protocol: 'sACN',
  receiving: true,
  inGood: 44_318,
  inBadSeq: 0,
  priority: 100,
  ...o,
});

describe('UniverseRxTable', () => {
  it('renders nothing when there are no universes', () => {
    const { container } = render(UniverseRxTable, { props: { universes: [] } });
    expect(container.querySelector('.universes')).toBeNull();
  });

  it('renders a row per universe with grouped, localized good/bad counts', () => {
    const { container } = render(UniverseRxTable, {
      props: { universes: [uni(), uni({ uniNum: 2, inGood: 44_301, inBadSeq: 2 })] },
    });
    const rows = container.querySelectorAll('.uni-row');
    expect(rows.length).toBe(2);
    expect(rows[0]?.querySelector('.uni-num')?.textContent).toBe('U1');
    expect(rows[0]?.querySelector('.uni-counts .good')?.textContent).toBe('44,318');
    expect(rows[1]?.querySelector('.uni-counts .bad-count')?.textContent).toBe('2');
  });

  it('flags exactly the dead universe row and drops the priority chip when absent', () => {
    const { container } = render(UniverseRxTable, {
      props: { universes: [uni(), uni({ uniNum: 2, receiving: false, inGood: 12, inBadSeq: 88, priority: undefined })] },
    });
    const bad = container.querySelectorAll('.uni-row.bad');
    expect(bad.length).toBe(1);
    expect(bad[0]?.querySelector('.uni-num')?.textContent).toBe('U2');
    expect(bad[0]?.querySelector('.pri')).toBeNull();
  });
});
