import TestWrapper from '#lib/components/TestWrapper.svelte';
import { sdkMock } from '#lib/gallery/__mocks__/sdk.mock.ts';
import { authManager } from '#lib/managers/auth-manager.svelte.ts';
import { factory } from '#test/unit/factories.ts';
import type {
  GameChallengeListItemResponseDto,
  GameSoloHistoryResponseDto,
  GameSoloStatsResponseDto,
} from '@immich/sdk';
import type { Component } from 'svelte';
import { init, register, waitLocale } from 'svelte-i18n';
import { expect } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page, userEvent } from 'vitest/browser';
import { goto } from '$app/navigation';
import PhotoGuesserPage from './+page.svelte';

vi.mock('$app/navigation', async () => ({
  ...(await import('#test/unit/mocks/app-navigation.ts')),
  goto: vi.fn(),
  invalidateAll: vi.fn(),
}));

// UserPageLayout renders the real NavigationBar, which reads far more of the app than this page.
vi.mock('#lib/components/layouts/UserPageLayout.svelte', async () => {
  const { default: MockComponent } = await import('#lib/components/spaces/mock-user-page-layout.test-wrapper.svelte');
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
  await userEvent.click(page.getByTestId('start-free-play').element());
  return page.getByTestId('challenge-create-panel').element();
}

describe('PhotoGuesser landing page', () => {
  beforeAll(async () => {
    register('en-US', () => import('#i18n/en.json'));
    await init({ fallbackLocale: 'en-US', initialLocale: 'en-US' });
    await waitLocale('en-US');
  });

  beforeEach(() => {
    vi.resetAllMocks();
    authManager.setUser(factory.user({ id: 'current-user-id' }));
    authManager.setPreferences(factory.preferences());
  });

  it('titles the page PhotoGuesser', async () => {
    await renderPage();

    expect(page.getByTestId('user-page-layout').element()).toHaveAttribute('data-title', 'PhotoGuesser');
  });

  it("leads with today's daily, linking to the solo play route", async () => {
    await renderPage();

    await expect
      .element(page.getByTestId('daily-challenge').getByTestId('daily-challenge-play'))
      .toHaveAttribute('href', '/photoguesser/daily-1');
  });

  // Two wordings are wrong here and one is right. The space wording ("add photos ... to this
  // space") is wrong because a solo player may be in no space at all. game_solo_no_photos is wrong
  // too, despite being solo: it prescribes the create panel's source toggles, which are a per-game
  // override that is never written back - the daily is generated from the STORED preference, so a
  // player who follows that sentence gets a playable free-play game and a daily card that shows the
  // same message forever. game_solo_no_photos stays on the free-play path, where it is accurate.
  it('explains a missing daily without prescribing the per-game source toggles', async () => {
    await renderPage({ daily: null });

    const message = page.getByTestId('daily-challenge-unavailable').element();
    expect(message.textContent).toContain('No daily today');
    expect(message.textContent).toContain('add photos with GPS data or capture dates to your library');
    expect(message.textContent).not.toContain('to this space');
    expect(message.textContent).not.toContain('when you start a game');
  });

  it('shows the stats panel and the game history', async () => {
    await renderPage();

    expect(page.getByTestId('solo-stat-current-streak').element().textContent).toContain('1');
    expect(page.getByTestId('solo-history-row-challenge-9').element().textContent).toContain('Challenge 9');
  });

  describe('free play', () => {
    it('keeps the create panel behind the free-play control', async () => {
      await renderPage();

      // Deliberate absence: the control itself must be there, so this cannot pass vacuously.
      expect(page.getByTestId('start-free-play').element()).toBeInTheDocument();
      expect(page.getByTestId('challenge-create-panel').query()).toBeNull();

      await startFreePlay();

      expect(page.getByTestId('challenge-create-panel').element()).toBeInTheDocument();
    });

    // game_solo_no_photos points a player with nothing playable at "when you start a game", so the
    // toggles have to be reachable from the panel that starts one.
    it('offers the source toggles on the create panel, seeded from the stored preference', async () => {
      authManager.setPreferences(
        factory.preferences({ photoGuesser: { includePartners: true, includeSpaces: false } }),
      );

      await renderPage();
      const panel = await startFreePlay();

      expect(page.elementLocator(panel).getByTestId('challenge-create-source-partners').element()).toBeChecked();
      expect(page.elementLocator(panel).getByTestId('challenge-create-source-spaces').element()).not.toBeChecked();
    });

    it('creates a solo game with the chosen sources and opens it', async () => {
      sdkMock.createSoloChallenge.mockResolvedValue({ id: 'challenge-10', roundCount: 5 } as never);

      await renderPage();
      const panel = await startFreePlay();
      await userEvent.click(page.elementLocator(panel).getByTestId('challenge-create-source-spaces').element());
      await userEvent.click(page.elementLocator(panel).getByTestId('challenge-create-submit').element());

      await vi.waitFor(() =>
        expect(sdkMock.createSoloChallenge).toHaveBeenCalledWith({
          gameSoloCreateDto: {
            roundCount: 5,
            type: 'mixed',
            sources: { includePartners: false, includeSpaces: true },
          },
        }),
      );
      await vi.waitFor(() => expect(goto).toHaveBeenCalledWith('/photoguesser/challenge-10'));
    });

    // The 400 body is longer than handleError's 75-char truncation, so it arrives cut off
    // mid-sentence - the localized string has to win for this known status. `isHttpError` is itself
    // one of the auto-mocked SDK functions (sdk.mock.ts replaces every function export), so it
    // returns undefined unless given an implementation: without this line the 400 branch is never
    // taken and the test silently measures the fallback instead.
    it('reports a library with nothing playable in solo terms', async () => {
      sdkMock.isHttpError.mockImplementation((error) => !!(error as { __http?: boolean })?.__http);
      sdkMock.createSoloChallenge.mockRejectedValue({ __http: true, status: 400, message: 'no rounds' });

      await renderPage();
      const panel = await startFreePlay();
      await userEvent.click(page.elementLocator(panel).getByTestId('challenge-create-submit').element());

      await vi.waitFor(() =>
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

      await renderPage();
      const panel = await startFreePlay();
      await userEvent.click(page.elementLocator(panel).getByTestId('challenge-create-submit').element());

      await vi.waitFor(() => expect(toastManagerMock.danger).toHaveBeenCalledWith('Something went wrong'));
      expect(toastManagerMock.danger).not.toHaveBeenCalledWith(
        expect.stringContaining('No photos available for PhotoGuesser'),
      );
    });

    // A library that can only fill three of five rounds still produces a playable game; saying so
    // is the difference between "we shortened it" and "we ignored what you asked for".
    it('warns when the library filled fewer rounds than requested', async () => {
      sdkMock.createSoloChallenge.mockResolvedValue({ id: 'challenge-11', roundCount: 3 } as never);

      await renderPage();
      const panel = await startFreePlay();
      await userEvent.click(page.elementLocator(panel).getByTestId('challenge-create-submit').element());

      // Worded for a solo player, not a space member: the space key this used to share says "This
      // space's photos filled…", and several of its translations hard-code the product noun
      // (de "dieses Spaces", nl "deze Space", ru "этого Space") - so a solo player who may belong
      // to no space at all would be told about photos in one. The `space` absence check is what
      // pins that, and it can only pass because the counts assertion above proves a real string.
      await vi.waitFor(() => expect(toastManagerMock.warning).toHaveBeenCalledWith('Your photos filled 3 of 5 rounds'));
      expect(toastManagerMock.warning).not.toHaveBeenCalledWith(expect.stringContaining('space'));
      await vi.waitFor(() => expect(goto).toHaveBeenCalledWith('/photoguesser/challenge-11'));
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

      await renderPage({ history: { ...HISTORY, hasNextPage: true } });
      await userEvent.click(page.getByTestId('solo-history-load-more').element());

      await vi.waitFor(() => expect(page.getByTestId('solo-history-row-challenge-8').element()).toBeInTheDocument());
      expect(page.getByTestId('solo-history-row-challenge-9').element()).toBeInTheDocument();
      expect(sdkMock.getSoloHistory).toHaveBeenCalledWith({ page: 2, size: 10 });
    });
  });
});
