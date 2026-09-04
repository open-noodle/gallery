import {
  GameRoundType,
  SharedSpaceRole,
  type GameChallengeDetailResponseDto,
  type GameGuessResponseDto,
  type GameLeaderboardResponseDto,
  type GameRoundDetailResponseDto,
  type SharedSpaceMemberResponseDto,
} from '@immich/sdk';
import '@testing-library/jest-dom';
import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import type { Component } from 'svelte';
import { init, register, waitLocale } from 'svelte-i18n';
import { sdkMock } from '$lib/__mocks__/sdk.mock';
import TestWrapper from '$lib/components/TestWrapper.svelte';
import { authManager } from '$lib/managers/auth-manager.svelte';
import { preferencesFactory } from '@test-data/factories/preferences-factory';
import { userAdminFactory } from '@test-data/factories/user-factory';
import GamePlayPage from './+page.svelte';

// Map.svelte pulls in maplibre-gl, which needs a WebGL canvas happy-dom lacks. Copied verbatim from
// location-round.spec.ts (itself copied from map-page.spec.ts:58-61). Note the @test-data ALIAS; a
// relative path to the stub does not resolve.
vi.mock('$lib/components/shared-components/map/Map.svelte', async () => {
  const { default: MockComponent } = await import('@test-data/mocks/map-component.stub.svelte');
  return { default: MockComponent };
});

// UserPageLayout renders the real NavigationBar, which reads authManager.user - copied verbatim
// from space-album-detail-page.spec.ts, the sibling detail page this page's chrome now mirrors.
vi.mock('$lib/components/layouts/UserPageLayout.svelte', async () => {
  const { default: MockComponent } = await import('$lib/components/spaces/mock-user-page-layout.test-wrapper.svelte');
  return { default: MockComponent };
});

const navigationMock = vi.hoisted(() => ({ goto: vi.fn() }));
vi.mock('$app/navigation', () => navigationMock);

const { toastManagerMock } = vi.hoisted(() => ({
  toastManagerMock: { danger: vi.fn(), primary: vi.fn(), success: vi.fn(), warning: vi.fn() },
}));

vi.mock('@immich/ui', async (importOriginal) => {
  const original = await importOriginal<typeof import('@immich/ui')>();
  return {
    ...original,
    toastManager: toastManagerMock,
  };
});

function makeRound(overrides: Partial<GameRoundDetailResponseDto> = {}): GameRoundDetailResponseDto {
  return {
    index: 0,
    type: GameRoundType.Date,
    ...overrides,
  };
}

function makeChallenge(overrides: Partial<GameChallengeDetailResponseDto> = {}): GameChallengeDetailResponseDto {
  return {
    id: 'challenge-1',
    spaceId: 'space-1',
    ownerId: null,
    name: 'Summer Trip',
    dailyOn: null,
    roundCount: 2,
    // 1970 (GAME_MIN_YEAR) + 2026 (this createdAt's year) averages to a clean 1998, so the
    // date-round's default slider position is deterministic in these tests.
    createdAt: '2026-06-01T00:00:00.000Z',
    scaleDays: 30,
    scaleKm: 100,
    closedAt: null,
    rounds: [makeRound({ index: 0 }), makeRound({ index: 1 })],
    ...overrides,
  };
}

function renderPage(
  challenge: GameChallengeDetailResponseDto,
  members: SharedSpaceMemberResponseDto[] = [
    {
      userId: 'u1',
      name: 'Alice',
      email: 'alice@example.com',
      role: SharedSpaceRole.Viewer,
      showInTimeline: false,
      sharePersonMetadata: true,
      joinedAt: '2026-01-01T00:00:00.000Z',
    } as SharedSpaceMemberResponseDto,
  ],
) {
  const props = { data: { challenge, members } };
  return render(TestWrapper as Component<{ component: typeof GamePlayPage; componentProps: typeof props }>, {
    component: GamePlayPage,
    componentProps: props,
  });
}

