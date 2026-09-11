import { sdkMock } from '$lib/__mocks__/sdk.mock';
import { load } from './+page';

const { authenticate } = vi.hoisted(() => ({
  authenticate: vi.fn(),
}));

vi.mock('$lib/utils/auth', () => ({ authenticate }));

describe('game play page load', () => {
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

  const linkedAlbums: unknown[] = [];

  const challenge = {
    id: 'challenge-1',
    spaceId: 'space-1',
    name: 'Summer Trip',
    roundCount: 2,
    scaleDays: 30,
    scaleKm: 100,
    closedAt: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    rounds: [
      { index: 0, type: 'location' },
      { index: 1, type: 'date' },
    ],
  };

  const makeEvent = (overrides: { spaceId?: string; challengeId?: string } = {}) => ({
    url: new URL(
      `https://gallery.test/spaces/${overrides.spaceId ?? 'space-1'}/games/${overrides.challengeId ?? 'challenge-1'}`,
    ),
    params: { spaceId: overrides.spaceId ?? 'space-1', challengeId: overrides.challengeId ?? 'challenge-1' },
    parent: vi.fn().mockResolvedValue({ space, members, linkedAlbums }),
  });

  beforeEach(() => {
    vi.resetAllMocks();
    sdkMock.getChallenge.mockResolvedValue(challenge as never);
  });

  it('authenticates, loads the parent layout, then loads the challenge', async () => {
    const event = makeEvent();
    await expect(load(event as never)).resolves.toEqual({
      challenge,
      meta: { title: 'Summer Trip' },
    });

    expect(authenticate).toHaveBeenCalledWith(event.url);
    expect(event.parent).toHaveBeenCalled();
    // space + members come from the [spaceId] layout, not fetched again here
    expect(sdkMock.getSpace).not.toHaveBeenCalled();
    expect(sdkMock.getMembers).not.toHaveBeenCalled();
    expect(sdkMock.getChallenge).toHaveBeenCalledWith({ id: 'challenge-1' });
  });

  it('rejects when the challenge fails to load', async () => {
    const error = new Error('challenge unavailable');
    sdkMock.getChallenge.mockRejectedValue(error);

    await expect(load(makeEvent() as never)).rejects.toThrow(error);
  });

  // Design §11: a solo challenge id under a space route resolves to a challenge this route cannot
  // render - it has no space, so no leaderboard and no members to score against. 404 rather than
  // redirect, so a wrong link is visible instead of being papered over. The play route on the
  // other side of the fence refuses a space id in exactly the same way.
  it('404s a solo challenge id rather than redirecting', async () => {
    sdkMock.getChallenge.mockResolvedValue({ ...challenge, spaceId: null, ownerId: 'current-user-id' } as never);

    // The message comes from the i18n catalog, not a hardcoded English literal - $t() returns the
    // raw key in this environment, which is what makes that visible here.
    await expect(load(makeEvent() as never)).rejects.toMatchObject({
      status: 404,
      body: { message: 'game_challenge_load_failed' },
    });
  });

  // Same fence, one space over: the id is a real space challenge, just not this space's.
  it('404s a challenge belonging to a different space', async () => {
    sdkMock.getChallenge.mockResolvedValue({ ...challenge, spaceId: 'space-2' } as never);

    await expect(load(makeEvent() as never)).rejects.toMatchObject({ status: 404 });
  });

  // Realistic in a shared space: an editor deletes the challenge while another member still has it
  // open. Same precedent as the [spaceId] layout's own space-gone handling.
  it.each([403, 404])(
    'redirects to the space challenge list when the challenge is gone or access was revoked (%i)',
    async (status) => {
      sdkMock.getChallenge.mockRejectedValue({ status });

      await expect(load(makeEvent() as never)).rejects.toMatchObject({
        status: 302,
        location: '/spaces/space-1/games',
      });
    },
  );
});
