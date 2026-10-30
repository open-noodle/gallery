import { TILE_MIN_WIDTH, tileSize } from '$lib/gallery/cleanup/tile-size';

describe('tileSize', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => vi.restoreAllMocks());

  it('defaults to medium and remembers a choice per queue', () => {
    expect(tileSize('blurry').get()).toBe('medium');

    tileSize('blurry').set('large');

    expect(tileSize('blurry').get()).toBe('large');
    expect(tileSize('screenshots').get()).toBe('medium');
  });

  it('falls back to medium when storage throws', () => {
    vi.spyOn(localStorage, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(localStorage, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });

    tileSize('screenshots').set('large');
    expect(tileSize('screenshots').get()).toBe('medium');
  });

  it('makes medium tiles bigger than before (150px)', () => {
    expect(TILE_MIN_WIDTH.blurry.medium).toBe(200);
    expect(TILE_MIN_WIDTH.screenshots.medium).toBe(220);
  });
});
