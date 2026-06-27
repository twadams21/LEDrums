// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/svelte';
import ReadRow from './ReadRow.svelte';

describe('ReadRow', () => {
  it('renders the label and value into the labelled surfaces', () => {
    const { container, getByText } = render(ReadRow, { props: { label: 'Order', value: '#3 in transmit order' } });
    expect(getByText('Order')).not.toBeNull();
    expect(container.querySelector('.k')?.textContent).toBe('Order');
    expect(container.querySelector('.rval')?.textContent).toBe('#3 in transmit order');
  });
});
