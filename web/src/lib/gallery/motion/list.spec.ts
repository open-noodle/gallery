import { countMotion, flipMotion } from '$lib/gallery/motion/list';
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
});
