// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render } from '@testing-library/svelte';
// MidiLearnRow takes its value field as a snippet, so it is exercised through a small fixture
// that supplies a real {#snippet} body (precedent: MasterDetail.fixture.svelte). Assertions
// target MidiLearnRow's own rendered DOM.
import MidiLearnRow from './MidiLearnRow.fixture.svelte';

describe('MidiLearnRow', () => {
  it('reads "Learn" when idle', () => {
    const { getByRole } = render(MidiLearnRow, { props: { learning: false } });
    expect(getByRole('button').textContent?.trim()).toBe('Learn');
  });

  it('reads "Listening" once armed', () => {
    const { getByRole } = render(MidiLearnRow, { props: { learning: true } });
    expect(getByRole('button').textContent?.trim()).toBe('Listening');
  });

  it('marks the armed pill active so it takes the accent treatment', () => {
    const { getByRole } = render(MidiLearnRow, { props: { learning: true } });
    expect(getByRole('button').classList.contains('active')).toBe(true);
  });

  it('fires onToggle exactly once per click', async () => {
    const onToggle = vi.fn();
    const { getByRole } = render(MidiLearnRow, { props: { learning: false, onToggle } });

    await fireEvent.click(getByRole('button'));
    expect(onToggle).toHaveBeenCalledTimes(1);

    await fireEvent.click(getByRole('button'));
    expect(onToggle).toHaveBeenCalledTimes(2);
  });

  it('fires onToggle when armed too — the pill cancels as well as arms', async () => {
    const onToggle = vi.fn();
    const { getByRole } = render(MidiLearnRow, { props: { learning: true, onToggle } });

    await fireEvent.click(getByRole('button'));
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  // The contract the browser actually enforces is the `disabled` attribute — a disabled button
  // never dispatches click. Asserted the same way AdoptByIpRow.test.ts asserts it, and NOT via
  // `fireEvent.click(...)` + "handler not called": fireEvent dispatches straight at the node and
  // bypasses that suppression, so such a test would be measuring jsdom, not this component.
  it('marks the pill disabled so the browser blocks the click', () => {
    const { getByRole } = render(MidiLearnRow, { props: { learning: false, disabled: true } });
    expect((getByRole('button') as HTMLButtonElement).disabled).toBe(true);
  });

  it('is enabled by default', () => {
    const { getByRole } = render(MidiLearnRow, { props: { learning: false } });
    expect((getByRole('button') as HTMLButtonElement).disabled).toBe(false);
  });

  it('renders the caller’s field beside the pill', () => {
    const { getByTestId, getByRole } = render(MidiLearnRow, { props: { learning: false } });
    expect(getByTestId('field')).not.toBeNull();
    expect(getByRole('button')).not.toBeNull();
  });
});
