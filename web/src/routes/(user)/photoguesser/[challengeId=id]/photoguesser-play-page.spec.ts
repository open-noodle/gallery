import { GameRoundType, type GameChallengeDetailResponseDto, type GameRoundDetailResponseDto } from '@immich/sdk';
import '@testing-library/jest-dom';
import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import type { Component } from 'svelte';
import { init, register, waitLocale } from 'svelte-i18n';
import { goto } from '$app/navigation';
import { sdkMock } from '$lib/__mocks__/sdk.mock';
import TestWrapper from '$lib/components/TestWrapper.svelte';
import { authManager } from '$lib/managers/auth-manager.svelte';
import { preferencesFactory } from '@test-data/factories/preferences-factory';
import { userAdminFactory } from '@test-data/factories/user-factory';
import PhotoGuesserPlayPage from './+page.svelte';

// Map.svelte pulls in maplibre-gl, which needs a WebGL canvas happy-dom lacks.
vi.mock('$lib/components/shared-components/map/Map.svelte', async () => {
  const { default: MockComponent } = await import('@test-data/mocks/map-component.stub.svelte');
  return { default: MockComponent };
});

vi.mock('$lib/components/layouts/UserPageLayout.svelte', async () => {
  const { default: MockComponent } = await import('$lib/components/spaces/mock-user-page-layout.test-wrapper.svelte');
  return { default: MockComponent };
});

vi.mock('$app/navigation', () => ({ goto: vi.fn() }));

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

/** An already-scored round: `score` present is what marks a round as guessed. */
function answeredRound(overrides: Partial<GameRoundDetailResponseDto> = {}): GameRoundDetailResponseDto {
  return {
    index: 0,
    type: GameRoundType.Date,
    score: 1000,
    answer: { date: '2020-01-01T00:00:00.000Z', lat: null, lon: null },
    ...overrides,
  };
}

function makeChallenge(overrides: Partial<GameChallengeDetailResponseDto> = {}): GameChallengeDetailResponseDto {
  return {
    id: 'challenge-1',
    spaceId: null,
    ownerId: 'current-user-id',
    name: 'Challenge 3',
    dailyOn: null,
    roundCount: 2,
    createdAt: '2026-06-01T00:00:00.000Z',
    scaleDays: 30,
    scaleKm: 100,
    closedAt: null,
    rounds: [answeredRound({ index: 0, score: 1200 }), answeredRound({ index: 1, score: 3400 })],
    ...overrides,
  };
}

function renderPage(challenge: GameChallengeDetailResponseDto) {
  const props = { data: { challenge } };
  return render(TestWrapper as Component<{ component: typeof PhotoGuesserPlayPage; componentProps: typeof props }>, {
    component: PhotoGuesserPlayPage,
    componentProps: props,
  });
}

