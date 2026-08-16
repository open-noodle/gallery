import { sdkMock } from '$lib/__mocks__/sdk.mock';
import { load } from './+page';

const { authenticate } = vi.hoisted(() => ({
  authenticate: vi.fn(),
}));

vi.mock('$lib/utils/auth', () => ({ authenticate }));

describe('space games page load', () => {
  const space = {
    id: 'space-1',
    name: 'Test Space',
    createdAt: '2026-01-01T00:00:00.000Z',
    createdById: 'owner-user-id',
  };

  const members = [
    {
      userId: 'current-user-id',
      email: 'user@example.com',
      name: 'Current User',
      role: 'editor',
      showInTimeline: false,
      joinedAt: '2026-01-01T00:00:00.000Z',
    },
  ];

  const linkedAlbums = [
    {
      albumId: 'a1',
      albumName: 'Trip',
      assetCount: 2,
      showInTimeline: true,
      addedById: null,
      albumThumbnailAssetId: null,
      createdAt: '2026-01-01T00:00:00.000Z',
    },
  ];

  const challenges = [
    {
      id: 'challenge-1',
      spaceId: 'space-1',
      name: 'Summer Trip',
      roundCount: 5,
      answered: 2,
      total: 340,
      scaleDays: 30,
      scaleKm: 100,
      closedAt: null,
      createdAt: '2026-01-01T00:00:00.000Z',
    },
  ];

  const makeEvent = (overrides: { spaceId?: string } = {}) => ({
    url: new URL(`https://gallery.test/spaces/${overrides.spaceId ?? 'space-1'}/games`),
    params: { spaceId: overrides.spaceId ?? 'space-1' },
    parent: vi.fn().mockResolvedValue({ space, members, linkedAlbums }),
  });

  beforeEach(() => {
    vi.resetAllMocks();
    sdkMock.getChallenges.mockResolvedValue(challenges as never);
  });

  it('authenticates, loads the parent layout, then loads the space challenges', async () => {
    const event = makeEvent();
    await expect(load(event as never)).resolves.toEqual({
      challenges,
      meta: { title: 'Test Space - Challenges' },
    });

    expect(authenticate).toHaveBeenCalledWith(event.url);
    expect(event.parent).toHaveBeenCalled();
    // space + members come from the [spaceId] layout, not fetched again here
    expect(sdkMock.getSpace).not.toHaveBeenCalled();
    expect(sdkMock.getMembers).not.toHaveBeenCalled();
    expect(sdkMock.getChallenges).toHaveBeenCalledWith({ spaceId: 'space-1' });
  });

  it('rejects when the challenge list fails to load', async () => {
    const error = new Error('challenges unavailable');
    sdkMock.getChallenges.mockRejectedValue(error);

    await expect(load(makeEvent() as never)).rejects.toThrow(error);
  });
});
