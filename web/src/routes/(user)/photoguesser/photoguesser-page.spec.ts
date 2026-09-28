import type {
  GameChallengeListItemResponseDto,
  GameSoloHistoryResponseDto,
  GameSoloStatsResponseDto,
} from '@immich/sdk';
import '@testing-library/jest-dom';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/svelte';
import type { Component } from 'svelte';
import { init, register, waitLocale } from 'svelte-i18n';
import { goto } from '$app/navigation';
import { sdkMock } from '$lib/__mocks__/sdk.mock';
import TestWrapper from '$lib/components/TestWrapper.svelte';
import { authManager } from '$lib/managers/auth-manager.svelte';
import { preferencesFactory } from '@test-data/factories/preferences-factory';
import { userAdminFactory } from '@test-data/factories/user-factory';
import PhotoGuesserPage from './+page.svelte';

vi.mock('$app/navigation', () => ({ goto: vi.fn(), invalidateAll: vi.fn() }));

// UserPageLayout renders the real NavigationBar, which reads far more of the app than this page.
vi.mock('$lib/components/layouts/UserPageLayout.svelte', async () => {
  const { default: MockComponent } = await import('$lib/components/spaces/mock-user-page-layout.test-wrapper.svelte');
  return { default: MockComponent };
});

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

function makeDaily(overrides: Partial<GameChallengeListItemResponseDto> = {}): GameChallengeListItemResponseDto {
  return {
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
    ...overrides,
  };
}

const STATS: GameSoloStatsResponseDto = {
  currentStreak: 1,
  bestStreak: 4,
  bestScore: 18_420,
  averageScore: 2100,
  gamesPlayed: 9,
};

const HISTORY: GameSoloHistoryResponseDto = {
  items: [
    {
      id: 'challenge-9',
      name: 'Challenge 9',
      dailyOn: null,
      roundCount: 5,
      answered: 5,
      total: 12_000,
      createdAt: '2026-08-18T10:00:00.000Z',
    },
  ],
  hasNextPage: false,
};

function renderPage(
  data: {
    daily?: GameChallengeListItemResponseDto | null;
    stats?: GameSoloStatsResponseDto;
    history?: GameSoloHistoryResponseDto;
  } = {},
) {
  const props = {
    data: {
      daily: data.daily === undefined ? makeDaily() : data.daily,
      stats: data.stats ?? STATS,
      history: data.history ?? HISTORY,
      meta: { title: 'PhotoGuesser' },
    },
  };
  return render(TestWrapper as Component<{ component: typeof PhotoGuesserPage; componentProps: typeof props }>, {
    component: PhotoGuesserPage,
    componentProps: props,
  });
}

/** Creating is two steps: the free-play control reveals the panel, the panel's button submits. */
async function startFreePlay() {
  await fireEvent.click(screen.getByTestId('start-free-play'));
  return screen.getByTestId('challenge-create-panel');
}

