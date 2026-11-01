import { UserAvatarColor } from '@immich/sdk';
import { render } from '@testing-library/svelte';
import { sharedSpaceFactory } from '@test-data/factories/shared-space-factory';
import SpaceBadge from './SpaceBadge.svelte';

const { mockPage, badges } = vi.hoisted(() => ({
  mockPage: { url: new URL('https://gallery.test/photos'), route: { id: null as string | null }, params: {} },
  badges: { request: vi.fn(), spacesOf: vi.fn() },
}));

vi.mock('$app/state', () => ({ page: mockPage }));
vi.mock('./space-badges.svelte', () => ({ spaceBadges: badges }));

const family = sharedSpaceFactory.build({ id: 'family', color: UserAvatarColor.Green });
const trips = sharedSpaceFactory.build({ id: 'trips', color: UserAvatarColor.Blue });

const badge = (container: HTMLElement) => container.querySelector('[data-space-badge]');

describe('SpaceBadge', () => {
  beforeEach(() => {
    mockPage.url = new URL('https://gallery.test/photos');
    mockPage.route.id = '/(user)/photos/[[assetId=id]]';
    badges.request.mockReset();
    badges.spacesOf.mockReset().mockReturnValue([family]);
  });

  it('shows the space icon in the colour of the one space, and asks about the asset', () => {
    const { container } = render(SpaceBadge, { assetId: 'a' });

    expect(badges.request).toHaveBeenCalledWith('a');
    expect(badge(container)?.querySelector('svg')?.getAttribute('class')).toContain('text-green-400');
    expect(badge(container)?.textContent?.trim()).toBe('');
    expect(badge(container)?.getAttribute('aria-hidden')).toBe('true');
  });

  it('shows a white space icon with a count for several spaces', () => {
    badges.spacesOf.mockReturnValue([family, trips]);
    const { container } = render(SpaceBadge, { assetId: 'a' });

    expect(badge(container)?.textContent?.trim()).toBe('2');
    expect(badge(container)?.querySelector('svg')?.getAttribute('class')).toContain('text-white');
  });

  it('shows nothing for an asset in no space or not known yet', () => {
    for (const spaces of [[], undefined]) {
      badges.spacesOf.mockReturnValue(spaces);
      const { container } = render(SpaceBadge, { assetId: 'a' });
      expect(badge(container)).toBeNull();
    }
  });

  it('gives its corner to the selection check', () => {
    const { container } = render(SpaceBadge, { assetId: 'a', covered: true });
    expect(badge(container)).toBeNull();
  });

  it("stays off, without asking, on a space's pages, map and search, the trash, the locked folder and shared links", () => {
    const pages = [
      ['/(user)/spaces/[spaceId]/[[photos=photos]]/[[assetId=id]]', '/spaces/s'],
      ['/(user)/spaces/[spaceId]/people/[personId]', '/spaces/s/people/p'],
      ['/(user)/trash/[[photos=photos]]/[[assetId=id]]', '/trash'],
      ['/(user)/locked/[[photos=photos]]/[[assetId=id]]', '/locked'],
      ['/(user)/share/[key]/[[photos=photos]]/[[assetId=id]]', '/share/k'],
      ['/(user)/s/[slug]/[[photos=photos]]/[[assetId=id]]', '/s/slug'],
      ['/(user)/map/[[photos=photos]]/[[assetId=id]]', '/map?spaceId=s'],
      ['/(user)/search/[[photos=photos]]/[[assetId=id]]', '/search?spaceId=s'],
    ];
    for (const [route, path] of pages) {
      mockPage.route.id = route;
      mockPage.url = new URL(`https://gallery.test${path}`);
      const { container } = render(SpaceBadge, { assetId: 'a' });
      expect(badge(container), route).toBeNull();
    }
    expect(badges.request).not.toHaveBeenCalled();
  });

  it('stays off, without asking, on thumbnails without selection', () => {
    const { container } = render(SpaceBadge, { assetId: 'a', enabled: false });

    expect(badge(container)).toBeNull();
    expect(badges.request).not.toHaveBeenCalled();
  });
});
