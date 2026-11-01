import { estimateTarget, transformBetween } from '$lib/gallery/motion/viewer-zoom';

describe('estimateTarget', () => {
  const viewport = { width: 1000, height: 800 };

  it('fits a landscape photo to the window width, centred vertically', () => {
    expect(estimateTarget(2, viewport)).toEqual({ left: 0, top: 150, width: 1000, height: 500 });
  });

  it('fits a portrait photo to the window height, centred horizontally', () => {
    expect(estimateTarget(0.5, viewport)).toEqual({ left: 300, top: 0, width: 400, height: 800 });
  });
});

describe('transformBetween', () => {
  it('maps the laid-out box onto the target box', () => {
    const base = { left: 100, top: 50, width: 400, height: 200 };
    expect(transformBetween({ left: 10, top: 20, width: 100, height: 50 }, base)).toBe(
      'translate(-90px, -30px) scale(0.25, 0.25)',
    );
    expect(transformBetween(base, base)).toBe('translate(0px, 0px) scale(1, 1)');
  });
});
