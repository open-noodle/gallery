import { celebrate, trajectory } from '#lib/gallery/motion/celebrate.ts';

describe('trajectory', () => {
  it('launches along the angle and falls under gravity', () => {
    const up = -Math.PI / 2;
    expect(trajectory(up, 200, 0)).toEqual({ x: 0, y: 0 });
    const early = trajectory(up, 200, 0.1);
    const late = trajectory(up, 200, 0.6);
    expect(early.y).toBeLessThan(0);
    expect(late.y).toBeGreaterThan(early.y);
  });
});

describe('celebrate', () => {
  beforeEach(() => {
    Element.prototype.animate = vi.fn(() => ({ finished: Promise.resolve() })) as unknown as Element['animate'];
  });

  afterEach(() => {
    document.body.replaceChildren();
    vi.restoreAllMocks();
  });

  it('bursts pieces from the origin into a layer that removes itself', async () => {
    celebrate('favorite', { x: 50, y: 50 });
    const layer = document.querySelector('[data-gallery-celebration]');
    expect(layer).not.toBeNull();
    expect(layer!.getAttribute('aria-hidden')).toBe('true');
    // the ring plus 12 hearts
    expect(layer!.children).toHaveLength(13);

    await vi.waitFor(() => expect(document.querySelector('[data-gallery-celebration]')).toBeNull());
  });

  it('does nothing without an origin', () => {
    celebrate('success');
    expect(document.querySelector('[data-gallery-celebration]')).toBeNull();
  });

  it('treats a matchMedia that returns nothing as motion allowed', () => {
    vi.spyOn(globalThis, 'matchMedia').mockReturnValue(undefined as unknown as MediaQueryList);
    expect(() => celebrate('success', { x: 0, y: 0 })).not.toThrow();
  });

  it('respects reduced motion', () => {
    vi.spyOn(globalThis, 'matchMedia').mockReturnValue({ matches: true } as MediaQueryList);
    celebrate('success', { x: 0, y: 0 });
    expect(document.querySelector('[data-gallery-celebration]')).toBeNull();
  });
});
