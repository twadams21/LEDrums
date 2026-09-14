// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render } from '@testing-library/svelte';
import Visualizer from './Visualizer.svelte';
import { emptyModel, kitModel } from '../../visualizer/testing/model';

// Only WebGL is replaced; the dock, Bits controls and all bindings are real Svelte components.
vi.mock('../../visualizer/Scene.svelte', async () => ({ default: (await import('../../visualizer/testing/SceneProbe.svelte')).default }));

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  Element.prototype.scrollIntoView ??= vi.fn();
});
afterEach(() => vi.unstubAllGlobals());

describe('Visualizer presentation controls', () => {
  it('defaults to diagnostic Pixels, even in Perform where the 2D/3D switch is hidden', async () => {
    const model = kitModel();
    const store = { model, previewFrame: new Uint8Array(model.count * 3).fill(43) };
    const { getByText, getByTestId, queryByRole } = render(Visualizer, { props: { store, showToggle: false } });
    expect(queryByRole('group', { name: 'Preview mode' })).toBeNull();
    expect(getByTestId('scene').dataset.presentation).toBe('pixels');
    await fireEvent.click(getByText('Stage', { exact: true }));
    expect(getByTestId('scene').dataset.presentation).toBe('stage');
    expect(getByText('Acrylic kit · live LED RGB')).toBeTruthy();
    expect(getByTestId('scene').dataset.frame).toBe('43');
    expect(store.previewFrame.every((byte) => byte === 43)).toBe(true);
  });

  it('wires quality, reset and camera selection without replacing the canvas on frame updates', async () => {
    const model = kitModel();
    const { getByText, getByRole, getByTestId, rerender } = render(Visualizer, { props: { store: { model, previewFrame: new Uint8Array(model.count * 3) } } });
    await fireEvent.click(getByText('Stage', { exact: true }));
    await fireEvent.click(getByText('Detail', { exact: true }));
    await fireEvent.click(getByRole('button', { name: 'Reset camera' }));
    const camera = getByRole('button', { name: 'Camera view' });
    await fireEvent.keyDown(camera, { key: 'Enter' });
    await fireEvent.pointerUp(getByRole('option', { name: 'Top' }), { pointerType: 'mouse' });
    const scene = getByTestId('scene');
    expect(scene.dataset.quality).toBe('detail');
    expect(scene.dataset.camera).toBe('top');
    expect(scene.dataset.reset).toBe('1');
    await rerender({ store: { model, previewFrame: new Uint8Array(model.count * 3).fill(99) } });
    expect(getByTestId('scene')).toBe(scene);
    expect(scene.dataset.frame).toBe('99');
    expect(scene.dataset.camera).toBe('top');
    expect(scene.dataset.reset).toBe('1');
    await fireEvent.click(getByText('Pixels', { exact: true }));
    expect(scene.dataset.presentation).toBe('pixels');
    expect(scene.dataset.camera).toBe('top');
    // Let Bits' portaled close/focus tasks settle before testing-library unmounts the owner.
    await new Promise((resolve) => setTimeout(resolve, 150));
  });

  it('allows an empty stage but disables unavailable camera actions', async () => {
    const { getByText, getByRole, getByTestId } = render(Visualizer, { props: { store: { model: emptyModel(), previewFrame: new Uint8Array() } } });
    expect(getByRole('button', { name: 'Reset camera' }).hasAttribute('disabled')).toBe(true);
    expect(getByRole('button', { name: 'Camera view' }).hasAttribute('disabled')).toBe(true);
    await fireEvent.click(getByText('Stage', { exact: true }));
    expect(getByTestId('scene').dataset.presentation).toBe('stage');
  });

  it('does not mount stage controls for the 2D pixel map', () => {
    const { queryByRole } = render(Visualizer, { props: { store: { model: emptyModel(), previewFrame: new Uint8Array() }, mode: '2d', showToggle: false } });
    expect(queryByRole('group', { name: 'Stage preview controls' })).toBeNull();
  });
});
