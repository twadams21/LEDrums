// @vitest-environment jsdom
/* The OSC input surface (#139) exists to answer one question a user cannot otherwise answer from
   inside the app: what host:port do I type into Sensory Percussion? These pin that answer, the
   loopback fallback, and the two states that used to be silent — a failed bind, and "bound but
   nothing is arriving". */
import { describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/svelte';
import OscInputPanel from './OscInputPanel.svelte';
import type { TriggerLab } from '../../trigger-lab/store.svelte';
import type { InputBadgeView } from '../../trigger-lab/input-activity';
import type { OscListenInfo } from '../../ws/protocol-types';

const stub = (oscListen: OscListenInfo | null, oscHeardBadge: InputBadgeView | null = null): TriggerLab =>
  ({ oscListen, oscHeardBadge }) as unknown as TriggerLab;

const heard: InputBadgeView = {
  label: '/kick',
  value: '0.82',
  age: 'now',
  tone: 'live',
  fresh: true,
  title: 'Last heard /kick · 0.82 · now ago',
};

describe('OscInputPanel', () => {
  it('shows every LAN address as a copyable host:port', () => {
    const { getByText, getByLabelText } = render(OscInputPanel, {
      props: { store: stub({ status: 'listening', port: 9000, hosts: ['192.168.1.20', '10.0.0.5'] }) },
    });

    expect(getByText('192.168.1.20:9000')).toBeTruthy();
    expect(getByText('10.0.0.5:9000')).toBeTruthy();
    expect(getByLabelText('Copy OSC address 192.168.1.20:9000')).toBeTruthy();
  });

  it('offers loopback when the machine has no LAN address', () => {
    const { getByText } = render(OscInputPanel, {
      props: { store: stub({ status: 'listening', port: 9100, hosts: [] }) },
    });
    // An empty host list must not render an empty panel — the same box can still send to itself.
    expect(getByText('127.0.0.1:9100')).toBeTruthy();
  });

  it('copies the exact address to the clipboard', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    const { getByLabelText } = render(OscInputPanel, {
      props: { store: stub({ status: 'listening', port: 9000, hosts: ['192.168.1.20'] }) },
    });

    (getByLabelText('Copy OSC address 192.168.1.20:9000') as HTMLButtonElement).click();
    expect(writeText).toHaveBeenCalledWith('192.168.1.20:9000');
    vi.unstubAllGlobals();
  });

  it('says nothing has arrived yet when no OSC has been heard', () => {
    const { getByText } = render(OscInputPanel, {
      props: { store: stub({ status: 'listening', port: 9000, hosts: ['192.168.1.20'] }) },
    });
    expect(getByText('Nothing received yet')).toBeTruthy();
  });

  it('shows the last-heard badge once packets land', () => {
    // The distinction that matters: "configured" (socket bound) vs "working" (packets landing).
    const { getByText, queryByText } = render(OscInputPanel, {
      props: { store: stub({ status: 'listening', port: 9000, hosts: ['192.168.1.20'] }, heard) },
    });
    expect(getByText('/kick')).toBeTruthy();
    expect(getByText('0.82')).toBeTruthy();
    expect(queryByText('Nothing received yet')).toBeNull();
  });

  it('surfaces a failed bind loudly instead of claiming to listen', () => {
    const { getByRole, getByLabelText, queryByText } = render(OscInputPanel, {
      props: {
        store: stub({
          status: 'error',
          port: 9000,
          hosts: ['192.168.1.20'],
          error: 'bind EADDRINUSE 0.0.0.0:9000',
        }),
      },
    });

    expect(getByRole('alert').textContent).toContain('bind EADDRINUSE 0.0.0.0:9000');
    expect(getByLabelText('Not listening on udp:9000')).toBeTruthy();
    // A dead socket must never render a "send OSC here" address the user would trust.
    expect(queryByText('192.168.1.20:9000')).toBeNull();
  });

  it('renders a connecting note before the first state message', () => {
    const { getByText } = render(OscInputPanel, { props: { store: stub(null) } });
    expect(getByText('Connecting to the server…')).toBeTruthy();
  });
});