describe('PhotoGuesser landing page', () => {
  beforeAll(async () => {
    register('en-US', () => import('$i18n/en.json'));
    await init({ fallbackLocale: 'en-US', initialLocale: 'en-US' });
    await waitLocale('en-US');
  });

  beforeEach(() => {
    vi.resetAllMocks();
    authManager.setUser(userAdminFactory.build({ id: 'current-user-id' }));
    authManager.setPreferences(preferencesFactory.build());
  });

  it('titles the page PhotoGuesser', () => {
    renderPage();

    expect(screen.getByTestId('user-page-layout')).toHaveAttribute('data-title', 'PhotoGuesser');
  });

  it("leads with today's daily, linking to the solo play route", () => {
    renderPage();

    expect(within(screen.getByTestId('daily-challenge')).getByTestId('daily-challenge-play')).toHaveAttribute(
      'href',
      '/photoguesser/daily-1',
    );
  });

  // Two wordings are wrong here and one is right. The space wording ("add photos ... to this
  // space") is wrong because a solo player may be in no space at all. game_solo_no_photos is wrong
  // too, despite being solo: it prescribes the create panel's source toggles, which are a per-game
  // override that is never written back - the daily is generated from the STORED preference, so a
  // player who follows that sentence gets a playable free-play game and a daily card that shows the
  // same message forever. game_solo_no_photos stays on the free-play path, where it is accurate.
  it('explains a missing daily without prescribing the per-game source toggles', () => {
    renderPage({ daily: null });

    const message = screen.getByTestId('daily-challenge-unavailable');
    expect(message).toHaveTextContent('No daily today');
    expect(message).toHaveTextContent('add photos with GPS data or capture dates to your library');
    expect(message).not.toHaveTextContent('to this space');
    expect(message).not.toHaveTextContent('when you start a game');
  });

  it('shows the stats panel and the game history', () => {
    renderPage();

    expect(screen.getByTestId('solo-stat-current-streak')).toHaveTextContent('1');
    expect(screen.getByTestId('solo-history-row-challenge-9')).toHaveTextContent('Challenge 9');
  });

  describe('free play', () => {
    it('keeps the create panel behind the free-play control', async () => {
      renderPage();

      // Deliberate absence: the control itself must be there, so this cannot pass vacuously.
      expect(screen.getByTestId('start-free-play')).toBeInTheDocument();
      expect(screen.queryByTestId('challenge-create-panel')).toBeNull();

      await startFreePlay();

      expect(screen.getByTestId('challenge-create-panel')).toBeInTheDocument();
    });

    // game_solo_no_photos points a player with nothing playable at "when you start a game", so the
    // toggles have to be reachable from the panel that starts one.
    it('offers the source toggles on the create panel, seeded from the stored preference', async () => {
      authManager.setPreferences(
        preferencesFactory.build({ photoGuesser: { includePartners: true, includeSpaces: false } }),
      );

      renderPage();
      const panel = await startFreePlay();

      expect(within(panel).getByTestId('challenge-create-source-partners')).toBeChecked();
      expect(within(panel).getByTestId('challenge-create-source-spaces')).not.toBeChecked();
    });

    it('creates a solo game with the chosen sources and opens it', async () => {
      sdkMock.createSoloChallenge.mockResolvedValue({ id: 'challenge-10', roundCount: 5 } as never);

      renderPage();
      const panel = await startFreePlay();
      await fireEvent.click(within(panel).getByTestId('challenge-create-source-spaces'));
      await fireEvent.click(within(panel).getByTestId('challenge-create-submit'));

      await waitFor(() =>
        expect(sdkMock.createSoloChallenge).toHaveBeenCalledWith({
          gameSoloCreateDto: {
            roundCount: 5,
            type: 'mixed',
            sources: { includePartners: false, includeSpaces: true },
          },
        }),
      );
      await waitFor(() => expect(goto).toHaveBeenCalledWith('/photoguesser/challenge-10'));
    });

    // The 400 body is longer than handleError's 75-char truncation, so it arrives cut off
    // mid-sentence - the localized string has to win for this known status. `isHttpError` is itself
    // one of the auto-mocked SDK functions (sdk.mock.ts replaces every function export), so it
    // returns undefined unless given an implementation: without this line the 400 branch is never
    // taken and the test silently measures the fallback instead.
    it('reports a library with nothing playable in solo terms', async () => {
      sdkMock.isHttpError.mockImplementation((error) => !!(error as { __http?: boolean })?.__http);
      sdkMock.createSoloChallenge.mockRejectedValue({ __http: true, status: 400, message: 'no rounds' });

      renderPage();
      const panel = await startFreePlay();
      await fireEvent.click(within(panel).getByTestId('challenge-create-submit'));

      await waitFor(() =>
        expect(toastManagerMock.danger).toHaveBeenCalledWith(
          expect.stringContaining('No photos available for PhotoGuesser'),
        ),
      );
      expect(goto).not.toHaveBeenCalled();
    });

    // handleError falls back to its localized message whenever the server sent no message at all -
    // a dropped connection, say (handle-error.ts:52). The no-photos copy must not be that fallback,
    // or a network failure tells the player to go and add GPS photos.
    it('reports a connectivity failure as a generic error, not as a missing-photos problem', async () => {
      sdkMock.createSoloChallenge.mockRejectedValue(new Error('Failed to fetch'));

      renderPage();
      const panel = await startFreePlay();
      await fireEvent.click(within(panel).getByTestId('challenge-create-submit'));

      await waitFor(() => expect(toastManagerMock.danger).toHaveBeenCalledWith('Something went wrong'));
      expect(toastManagerMock.danger).not.toHaveBeenCalledWith(
        expect.stringContaining('No photos available for PhotoGuesser'),
      );
    });

    // A library that can only fill three of five rounds still produces a playable game; saying so
    // is the difference between "we shortened it" and "we ignored what you asked for".
    it('warns when the library filled fewer rounds than requested', async () => {
      sdkMock.createSoloChallenge.mockResolvedValue({ id: 'challenge-11', roundCount: 3 } as never);

      renderPage();
      const panel = await startFreePlay();
      await fireEvent.click(within(panel).getByTestId('challenge-create-submit'));

      // Worded for a solo player, not a space member: the space key this used to share says "This
      // space's photos filled…", and several of its translations hard-code the product noun
      // (de "dieses Spaces", nl "deze Space", ru "этого Space") - so a solo player who may belong
      // to no space at all would be told about photos in one. The `space` absence check is what
      // pins that, and it can only pass because the counts assertion above proves a real string.
      await waitFor(() => expect(toastManagerMock.warning).toHaveBeenCalledWith('Your photos filled 3 of 5 rounds'));
      expect(toastManagerMock.warning).not.toHaveBeenCalledWith(expect.stringContaining('space'));
      await waitFor(() => expect(goto).toHaveBeenCalledWith('/photoguesser/challenge-11'));
    });
  });

  describe('history paging', () => {
    it('appends the next page rather than replacing the list', async () => {
      sdkMock.getSoloHistory.mockResolvedValue({
        items: [
          {
            id: 'challenge-8',
            name: 'Challenge 8',
            dailyOn: null,
            roundCount: 5,
            answered: 5,
            total: 9000,
            createdAt: '2026-08-17T10:00:00.000Z',
          },
        ],
        hasNextPage: false,
      } as never);

      renderPage({ history: { ...HISTORY, hasNextPage: true } });
      await fireEvent.click(screen.getByTestId('solo-history-load-more'));

      await waitFor(() => expect(screen.getByTestId('solo-history-row-challenge-8')).toBeInTheDocument());
      expect(screen.getByTestId('solo-history-row-challenge-9')).toBeInTheDocument();
      expect(sdkMock.getSoloHistory).toHaveBeenCalledWith({ page: 2, size: 10 });
    });
  });
});
