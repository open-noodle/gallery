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
    dailyChallengeEnabled: true,
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
      dailyOn: null,
      locationRoundCount: 3,
    },
  ];

  const daily = {
    id: 'daily-1',
    spaceId: 'space-1',
    name: '2026-08-16',
    roundCount: 5,
    answered: 0,
    total: 0,
    scaleDays: 30,
    scaleKm: 100,
    closedAt: null,
    createdAt: '2026-08-16T00:00:00.000Z',
    dailyOn: '2026-08-16',
    locationRoundCount: 3,
  };

  const makeEvent = (overrides: { spaceId?: string; space?: Record<string, unknown> } = {}) => ({
    url: new URL(`https://gallery.test/spaces/${overrides.spaceId ?? 'space-1'}/games`),
    params: { spaceId: overrides.spaceId ?? 'space-1' },
    parent: vi.fn().mockResolvedValue({ space: { ...space, ...overrides.space }, members, linkedAlbums }),
  });

  const standings = { month: '2026-08', entries: [] };
  const todayBoard = { entries: [] };

  beforeEach(() => {
    vi.resetAllMocks();
    sdkMock.getChallenges.mockResolvedValue(challenges as never);
    sdkMock.getDailyChallenge.mockResolvedValue({ challenge: daily } as never);
    sdkMock.getStandings.mockResolvedValue(standings as never);
    sdkMock.getLeaderboard.mockResolvedValue(todayBoard as never);
  });

  it('authenticates, loads the parent layout, then loads the challenges and the daily', async () => {
    const event = makeEvent();
    await expect(load(event as never)).resolves.toEqual({
      challenges,
      daily,
      standings,
      todayBoard,
      meta: { title: 'Test Space - Challenges' },
    });

    expect(authenticate).toHaveBeenCalledWith(event.url);
    expect(event.parent).toHaveBeenCalled();
    // space + members come from the [spaceId] layout, not fetched again here
    expect(sdkMock.getSpace).not.toHaveBeenCalled();
    expect(sdkMock.getMembers).not.toHaveBeenCalled();
    expect(sdkMock.getChallenges).toHaveBeenCalledWith({ spaceId: 'space-1' });
    expect(sdkMock.getDailyChallenge).toHaveBeenCalledWith({ spaceId: 'space-1' });
  });

  // A space with nothing playable has no daily, and that is an ordinary page state - the server
  // says so with a null challenge rather than an error, and the load must pass it through as null
  // instead of treating it as a missing field.
  it('passes through a null daily for a space that cannot produce one', async () => {
    sdkMock.getDailyChallenge.mockResolvedValue({ challenge: null } as never);

    await expect(load(makeEvent() as never)).resolves.toEqual({
      challenges,
      daily: null,
      standings,
      todayBoard: null,
      meta: { title: 'Test Space - Challenges' },
    });
  });

  it('rejects when the challenge list fails to load', async () => {
    const error = new Error('challenges unavailable');
    sdkMock.getChallenges.mockRejectedValue(error);

    await expect(load(makeEvent() as never)).rejects.toThrow(error);
  });

  it('loads the monthly standings in parallel with the challenges and the daily', async () => {
    await expect(load(makeEvent() as never)).resolves.toMatchObject({ standings });

    expect(sdkMock.getStandings).toHaveBeenCalledWith({ spaceId: 'space-1' });
  });

  it("loads today's board once the daily's id is known", async () => {
    await expect(load(makeEvent() as never)).resolves.toMatchObject({ todayBoard });

    expect(sdkMock.getLeaderboard).toHaveBeenCalledWith({ id: 'daily-1' });
  });

  it("skips today's board for a space with no daily, rather than calling with an empty id", async () => {
    sdkMock.getDailyChallenge.mockResolvedValue({ challenge: null } as never);

    await expect(load(makeEvent() as never)).resolves.toMatchObject({ todayBoard: null });

    expect(sdkMock.getLeaderboard).not.toHaveBeenCalled();
  });

  it('does not ask for the daily or its board when the space has not opted in', async () => {
    // Not merely an optimisation: the first read of the daily is what GENERATES it, so a page that
    // asks for a space which never opted in is asking the server to do the thing this feature exists
    // to prevent.
    const event = makeEvent({ space: { dailyChallengeEnabled: null } });

    await expect(load(event as never)).resolves.toEqual({
      challenges,
      daily: null,
      standings,
      todayBoard: null,
      meta: { title: 'Test Space - Challenges' },
    });

    expect(sdkMock.getDailyChallenge).not.toHaveBeenCalled();
    expect(sdkMock.getLeaderboard).not.toHaveBeenCalled();
    // The challenges list is unaffected: player-created challenges are not opt-in.
    expect(sdkMock.getChallenges).toHaveBeenCalledWith({ spaceId: 'space-1' });
  });

  it('does not ask for the daily when an editor has declined', async () => {
    const event = makeEvent({ space: { dailyChallengeEnabled: false } });

    await expect(load(event as never)).resolves.toMatchObject({ daily: null, todayBoard: null });

    expect(sdkMock.getDailyChallenge).not.toHaveBeenCalled();
  });

  it('still asks for the standings when the daily is off, because past scores may remain', async () => {
    const event = makeEvent({ space: { dailyChallengeEnabled: false } });

    await load(event as never);

    expect(sdkMock.getStandings).toHaveBeenCalledWith({ spaceId: 'space-1' });
  });
});