describe('PhotoGuesser play page', () => {
  beforeAll(async () => {
    register('en-US', () => import('$i18n/en.json'));
    await init({ fallbackLocale: 'en-US', initialLocale: 'en-US' });
    await waitLocale('en-US');
  });

  beforeEach(() => {
    vi.resetAllMocks();
    authManager.setUser(userAdminFactory.build({ id: 'current-user-id' }));
    authManager.setPreferences(preferencesFactory.build());
    sdkMock.getChallenge.mockResolvedValue(makeChallenge());
  });

  describe('chrome', () => {
    it('shows the challenge name as the page title', () => {
      renderPage(makeChallenge({ name: 'Challenge 3' }));

      expect(screen.getByTestId('user-page-layout')).toHaveAttribute('data-title', 'Challenge 3');
    });

    // A daily's stored name is its raw UTC date, kept only so the column stays non-null.
    it('titles a daily with the localized daily label, not its stored date', () => {
      renderPage(makeChallenge({ name: '2026-08-19', dailyOn: '2026-08-19' }));

      expect(screen.getByTestId('user-page-layout')).toHaveAttribute('data-title', 'Daily challenge');
    });

    it('returns to the PhotoGuesser landing page from the back control', async () => {
      renderPage(makeChallenge());

      const backButton = screen.getByTestId('layout-leading').querySelector('button');
      expect(backButton).not.toBeNull();
      await fireEvent.click(backButton!);

      expect(goto).toHaveBeenCalledWith('/photoguesser');
    });
  });

  describe('ending', () => {
    // Solo has nobody to rank against, so the ending is the player's own total. It is summed from
    // the challenge the play loop hands over - every round is scored by then - rather than fetched
    // again.
    it('totals the round scores once every round has been played', () => {
      renderPage(makeChallenge());

      expect(screen.getByTestId('game-completed')).toBeInTheDocument();
      expect(screen.getByTestId('solo-score-total')).toHaveTextContent('4,600');
    });

    it('shows no leaderboard - there is nobody else in a solo game', () => {
      renderPage(makeChallenge());

      // Deliberate absence, anchored on the ending actually being rendered.
      expect(screen.getByTestId('game-completed')).toBeInTheDocument();
      expect(screen.queryByTestId('game-leaderboard')).toBeNull();
    });

    it('starts another game shaped like the one just finished, and opens it', async () => {
      sdkMock.createSoloChallenge.mockResolvedValue({ id: 'challenge-2', roundCount: 2 } as never);

      renderPage(
        makeChallenge({
          roundCount: 2,
          rounds: [
            answeredRound({ index: 0, type: GameRoundType.Location, score: 1200 }),
            answeredRound({ index: 1, type: GameRoundType.Location, score: 3400 }),
          ],
        }),
      );
      await fireEvent.click(screen.getByTestId('solo-play-again'));

      await waitFor(() =>
        expect(sdkMock.createSoloChallenge).toHaveBeenCalledWith({
          gameSoloCreateDto: { roundCount: 2, type: 'location' },
        }),
      );
      await waitFor(() => expect(goto).toHaveBeenCalledWith('/photoguesser/challenge-2'));
    });

    // `isHttpError` is itself auto-mocked (sdk.mock.ts replaces every SDK function export) and
    // returns undefined without an implementation - so without this line the 400 branch is never
    // taken and the test silently measures handleError's fallback instead.
    it('reports a library with nothing left to play in solo terms', async () => {
      sdkMock.isHttpError.mockImplementation((error) => !!(error as { __http?: boolean })?.__http);
      sdkMock.createSoloChallenge.mockRejectedValue({ __http: true, status: 400, message: 'no rounds' });

      renderPage(makeChallenge());
      await fireEvent.click(screen.getByTestId('solo-play-again'));

      await waitFor(() =>
        expect(toastManagerMock.danger).toHaveBeenCalledWith(
          expect.stringContaining('No photos available for PhotoGuesser'),
        ),
      );
      expect(goto).not.toHaveBeenCalled();
    });

    // Same trap as the landing page's create path: handleError's fallback is what a server-message-
    // less failure renders, so the no-photos copy must not be it.
    it('reports a connectivity failure as a generic error, not as a missing-photos problem', async () => {
      sdkMock.createSoloChallenge.mockRejectedValue(new Error('Failed to fetch'));

      renderPage(makeChallenge());
      await fireEvent.click(screen.getByTestId('solo-play-again'));

      await waitFor(() => expect(toastManagerMock.danger).toHaveBeenCalledWith('Something went wrong'));
      expect(toastManagerMock.danger).not.toHaveBeenCalledWith(
        expect.stringContaining('No photos available for PhotoGuesser'),
      );
    });
  });

  // The play loop itself is game-play.svelte's job and is covered by its own tests; this only pins
  // that the solo route mounts it rather than reimplementing a round.
  it('hands an unfinished challenge to the play loop', () => {
    renderPage(
      makeChallenge({
        rounds: [{ index: 0, type: GameRoundType.Date }, answeredRound({ index: 1 })],
      }),
    );

    expect(screen.getByTestId('game-progress')).toHaveTextContent('Round 1 of 2');
    expect(screen.queryByTestId('game-completed')).toBeNull();
  });

  // "Play again" goes from one challenge to another under the SAME route, and SvelteKit reuses the
  // page component across that navigation - it only swaps `data`. game-play.svelte seeds its own
  // state from the challenge it is first handed, so without a keyed remount the player would land
  // back on the finished game they just left instead of the new one.
  it('restarts the play loop when navigation swaps in a different challenge', async () => {
    const { rerender } = renderPage(makeChallenge());
    expect(screen.getByTestId('game-completed')).toBeInTheDocument();

    await rerender({
      component: PhotoGuesserPlayPage,
      componentProps: {
        data: {
          challenge: makeChallenge({
            id: 'challenge-2',
            rounds: [
              { index: 0, type: GameRoundType.Date },
              { index: 1, type: GameRoundType.Date },
            ],
          }),
        },
      },
    });

    expect(screen.getByTestId('game-progress')).toHaveTextContent('Round 1 of 2');
    expect(screen.queryByTestId('game-completed')).toBeNull();
  });
});
