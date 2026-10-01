// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { isControlPress } from './strip-model';


describe('isControlPress — what a second click on a highlighted area may toggle', () => {
  function dom(html: string): HTMLElement {
    const root = document.createElement('section');
    root.innerHTML = html;
    document.body.append(root);
    return root;
  }
  it('labels and blank space are the area; buttons, inputs, sliders and swatches are controls', () => {
    const root = dom('<span class="title">Strobe</span><span class="facectl"><span class="thumb"></span></span><button class="x">x</button><div role="slider"></div>');
    expect(isControlPress(root.querySelector('.title'), root)).toBe(false);
    expect(isControlPress(root, root)).toBe(false);
    expect(isControlPress(root.querySelector('.thumb'), root)).toBe(true);
    expect(isControlPress(root.querySelector('.x'), root)).toBe(true);
    expect(isControlPress(root.querySelector('[role=slider]'), root)).toBe(true);
  });
  it('a named surface counts as the area even though it is a button; ancestors outside the root never count', () => {
    const outer = dom('<div role="group"><section class="card"><button class="name">Pulse</button></section></div>');
    const card = outer.querySelector('.card')!;
    expect(isControlPress(card.querySelector('.name'), card, '.name')).toBe(false);
    expect(isControlPress(card, card)).toBe(false); // the chain's role=group above the card is not inside it
  });
});
