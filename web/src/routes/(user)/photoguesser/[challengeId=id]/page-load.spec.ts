import { sdkMock } from '$lib/__mocks__/sdk.mock';
import { load } from './+page';

const { authenticate } = vi.hoisted(() => ({
  authenticate: vi.fn(),
}));

vi.mock('$lib/utils/auth', () => ({ authenticate }));

describe('photoguesser play page load', () => {
  const challenge = {
    id: 'challenge-1',
    spaceId: null,
    ownerId: 'current-user-id',
    name: 'Challenge 3',
    dailyOn: null,
    roundCount: 2,
    scaleDays: 30,
    scaleKm: 100,
    closedAt: null,
    createdAt: '2026-08-19T00:00:00.000Z',
    rounds: [
      { index: 0, type: 'location' },
      { index: 1, type: 'date' },
    ],
  };

  const makeEvent = () => ({
    url: new URL('https://gallery.test/photoguesser/challenge-1'),
    params: { challengeId: 'challenge-1' },
  });

  beforeEach(() => {
    vi.resetAllMocks();
    sdkMock.getChallenge.mockResolvedValue(challenge as never);
  });

  it('authenticates, then loads the challenge', async () => {
    const event = makeEvent();

    await expect(load(event as never)).resolves.toEqual({
      challenge,
      meta: { title: 'Challenge 3' },
    });

    expect(authenticate).toHaveBeenCalledWith(event.url);
    expect(sdkMock.getChallenge).toHaveBeenCalledWith({ id: 'challenge-1' });
  });

  // meta.title is the BROWSER TAB, so it needs the same daily handling the visible header already
  // has: a daily's stored name is the raw UTC date the server keeps only to hold the column
  // non-null, and a tab reading "2026-08-19" is that date leaking in every language. $t() returns
  // the raw key in this environment, which is what makes the localized lookup visible here.
  it('titles a daily with the localized daily label, not its stored date', async () => {
    sdkMock.getChallenge.mockResolvedValue({ ...challenge, name: '2026-08-19', dailyOn: '2026-08-19' } as never);

    await expect(load(makeEvent() as never)).resolves.toMatchObject({
      meta: { title: 'game_daily_challenge' },
    });
  });

  // Design §11: a space challenge id under /photoguesser resolves to a challenge this route cannot
  // render - it has no space chrome, no leaderboard and no members. 404 rather than redirect, so a
  // wrong link is visible instead of being papered over into a page that quietly is not the one
  // asked for.
  it('404s a space challenge id rather than redirecting', async () => {
    sdkMock.getChallenge.mockResolvedValue({ ...challenge, spaceId: 'space-1', ownerId: null } as never);

    // The message comes from the i18n catalog, not a hardcoded English literal - $t() returns the
    // raw key in this environment, which is what makes that visible here.
    await expect(load(makeEvent() as never)).rejects.toMatchObject({
      status: 404,
      body: { message: 'game_challenge_load_failed' },
    });
  });

  // Unplayed challenges are pruned after seven days, so a bookmarked free-play link genuinely
  // stops existing. Back to the landing page, mirroring the sibling space route's handling.
  it.each([403, 404])('returns to the landing page when the challenge is gone (%i)', async (status) => {
    sdkMock.getChallenge.mockRejectedValue({ status });

    await expect(load(makeEvent() as never)).rejects.toMatchObject({
      status: 302,
      location: '/photoguesser',
    });
  });

  it('rejects when the challenge fails to load for any other reason', async () => {
    const error = new Error('challenge unavailable');
    sdkMock.getChallenge.mockRejectedValue(error);

    await expect(load(makeEvent() as never)).rejects.toThrow(error);
  });
});