describe('Game play page', () => {
  beforeAll(async () => {
    register('en-US', () => import('$i18n/en.json'));
    await init({ fallbackLocale: 'en-US', initialLocale: 'en-US' });
    await waitLocale('en-US');
  });

  beforeEach(() => {
    vi.resetAllMocks();
    authManager.setUser(userAdminFactory.build({ id: 'current-user-id' }));
    authManager.setPreferences(preferencesFactory.build());
    // Every guess re-fetches the challenge (task-9 correction #1); give every test a safe default
    // so a guess never resolves to `challenge = undefined`, and let tests that care about the
    // answer override it explicitly.
    sdkMock.getChallenge.mockResolvedValue(makeChallenge());
  });

  describe('chrome', () => {
    // Prior to this, the play page rendered a bare <div>: no navbar, no back control, no
    // challenge name, so the browser back button was the only way out once a player opened a
    // challenge. Mirrors space-album-detail-page.spec.ts's identical assertions for its sibling
    // detail route.
    it('shows the challenge name as the page title', () => {
      renderPage(makeChallenge({ name: 'Summer Trip' }));
      expect(screen.getByTestId('user-page-layout')).toHaveAttribute('data-title', 'Summer Trip');
    });

    // A daily has no user-facing name - the server stores its UTC date in `name` purely so the
    // column stays non-null - so titling the page with it would put a raw "2026-08-16" at the top
    // of the screen in every language.
    it('titles a daily challenge with the localized daily label, not its stored date', () => {
      renderPage(makeChallenge({ name: '2026-08-16', dailyOn: '2026-08-16' }));
      expect(screen.getByTestId('user-page-layout')).toHaveAttribute('data-title', 'Daily challenge');
    });

    it('renders a back control that returns to the challenge list', async () => {
      renderPage(makeChallenge({ spaceId: 'space-1' }));

      const leading = screen.getByTestId('layout-leading');
      const backButton = leading.querySelector('button');
      expect(backButton).not.toBeNull();

      await fireEvent.click(backButton!);

      expect(navigationMock.goto).toHaveBeenCalledWith('/spaces/space-1/games');
    });

    // Carry-forward from task-2's review: the positive case above proves the back control appears
    // for a space challenge, but nothing proved it stays gone for a solo one (spaceId: null) - a
    // future solo challenge would otherwise inherit a back button wired to
    // `Route.viewSpaceGames({ id: null })`. getByTestId on the wrapper (which always renders,
    // content or not - see mock-user-page-layout.test-wrapper.svelte) so this can't pass vacuously;
    // querySelector('button') is the absence check, returning null rather than throwing.
    it('renders no back control for a challenge with no space', () => {
      renderPage(makeChallenge({ spaceId: null }));

      const leading = screen.getByTestId('layout-leading');
      expect(leading.querySelector('button')).toBeNull();
    });
  });

  describe('resuming', () => {
    it('opens at the first unanswered round, derived from the payload rather than client state', () => {
      const challenge = makeChallenge({
        rounds: [
          makeRound({
            index: 0,
            type: GameRoundType.Date,
            score: 3000,
            answer: { date: '2020-01-01', lat: null, lon: null },
          }),
          makeRound({ index: 1, type: GameRoundType.Location, score: 4000, answer: { date: null, lat: 1, lon: 2 } }),
          makeRound({ index: 2, type: GameRoundType.Location }),
        ],
      });

      renderPage(challenge);

      expect(screen.getByTestId('location-round')).toBeInTheDocument();
      expect(screen.queryByTestId('round-result')).not.toBeInTheDocument();
      expect(screen.getByTestId('game-progress')).toHaveTextContent('Round 3 of 3');
    });

    it('shows the leaderboard immediately for a challenge that was already fully answered', async () => {
      const challenge = makeChallenge({
        rounds: [
          makeRound({ index: 0, score: 3000, answer: { date: '2020-01-01', lat: null, lon: null } }),
          makeRound({ index: 1, score: 4000, answer: { date: '2021-01-01', lat: null, lon: null } }),
        ],
      });
      sdkMock.getLeaderboard.mockResolvedValue({
        entries: [{ userId: 'u1', name: 'Alice', total: 7000, answered: 2 }],
      } as GameLeaderboardResponseDto);

      renderPage(challenge);

      await waitFor(() => expect(screen.getByTestId('game-leaderboard')).toBeInTheDocument());
      expect(screen.getByTestId('leaderboard-row')).toHaveTextContent('Alice');
      expect(screen.getByTestId('game-completed')).toHaveTextContent('Completed');
      expect(screen.queryByTestId('game-progress')).not.toBeInTheDocument();
      expect(sdkMock.getLeaderboard).toHaveBeenCalledWith({ id: 'challenge-1' });
    });
  });

  describe('round rendering', () => {
    it('renders location-round for a location round', () => {
      renderPage(makeChallenge({ rounds: [makeRound({ index: 0, type: GameRoundType.Location })] }));
      expect(screen.getByTestId('location-round')).toBeInTheDocument();
      expect(screen.queryByTestId('date-round')).not.toBeInTheDocument();
    });

    it('renders date-round for a date round', () => {
      renderPage(makeChallenge({ rounds: [makeRound({ index: 0, type: GameRoundType.Date })] }));
      expect(screen.getByTestId('date-round')).toBeInTheDocument();
      expect(screen.queryByTestId('location-round')).not.toBeInTheDocument();
    });
  });

  describe('guessing', () => {
    it('calls guessRound with exactly {lat, lon} for a location round, and shows the distance and both map pins', async () => {
      sdkMock.guessRound.mockResolvedValue({
        roundId: 'r0',
        userId: 'u1',
        guessLat: 12.5,
        guessLon: 45.5,
        guessDate: null,
        distanceKm: 42,
        offsetDays: null,
        score: 3500,
      });
      // Distinct from the beforeEach default (two date rounds with no lat/lon) - a location round
      // with a real answer, so a dropped `guess`/`distanceKm` or a distanceKm<->offsetDays swap in
      // the page's ResultView is actually observable here.
      sdkMock.getChallenge.mockResolvedValue(
        makeChallenge({
          rounds: [
            makeRound({
              index: 0,
              type: GameRoundType.Location,
              score: 3500,
              answer: { date: null, lat: 10, lon: 20 },
            }),
          ],
        }),
      );
      renderPage(makeChallenge({ rounds: [makeRound({ index: 0, type: GameRoundType.Location })] }));

      // Hovering first is what a mouse user does, and it is required: the guess map expands on
      // hover, and a click on the still-collapsed map is spent expanding it rather than placing a
      // pin (see location-round.spec.ts).
      await fireEvent.pointerEnter(screen.getByTestId('location-round-map'), { pointerType: 'mouse' });
      await fireEvent.click(screen.getByTestId('map-stub-click-point'));
      await fireEvent.click(screen.getByTestId('location-round-guess'));

      await waitFor(() =>
        expect(sdkMock.guessRound).toHaveBeenCalledWith({
          id: 'challenge-1',
          index: 0,
          gameGuessDto: { lat: 12.5, lon: 45.5 },
        }),
      );

      await waitFor(() => expect(screen.getByTestId('round-result')).toBeInTheDocument());
      expect(screen.getByTestId('round-result-distance')).toHaveTextContent('You were 42 km away');
      // The result screen's own map (the round-input map has already unmounted by now) must carry
      // both the player's guess pin and the revealed answer pin.
      expect(screen.getByTestId('map-stub')).toHaveAttribute('data-marker-ids', 'guess,answer');
    });

    it('calls guessRound with exactly {date} for a date round', async () => {
      sdkMock.guessRound.mockResolvedValue({
        roundId: 'r0',
        userId: 'u1',
        guessLat: null,
        guessLon: null,
        guessDate: '1998-01-01T00:00:00.000Z',
        distanceKm: null,
        offsetDays: 2,
        score: 4800,
      });
      renderPage(makeChallenge({ rounds: [makeRound({ index: 0, type: GameRoundType.Date })] }));

      await fireEvent.click(screen.getByTestId('date-round-guess'));

      await waitFor(() =>
        // The 1st of the month the picker opens on (July, mid-year) for the mid-range year. The
        // day is always the 1st because the server grades a date round by month, so the emitted
        // day only has to identify which month was picked (date-round.svelte).
        expect(sdkMock.guessRound).toHaveBeenCalledWith({
          id: 'challenge-1',
          index: 0,
          gameGuessDto: { date: '1998-07-01T00:00:00.000Z' },
        }),
      );
    });

    it('shows round-result with the answer obtained from the post-guess re-fetch, not the guess response (which carries none)', async () => {
      sdkMock.guessRound.mockResolvedValue({
        roundId: 'r0',
        userId: 'u1',
        guessLat: null,
        guessLon: null,
        guessDate: '1998-01-01T00:00:00.000Z',
        distanceKm: null,
        offsetDays: 2,
        score: 4800,
      });
      // The only place this distinctive year can come from is this re-fetch - it is nowhere in the
      // guess response and nowhere in the page's initial data.
      sdkMock.getChallenge.mockResolvedValue(
        makeChallenge({
          rounds: [
            makeRound({
              index: 0,
              type: GameRoundType.Date,
              score: 4800,
              answer: { date: '2015-07-04T00:00:00.000Z', lat: null, lon: null },
            }),
          ],
        }),
      );
      renderPage(makeChallenge({ rounds: [makeRound({ index: 0, type: GameRoundType.Date })] }));

      await fireEvent.click(screen.getByTestId('date-round-guess'));

      await waitFor(() => expect(sdkMock.getChallenge).toHaveBeenCalledWith({ id: 'challenge-1' }));
      expect(screen.getByTestId('round-result')).toBeInTheDocument();
      expect(screen.getByTestId('round-result-answer-date')).toHaveTextContent('2015');
    });

    it('a 409 on guess is treated as already-answered: reloads and shows the result, no raw error toast', async () => {
      sdkMock.isHttpError.mockImplementation((error) => !!(error as { __http?: boolean })?.__http);
      sdkMock.guessRound.mockRejectedValue({ __http: true, status: 409, data: {}, message: 'raw' });
      sdkMock.getChallenge.mockResolvedValue(
        makeChallenge({
          rounds: [
            makeRound({
              index: 0,
              type: GameRoundType.Date,
              score: 2500,
              answer: { date: '2011-11-11T00:00:00.000Z', lat: null, lon: null },
            }),
          ],
        }),
      );
      renderPage(makeChallenge({ rounds: [makeRound({ index: 0, type: GameRoundType.Date })] }));

      await fireEvent.click(screen.getByTestId('date-round-guess'));

      await waitFor(() => expect(screen.getByTestId('round-result')).toBeInTheDocument());
      expect(sdkMock.getChallenge).toHaveBeenCalledWith({ id: 'challenge-1' });
      expect(screen.getByTestId('round-result-answer-date')).toHaveTextContent('2011');
      expect(screen.getByTestId('round-result-score')).toHaveTextContent('2500');
      expect(toastManagerMock.danger).not.toHaveBeenCalled();
    });

    it('a 409 recovery whose own re-fetch also fails shows a toast rather than an unhandled rejection', async () => {
      sdkMock.isHttpError.mockImplementation((error) => !!(error as { __http?: boolean })?.__http);
      sdkMock.guessRound.mockRejectedValue({ __http: true, status: 409, data: {}, message: 'raw' });
      // The 409 recovery re-fetch is itself a network call and can fail independently of the guess.
      sdkMock.getChallenge.mockRejectedValue(new Error('network dropped'));
      renderPage(makeChallenge({ rounds: [makeRound({ index: 0, type: GameRoundType.Date })] }));

      await fireEvent.click(screen.getByTestId('date-round-guess'));

      await waitFor(() => expect(toastManagerMock.danger).toHaveBeenCalledWith('Something went wrong'));
      expect(screen.queryByTestId('round-result')).not.toBeInTheDocument();
    });

    it('ignores a second guess fired while the first is still in flight', async () => {
      let resolveGuess!: (value: GameGuessResponseDto) => void;
      sdkMock.guessRound.mockImplementation(
        () =>
          new Promise<GameGuessResponseDto>((resolve) => {
            resolveGuess = resolve;
          }),
      );
      renderPage(makeChallenge({ rounds: [makeRound({ index: 0, type: GameRoundType.Date })] }));

      await fireEvent.click(screen.getByTestId('date-round-guess'));
      await fireEvent.click(screen.getByTestId('date-round-guess'));

      expect(sdkMock.guessRound).toHaveBeenCalledTimes(1);

      resolveGuess({
        roundId: 'r0',
        userId: 'u1',
        guessLat: null,
        guessLon: null,
        guessDate: '1998-01-01T00:00:00.000Z',
        distanceKm: null,
        offsetDays: 2,
        score: 1000,
      });

      await waitFor(() => expect(screen.getByTestId('round-result')).toBeInTheDocument());
    });

    it('a non-409 guess failure surfaces a toast instead of a silent no-op', async () => {
      sdkMock.guessRound.mockRejectedValue(new Error('server exploded'));
      renderPage(makeChallenge({ rounds: [makeRound({ index: 0, type: GameRoundType.Date })] }));

      await fireEvent.click(screen.getByTestId('date-round-guess'));

      await waitFor(() => expect(toastManagerMock.danger).toHaveBeenCalledWith('Something went wrong'));
      expect(screen.queryByTestId('round-result')).not.toBeInTheDocument();
    });
  });

  describe('advancing', () => {
    it('game_next_round advances to the next round, and the leaderboard renders after the last one', async () => {
      sdkMock.guessRound
        .mockResolvedValueOnce({
          roundId: 'r0',
          userId: 'u1',
          guessLat: null,
          guessLon: null,
          guessDate: '1998-01-01T00:00:00.000Z',
          distanceKm: null,
          offsetDays: 2,
          score: 1000,
        })
        .mockResolvedValueOnce({
          roundId: 'r1',
          userId: 'u1',
          guessLat: null,
          guessLon: null,
          guessDate: '1998-01-01T00:00:00.000Z',
          distanceKm: null,
          offsetDays: 1,
          score: 2000,
        });
      sdkMock.getChallenge
        .mockResolvedValueOnce(
          makeChallenge({
            rounds: [
              makeRound({
                index: 0,
                type: GameRoundType.Date,
                score: 1000,
                answer: { date: null, lat: null, lon: null },
              }),
              makeRound({ index: 1, type: GameRoundType.Date }),
            ],
          }),
        )
        .mockResolvedValueOnce(
          makeChallenge({
            rounds: [
              makeRound({
                index: 0,
                type: GameRoundType.Date,
                score: 1000,
                answer: { date: null, lat: null, lon: null },
              }),
              makeRound({
                index: 1,
                type: GameRoundType.Date,
                score: 2000,
                answer: { date: null, lat: null, lon: null },
              }),
            ],
          }),
        );
      sdkMock.getLeaderboard.mockResolvedValue({
        entries: [{ userId: 'u1', name: 'Alice', total: 3000, answered: 2 }],
      } as GameLeaderboardResponseDto);

      renderPage(
        makeChallenge({
          rounds: [
            makeRound({ index: 0, type: GameRoundType.Date }),
            makeRound({ index: 1, type: GameRoundType.Date }),
          ],
        }),
      );

      expect(screen.getByTestId('game-progress')).toHaveTextContent('Round 1 of 2');

      await fireEvent.click(screen.getByTestId('date-round-guess'));
      await waitFor(() => expect(screen.getByTestId('round-result')).toBeInTheDocument());

      await fireEvent.click(screen.getByTestId('round-result-next'));
      await waitFor(() => expect(screen.getByTestId('date-round')).toBeInTheDocument());
      expect(screen.getByTestId('game-progress')).toHaveTextContent('Round 2 of 2');

      await fireEvent.click(screen.getByTestId('date-round-guess'));
      await waitFor(() => expect(screen.getByTestId('round-result')).toBeInTheDocument());

      await fireEvent.click(screen.getByTestId('round-result-next'));

      await waitFor(() => expect(screen.getByTestId('game-leaderboard')).toBeInTheDocument());
      expect(screen.getByTestId('leaderboard-row')).toHaveTextContent('Alice');
      expect(screen.getByText('Alice')).toBeInTheDocument();
      expect(screen.queryByTestId('game-progress')).not.toBeInTheDocument();
    });
  });

  describe('date round bounds', () => {
    it("derives minYear from the fixed constant and maxYear from the challenge's createdAt, not from a round's answer", () => {
      const challenge = makeChallenge({
        createdAt: '2020-03-01T00:00:00.000Z',
        rounds: [
          // An already-answered round with a wildly different (future) answer year, to prove the
          // slider bounds are not being read off it.
          makeRound({
            index: 0,
            type: GameRoundType.Date,
            score: 1000,
            answer: { date: '2099-01-01', lat: null, lon: null },
          }),
          makeRound({ index: 1, type: GameRoundType.Date }),
        ],
      });

      renderPage(challenge);

      const slider = screen.getByTestId('date-round-slider') as HTMLInputElement;
      expect(slider.min).toBe('1970');
      expect(slider.max).toBe('2020');
    });
  });
});
