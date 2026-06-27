// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { fireEvent, render, waitFor } from '@testing-library/svelte';
// MasterDetail takes its content as snippets, so it's exercised through a small fixture that
// supplies real {#snippet} blocks (see MasterDetail.fixture.svelte) — the same shape the
// Sections / Objects views will adopt. Assertions still target MasterDetail's own rendered DOM.
import MasterDetail from './MasterDetail.fixture.svelte';

describe('MasterDetail', () => {
  it('renders the master rail and detail pane surfaces', () => {
    const { container, getByTestId } = render(MasterDetail);
    // the two bordered surfaces the primitive owns
    expect(container.querySelector('.md-rail')).not.toBeNull();
    expect(container.querySelector('.md-detail')).not.toBeNull();
    // master snippet (rail items) and detail snippet both render
    expect(getByTestId('opt-songs')).not.toBeNull();
    expect(getByTestId('detail-current')).not.toBeNull();
  });

  it('labels the rail nav with railLabel', () => {
    const { container } = render(MasterDetail, { props: { railLabel: 'Object types' } });
    const nav = container.querySelector('.md-rail');
    expect(nav?.tagName).toBe('NAV');
    expect(nav?.getAttribute('aria-label')).toBe('Object types');
  });

  it('defaults the rail width and honours an override', () => {
    const def = render(MasterDetail);
    expect((def.container.querySelector('.md') as HTMLElement).style.getPropertyValue('--md-rail-width')).toBe('210px');

    const custom = render(MasterDetail, { props: { railWidth: '260px' } });
    expect((custom.container.querySelector('.md') as HTMLElement).style.getPropertyValue('--md-rail-width')).toBe('260px');
  });

  it('threads the initial selection into the detail snippet', () => {
    const { getByTestId } = render(MasterDetail);
    expect(getByTestId('detail-current').textContent).toBe('songs');
    // and reflects it as the active rail item
    expect(getByTestId('opt-songs').getAttribute('aria-pressed')).toBe('true');
    expect(getByTestId('opt-effects').getAttribute('aria-pressed')).toBe('false');
  });

  it('selection drives which detail shows', async () => {
    const { getByTestId } = render(MasterDetail);
    expect(getByTestId('detail-current').textContent).toBe('songs');

    await fireEvent.click(getByTestId('opt-effects'));

    // the detail pane tracks the rail selection...
    await waitFor(() => expect(getByTestId('detail-current').textContent).toBe('effects'));
    // ...and the active rail item moves with it
    expect(getByTestId('opt-effects').getAttribute('aria-pressed')).toBe('true');
    expect(getByTestId('opt-songs').getAttribute('aria-pressed')).toBe('false');
  });
});
