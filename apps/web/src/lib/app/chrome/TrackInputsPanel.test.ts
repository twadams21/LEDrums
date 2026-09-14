// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import type { TrackInputsStatus } from '@ledrums/protocol';
import TrackInputsPanel from './TrackInputsPanel.svelte';

afterEach(cleanup);
const status: TrackInputsStatus = { status: 'listening', port: 4322, inputs: [
  { id: 'audio-track', name: 'Bass synth', kind: 'audio', connected: true, lastNote: null, lastChannel: null, received: 3, dropped: 0, audio: { level: 0.8, bass: 0.9, mids: 0.4, highs: 0.1 } },
  { id: 'midi-track', name: 'Drum rack', kind: 'midi', connected: true, lastNote: 38, lastChannel: 3, received: 4, dropped: 0, audio: { level: 0, bass: 0, mids: 0, highs: 0 } },
] };
describe('TrackInputsPanel', () => {
  it('makes registration and meters visible without requesting capture or changing selection', () => {
    const onSelect = vi.fn();
    render(TrackInputsPanel, { status, onSelect, canEdit: true });
    expect(screen.getByRole('region', { name: 'Track inputs' })).toBeTruthy();
    expect(screen.getByText('Bass synth')).toBeTruthy();
    expect(screen.getByText('Drum rack')).toBeTruthy();
    expect(screen.getByText(/Last note 38 · channel 3/)).toBeTruthy();
    expect(screen.getAllByRole('meter')).toHaveLength(4);
    expect(onSelect).not.toHaveBeenCalled();
  });
  it('keeps an unavailable saved source selectable rather than silently falling back', () => {
    render(TrackInputsPanel, { status, selected: 'missing-track', canEdit: true });
    expect(screen.getByText('Unavailable track · missing-track')).toBeTruthy();
  });
  it('does not permit viewers to change the Audio source', () => {
    render(TrackInputsPanel, { status, canEdit: false });
    expect(screen.getByRole('button', { name: 'Audio source for graph nodes' }).hasAttribute('disabled')).toBe(true);
  });
  it('lets an offline editor explicitly switch an unavailable track back to browser capture', async () => {
    const onSelect = vi.fn();
    const view = render(TrackInputsPanel, { status, selected: 'audio-track', canEdit: true, onSelect });
    await view.rerender({ status: null });
    expect(onSelect).not.toHaveBeenCalled();
    const selector = screen.getByRole('button', { name: 'Audio source for graph nodes' });
    expect(selector.hasAttribute('disabled')).toBe(false);
    await fireEvent.keyDown(selector, { key: 'Enter' });
    expect(await screen.findByRole('option', { name: 'Browser / loopback capture' })).toBeTruthy();
    await fireEvent.keyDown(selector, { key: 'Home' });
    await fireEvent.keyDown(selector, { key: 'Enter' });
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith(undefined);
    // Let the portaled Select finish its queued focus work before test teardown.
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  it('keeps the offline selector disabled for viewers even with a saved source', async () => {
    const onSelect = vi.fn();
    render(TrackInputsPanel, { selected: 'audio-track', canEdit: false, onSelect });
    const selector = screen.getByRole('button', { name: 'Audio source for graph nodes' });
    expect(selector.hasAttribute('disabled')).toBe(true);
    await fireEvent.click(selector);
    expect(onSelect).not.toHaveBeenCalled();
  });
  it('explains the empty state and does not pretend devices are already packaged', () => {
    render(TrackInputsPanel, { status: { status: 'listening', port: 4322, inputs: [] } });
    expect(screen.getByText(/packaging and Live compatibility still need verification/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Copy track bridge address' })).toBeTruthy();
  });
  it('exposes bind failures and disconnected engine truth', () => {
    const view = render(TrackInputsPanel, { status: { status: 'error', port: 4322, error: 'EADDRINUSE', inputs: [] } });
    expect(screen.getByRole('alert').textContent).toBe('EADDRINUSE');
    view.unmount();
    render(TrackInputsPanel);
    expect(screen.getByText('Engine disconnected')).toBeTruthy();
  });
});
