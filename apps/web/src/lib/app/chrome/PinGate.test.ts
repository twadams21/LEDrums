// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, fireEvent, waitFor } from '@testing-library/svelte';
import PinGate from './PinGate.svelte';
import { authGateStoreDouble } from '../../test-support/auth-gate-store.svelte';

/* The gate's job is to tell the truth about WHY we were refused (INIT-05). A 4401 means the PIN
   was wrong. A 4429 means the peer spent its allowance and the server refused WITHOUT comparing
   the PIN — so during that cooldown even the CORRECT PIN comes back refused, and the "Incorrect
   PIN" copy would be a lie to someone holding the right one. These cases pin that the two
   refusals never render each other's sentence. */

/** Submit a PIN, then have the server refuse it in the given way. */
async function submitAndRefuse(
  gate: ReturnType<typeof authGateStoreDouble>,
  input: HTMLElement,
  button: HTMLElement,
  throttledSeconds: number | null,
): Promise<void> {
  await fireEvent.input(input, { target: { value: '4242' } });
  await fireEvent.click(button);
  gate.refuse(throttledSeconds);
  await waitFor(() => {});
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
});
afterEach(() => {
  vi.useRealTimers();
});

describe('PinGate', () => {
  it('is hidden until the server actually refuses us', () => {
    const gate = authGateStoreDouble(false);
    const { queryByRole } = render(PinGate, { props: { store: gate.store } });
    expect(queryByRole('dialog')).toBeNull();
  });

  it('a WRONG-PIN refusal says the PIN was wrong, and leaves Join usable', async () => {
    const gate = authGateStoreDouble();
    const { getByLabelText, getByRole, queryByRole } = render(PinGate, { props: { store: gate.store } });
    const button = getByRole('button');
    await submitAndRefuse(gate, getByLabelText('Room PIN'), button, null);

    expect(getByRole('alert').textContent).toContain('Incorrect PIN');
    expect(queryByRole('status')).toBeNull();
    expect((button as HTMLButtonElement).disabled).toBe(false);
    expect(button.textContent?.trim()).toBe('Join');
  });

  it('a THROTTLED refusal says so with the wait — never "Incorrect PIN"', async () => {
    const gate = authGateStoreDouble();
    const { getByLabelText, getByRole, queryByRole } = render(PinGate, { props: { store: gate.store } });
    const button = getByRole('button');
    await submitAndRefuse(gate, getByLabelText('Room PIN'), button, 30);

    const status = getByRole('status');
    expect(status.textContent).toContain('Too many attempts');
    expect(status.textContent).toContain('30s');
    expect(status.textContent).not.toContain('Incorrect');
    expect(queryByRole('alert')).toBeNull(); // the wrong-PIN sentence must NOT also be showing
    // Join is held closed while the cooldown runs: a button that can only fail is worse than
    // an honest wait.
    expect((button as HTMLButtonElement).disabled).toBe(true);
  });

  it('counts the wait down and re-opens Join when it lapses', async () => {
    const gate = authGateStoreDouble();
    const { getByLabelText, getByRole } = render(PinGate, { props: { store: gate.store } });
    const button = getByRole('button');
    await submitAndRefuse(gate, getByLabelText('Room PIN'), button, 3);
    expect(getByRole('status').textContent).toContain('3s');

    await vi.advanceTimersByTimeAsync(2_000);
    await waitFor(() => expect(getByRole('status').textContent).toContain('1s'));
    expect((button as HTMLButtonElement).disabled).toBe(true);

    await vi.advanceTimersByTimeAsync(1_000);
    await waitFor(() => expect(getByRole('status').textContent).toContain('try again now'));
    expect((button as HTMLButtonElement).disabled).toBe(false);
  });

  it('a cooldown the server would not quantify still reads as a cooldown, with no number', async () => {
    const gate = authGateStoreDouble();
    const { getByLabelText, getByRole, queryByRole } = render(PinGate, { props: { store: gate.store } });
    const button = getByRole('button');
    await submitAndRefuse(gate, getByLabelText('Room PIN'), button, 0);

    expect(getByRole('status').textContent).toContain('Too many attempts');
    expect(queryByRole('alert')).toBeNull();
    expect((button as HTMLButtonElement).disabled).toBe(false); // nothing to wait out
  });

  it('shows a cooldown on arrival, before the user has typed anything', async () => {
    // Unlike a wrong PIN, a cooldown is a fact about the connection: typing a perfect PIN would
    // still be refused, so making the user discover that by failing first would be cruel.
    const gate = authGateStoreDouble();
    const { getByRole, queryByRole } = render(PinGate, { props: { store: gate.store } });
    gate.refuse(20);
    await waitFor(() => expect(getByRole('status').textContent).toContain('20s'));
    expect(queryByRole('alert')).toBeNull();
    expect((getByRole('button') as HTMLButtonElement).disabled).toBe(true);
  });

  it('does NOT accuse a PIN the user never typed — a refused stored PIN raises no error copy', async () => {
    const gate = authGateStoreDouble();
    const { queryByRole } = render(PinGate, { props: { store: gate.store } });
    gate.refuse(null); // the tab was refused on its stored PIN, with no submit of ours
    await waitFor(() => {});
    expect(queryByRole('alert')).toBeNull();
    expect(queryByRole('status')).toBeNull();
  });

  it('a cooldown that lapses into a wrong-PIN refusal swaps the sentence over', async () => {
    const gate = authGateStoreDouble();
    const { getByLabelText, getByRole, queryByRole } = render(PinGate, { props: { store: gate.store } });
    const button = getByRole('button');
    await submitAndRefuse(gate, getByLabelText('Room PIN'), button, 2);
    expect(getByRole('status')).toBeTruthy();

    await vi.advanceTimersByTimeAsync(2_000);
    await fireEvent.click(button);
    gate.refuse(null); // this time the PIN really was wrong
    await waitFor(() => expect(getByRole('alert').textContent).toContain('Incorrect PIN'));
    expect(queryByRole('status')).toBeNull();
  });

  it('submits the trimmed PIN, and refuses to resubmit while a cooldown is running', async () => {
    const gate = authGateStoreDouble();
    const { getByLabelText, getByRole } = render(PinGate, { props: { store: gate.store } });
    const input = getByLabelText('Room PIN');
    const button = getByRole('button');

    await fireEvent.input(input, { target: { value: '  4242  ' } });
    await fireEvent.click(button);
    expect(gate.submitted).toEqual(['4242']);

    gate.refuse(10);
    await waitFor(() => expect(getByRole('status')).toBeTruthy());
    await fireEvent.click(button);
    expect(gate.submitted).toEqual(['4242']); // no second attempt into a live cooldown
  });
});
