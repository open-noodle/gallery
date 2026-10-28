import { shouldCrossfade } from '#lib/gallery/motion/page-transition.ts';

const at = (id: string, params: Record<string, string> = {}) => ({ route: { id }, params, url: new URL('http://x') });

describe('shouldCrossfade', () => {
  it('crossfades between sections', () => {
    expect(
      shouldCrossfade({ from: at('/(user)/photos/[[assetId=id]]'), to: at('/(user)/albums'), willUnload: false }),
    ).toBe(true);
  });

  it('swaps instantly within a page (filters, queries)', () => {
    expect(shouldCrossfade({ from: at('/(user)/search'), to: at('/(user)/search'), willUnload: false })).toBe(false);
  });

  it('leaves the asset viewer to its own motion', () => {
    expect(
      shouldCrossfade({
        from: at('/(user)/albums'),
        to: at('/(user)/albums/[albumId=id]/[[photos=photos]]/[[assetId=id]]', { assetId: 'a1' }),
        willUnload: false,
      }),
    ).toBe(false);
    expect(
      shouldCrossfade({
        from: at('/(user)/search/[[photos=photos]]/[[assetId=id]]', { assetId: 'a1' }),
        to: at('/(user)/albums'),
        willUnload: false,
      }),
    ).toBe(false);
  });

  it('skips full page loads', () => {
    expect(shouldCrossfade({ from: at('/a'), to: at('/b'), willUnload: true })).toBe(false);
  });
});
