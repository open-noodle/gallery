import { sdkMock } from '$lib/__mocks__/sdk.mock';
import { load } from './+page';

const { authenticate } = vi.hoisted(() => ({
  authenticate: vi.fn(),
}));

vi.mock('$lib/utils/auth', () => ({ authenticate }));

describe('photoguesser page load', () => {
  const daily = {
    id: 'daily-1',
    spaceId: null,
    ownerId: 'current-user-id',
    name: '2026-08-19',
    dailyOn: '2026-08-19',
    roundCount: 5,
    locationRoundCount: 3,
    answered: 0,
    total: 0,
    scaleDays: 30,
    scaleKm: 100,
    closedAt: null,
    createdAt: '2026-08-19T00:00:00.000Z',
  };

  const stats = { currentStreak: 1, bestStreak: 4, bestScore: 18_420, averageScore: 2100, gamesPlayed: 9 };
  const history = { items: [], hasNextPage: false };

  const makeEvent = () => ({ url: new URL('https://gallery.test/photoguesser') });

  beforeEach(() => {
    vi.resetAllMocks();
    sdkMock.getSoloDailyChallenge.mockResolvedValue({ challenge: daily } as never);
    sdkMock.getSoloStats.mockResolvedValue(stats as never);
    sdkMock.getSoloHistory.mockResolvedValue(history as never);
  });

  it('authenticates, then loads the daily, the stats and the first page of history', async () => {
    const event = makeEvent();

    await expect(load(event as never)).resolves.toEqual({
      daily,
      stats,
      history,
      meta: { title: 'photoguesser' },
    });

    expect(authenticate).toHaveBeenCalledWith(event.url);
    expect(sdkMock.getSoloHistory).toHaveBeenCalledWith({ page: 1, size: 10 });
  });

  // No space involved anywhere: the whole point of the solo surface is that a user in no shared
  // space can reach it, so this loader must never touch a space endpoint.
  it('asks for nothing space-scoped', async () => {
    await load(makeEvent() as never);

    expect(sdkMock.getDailyChallenge).not.toHaveBeenCalled();
    expect(sdkMock.getChallenges).not.toHaveBeenCalled();
    expect(sdkMock.getStandings).not.toHaveBeenCalled();
  });

  // "No daily today" is an ordinary state of the page (the server returns { challenge: null } for a
  // library with nothing playable), not a failed load.
  it('loads the page with no daily when nothing could be generated', async () => {
    sdkMock.getSoloDailyChallenge.mockResolvedValue({ challenge: null } as never);

    await expect(load(makeEvent() as never)).resolves.toMatchObject({ daily: null, stats });
  });

  it('rejects when the daily fails to load', async () => {
    const error = new Error('daily unavailable');
    sdkMock.getSoloDailyChallenge.mockRejectedValue(error);

    await expect(load(makeEvent() as never)).rejects.toThrow(error);
  });
});
