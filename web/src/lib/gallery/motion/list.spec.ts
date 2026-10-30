import { countMotion, flipMotion, slideFrom, staggerDelay } from '$lib/gallery/motion/list';
import { duration } from '$lib/gallery/motion/tokens';

const stubReducedMotion = (reduce: boolean) =>
  vi.stubGlobal('matchMedia', (query: string) => ({ matches: reduce && query.includes('reduce') }));

describe('list motion', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('slides items into the gap on the slow duration', () => {
    stubReducedMotion(false);
    expect(flipMotion()).toMatchObject({ duration: duration.slow });
    expect(flipMotion().easing?.(1)).toBe(1);
  });

  it('counts figures over twice the slow duration', () => {
    stubReducedMotion(false);
    expect(countMotion()).toMatchObject({ duration: duration.slow * 2 });
  });

  it('is instant under reduced motion', () => {
    stubReducedMotion(true);
    expect(flipMotion()).toEqual({ duration: 0 });
    expect(countMotion()).toEqual({ duration: 0 });
  });

  it('caps the stagger', () => {
    stubReducedMotion(false);
    expect(staggerDelay(2)).toBe('80ms');
    expect(staggerDelay(20)).toBe('360ms');
  });

  it('slides in from the direction of travel', () => {
    stubReducedMotion(false);
    expect(slideFrom(1)[0]).toEqual({ translate: '12px 0', opacity: 0 });
    expect(slideFrom(-1)[0].translate).toBe('-12px 0');
    expect(slideFrom(0)).toEqual([]);
  });

  it('has no stagger or slide under reduced motion', () => {
    stubReducedMotion(true);
    expect(staggerDelay(3)).toBe('0ms');
    expect(slideFrom(1)).toEqual([]);
  });
});
