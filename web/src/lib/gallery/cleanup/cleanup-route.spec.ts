import { CleanupRoute } from '$lib/gallery/cleanup/cleanup-route';
import { match } from '../../../params/cleanupQueue';

describe('cleanup routes', () => {
  it('builds cleanup urls', () => {
    expect(CleanupRoute.utility()).toBe('/utilities/cleanup');
    expect(CleanupRoute.rewind({ monthDay: 923 })).toBe('/utilities/cleanup/rewind/923');
    expect(CleanupRoute.queue({ queue: 'space-hogs' })).toBe('/utilities/cleanup/space-hogs');
  });
  it('matches only known queue slugs', () => {
    expect(['space-hogs', 'bursts', 'screenshots', 'blurry'].every((s) => match(s))).toBe(true);
    expect(match('rewind')).toBe(false);
    expect(match('duplicates')).toBe(false);
  });
});
