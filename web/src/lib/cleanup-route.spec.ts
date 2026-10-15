import { Route } from '$lib/route';
import { match } from '../params/cleanupQueue';

describe('cleanup routes', () => {
  it('builds cleanup urls', () => {
    expect(Route.cleanupUtility()).toBe('/utilities/cleanup');
    expect(Route.cleanupRewind({ monthDay: 923 })).toBe('/utilities/cleanup/rewind/923');
    expect(Route.cleanupQueue({ queue: 'space-hogs' })).toBe('/utilities/cleanup/space-hogs');
  });
  it('matches only known queue slugs', () => {
    expect(['space-hogs', 'bursts', 'screenshots', 'blurry'].every((s) => match(s))).toBe(true);
    expect(match('rewind')).toBe(false);
    expect(match('duplicates')).toBe(false);
  });
});
