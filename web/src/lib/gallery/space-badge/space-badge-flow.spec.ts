import { getAllSpaces, getAssetSpaces, UserAvatarColor } from '@immich/sdk';
import { render } from '@testing-library/svelte';
import { flushSync } from 'svelte';
import { eventManager } from '$lib/managers/event-manager.svelte';
import { userInteraction } from '$lib/stores/user.svelte';
import { sharedSpaceFactory } from '@test-data/factories/shared-space-factory';
import SpaceBadge from './SpaceBadge.svelte';
import { spaceBadges } from './space-badges.svelte';

const { mockPage } = vi.hoisted(() => ({
  mockPage: { url: new URL('https://gallery.test/photos'), route: { id: '/(user)/photos/[[assetId=id]]' }, params: {} },
}));

vi.mock('$app/state', () => ({ page: mockPage }));
vi.mock('$lib/utils/handle-error', () => ({ handleError: vi.fn() }));
vi.mock('@immich/sdk', async (orig) => ({
  ...(await orig<typeof import('@immich/sdk')>()),
  getAssetSpaces: vi.fn(),
  getAllSpaces: vi.fn(),
}));

const family = sharedSpaceFactory.build({ id: 'family', color: UserAvatarColor.Green });
const trips = sharedSpaceFactory.build({ id: 'trips', color: UserAvatarColor.Blue });

const answer = (spaces: Record<string, string[]>) =>
  vi.mocked(getAssetSpaces).mockImplementation(({ assetSpacesDto }) =>
    Promise.resolve({
      assets: assetSpacesDto.assetIds
        .filter((assetId) => spaces[assetId]?.length)
        .map((assetId) => ({ assetId, spaceIds: spaces[assetId] })),
    }),
  );

const settle = async () => {
  await vi.runAllTimersAsync();
  flushSync();
};

const badgeText = (container: HTMLElement) => container.querySelector('[data-space-badge]')?.textContent?.trim();
const badgeClass = (container: HTMLElement) =>
  container.querySelector('[data-space-badge]')?.querySelector(':scope svg')?.getAttribute('class') ?? null;

describe('space badge on a mounted thumbnail', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.mocked(getAssetSpaces).mockReset();
    vi.mocked(getAllSpaces).mockReset().mockResolvedValue([family, trips]);
    spaceBadges.reset();
    userInteraction.recentSpaces = undefined;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('appears once the asset and the spaces list are known', async () => {
    answer({ a: ['family'] });
    const { container } = render(SpaceBadge, { assetId: 'a' });
    expect(badgeClass(container)).toBeNull();

    await settle();

    expect(getAllSpaces).toHaveBeenCalledTimes(1);
    expect(badgeClass(container)).toContain('text-green-400');
  });

  it('follows a change to its asset without blinking', async () => {
    answer({ a: ['family'] });
    const { container } = render(SpaceBadge, { assetId: 'a' });
    await settle();

    answer({ a: ['family', 'trips'] });
    eventManager.emit('SpaceAddAssets', { assetIds: ['a'], spaceId: 'trips' });
    flushSync();
    expect(badgeClass(container)).toContain('text-green-400');

    await settle();
    expect(badgeText(container)).toBe('2');
  });

  it('asks again about every mounted thumbnail on another page', async () => {
    answer({});
    const { container } = render(SpaceBadge, { assetId: 'a' });
    await settle();
    expect(badgeClass(container)).toBeNull();

    answer({ a: ['trips'] });
    eventManager.emit('AppNavigate');
    flushSync();
    await settle();

    expect(vi.mocked(getAssetSpaces)).toHaveBeenCalledTimes(2);
    expect(badgeClass(container)).toContain('text-blue-400');
  });

  it("takes a space's new colour without a reload, keeping the old one until it is there", async () => {
    answer({ a: ['family'] });
    const { container } = render(SpaceBadge, { assetId: 'a' });
    await settle();
    expect(badgeClass(container)).toContain('text-green-400');

    vi.mocked(getAllSpaces).mockResolvedValue([{ ...family, color: UserAvatarColor.Pink }, trips]);
    eventManager.emit('SpaceUpdate', { spaceId: 'family' });
    flushSync();
    expect(badgeClass(container)).toContain('text-green-400');

    await settle();
    expect(getAllSpaces).toHaveBeenCalledTimes(2);
    expect(badgeClass(container)).toContain('text-pink-300');
  });
});
