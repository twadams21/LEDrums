// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/svelte';
import { createRawSnippet } from 'svelte';
import CircleDot from '@lucide/svelte/icons/circle-dot';
import AnchorHeader from './AnchorHeader.svelte';

describe('AnchorHeader', () => {
  it('renders the title as an h3 and the mono sub-line', () => {
    const { container } = render(AnchorHeader, { props: { title: 'Output', sub: 'graph output' } });
    expect(container.querySelector('h3')?.textContent).toBe('Output');
    expect(container.querySelector('.sub')?.textContent).toBe('graph output');
  });

  it('omits the sub-line when not provided', () => {
    const { container } = render(AnchorHeader, { props: { title: 'Output' } });
    expect(container.querySelector('.sub')).toBeNull();
  });

  it('renders a leading icon when supplied and tints it', () => {
    const { container } = render(AnchorHeader, {
      props: { title: 'Output', icon: CircleDot, tint: 'var(--role-output)' },
    });
    const ic = container.querySelector('.ic');
    expect(ic?.querySelector('svg')).not.toBeNull();
    expect(ic?.getAttribute('style')).toContain('var(--role-output)');
  });

  it('has no icon slot when no icon is supplied', () => {
    const { container } = render(AnchorHeader, { props: { title: 'Output' } });
    expect(container.querySelector('.ic')).toBeNull();
  });

  it('renders a trailing action snippet', () => {
    const action = createRawSnippet(() => ({
      render: () => `<button data-testid="anchor-action">Duplicate</button>`,
    }));
    const { getByTestId } = render(AnchorHeader, { props: { title: 'Trigger', action } });
    expect(getByTestId('anchor-action')).not.toBeNull();
  });
});
