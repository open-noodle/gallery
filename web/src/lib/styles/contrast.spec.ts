import { contrastRatio } from '$lib/styles/contrast';

describe('contrastRatio', () => {
  it('returns 21 for black on white', () => {
    expect(Math.round(contrastRatio('#000000', '#ffffff'))).toBe(21);
  });
  it('returns 1 for identical colors', () => {
    expect(contrastRatio('#3f6fe0', '#3f6fe0')).toBeCloseTo(1, 5);
  });
  it('is order-independent', () => {
    expect(contrastRatio('#1b2a4e', '#cdddfb')).toBeCloseTo(contrastRatio('#cdddfb', '#1b2a4e'), 5);
  });
  it('expands 3-digit hex', () => {
    expect(Math.round(contrastRatio('#000', '#fff'))).toBe(21);
  });
});
