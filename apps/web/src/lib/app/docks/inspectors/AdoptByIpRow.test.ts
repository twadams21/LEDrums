// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/svelte';
import AdoptByIpRow from './AdoptByIpRow.svelte';

describe('AdoptByIpRow', () => {
  it('seeds the placeholder from the recommended IP, falling back to a sample', () => {
    const { getByLabelText, rerender } = render(AdoptByIpRow, { props: { recommendedIp: '10.0.0.7' } });
    expect((getByLabelText('Controller IP to adopt') as HTMLInputElement).placeholder).toBe('10.0.0.7');
    rerender({ recommendedIp: undefined });
    expect((getByLabelText('Controller IP to adopt') as HTMLInputElement).placeholder).toBe('192.168.0.50');
  });

  it('fires onAdopt with the trimmed host when Adopt is clicked', async () => {
    const onAdopt = vi.fn();
    const { getByLabelText, getByText } = render(AdoptByIpRow, { props: { onAdopt } });
    await fireEvent.input(getByLabelText('Controller IP to adopt'), { target: { value: ' 192.168.1.77 ' } });
    await fireEvent.click(getByText('Adopt'));
    expect(onAdopt).toHaveBeenCalledWith('192.168.1.77');
  });

  it('adopts on Enter and keeps the Adopt button disabled while the field is blank', async () => {
    const onAdopt = vi.fn();
    const { getByLabelText, getByText } = render(AdoptByIpRow, { props: { onAdopt } });
    const input = getByLabelText('Controller IP to adopt');
    expect((getByText('Adopt').closest('button') as HTMLButtonElement).disabled).toBe(true);
    await fireEvent.input(input, { target: { value: '192.168.1.90' } });
    expect((getByText('Adopt').closest('button') as HTMLButtonElement).disabled).toBe(false);
    await fireEvent.keyDown(input, { key: 'Enter' });
    expect(onAdopt).toHaveBeenCalledWith('192.168.1.90');
  });

  it('disables input and button for a viewer (canEdit=false)', () => {
    const { getByLabelText, getByText } = render(AdoptByIpRow, { props: { canEdit: false } });
    expect((getByLabelText('Controller IP to adopt') as HTMLInputElement).disabled).toBe(true);
    expect((getByText('Adopt').closest('button') as HTMLButtonElement).disabled).toBe(true);
  });
});
