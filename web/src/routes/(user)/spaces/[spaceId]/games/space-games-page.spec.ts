import TestWrapper from '#lib/components/TestWrapper.svelte';
import { sdkMock } from '#lib/gallery/__mocks__/sdk.mock.ts';
import { authManager } from '#lib/managers/auth-manager.svelte.ts';
import { factory } from '#test/unit/factories.ts';
import {
  SharedSpaceRole,
  type GameChallengeListItemResponseDto,
  type SharedSpaceMemberResponseDto,
  type SharedSpaceResponseDto,
} from '@immich/sdk';
import type { Component } from 'svelte';
import { init, register, waitLocale } from 'svelte-i18n';
import { expect } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page, userEvent } from 'vitest/browser';
import { goto } from '$app/navigation';
import SpaceGamesPage from './+page.svelte';

vi.mock('$app/navigation', async () => ({
  ...(await import('#test/unit/mocks/app-navigation.ts')),
  goto: vi.fn(),
  invalidateAll: vi.fn(),
}));

const { toastManagerMock, modalManagerMock } = vi.hoisted(() => ({
  toastManagerMock: { danger: vi.fn(), primary: vi.fn(), success: vi.fn(), warning: vi.fn() },
  modalManagerMock: { show: vi.fn(), showDialog: vi.fn() },
}));

vi.mock('@immich/ui', async (importOriginal) => {
  const original = await importOriginal<typeof import('@immich/ui')>();
  return {
    ...original,
    toastManager: toastManagerMock,
    modalManager: modalManagerMock,
  };
});

const BASE_SPACE: SharedSpaceResponseDto = {
  id: 'space-1',
  name: 'Test Space',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  ownerId: 'owner-user-id',
  createdById: 'owner-user-id',
  description: '',
  slug: null,
  isPublic: false,
  publicSlug: null,
  allowDownload: true,
  showMetadata: true,
  showExif: true,
  password: null,
  expiresAt: null,
  assets: [],
  albumId: null,
  assetCount: 0,
  faceRecognitionEnabled: true,
  petsEnabled: true,
  dailyChallengeEnabled: true,
} as SharedSpaceResponseDto;

function makeChallenge(overrides: Partial<GameChallengeListItemResponseDto> = {}): GameChallengeListItemResponseDto {
  return {
    id: 'challenge-1',
    spaceId: 'space-1',
    ownerId: null,
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
    ...overrides,
  };
}

function makeMember(role: SharedSpaceRole): SharedSpaceMemberResponseDto {
  return {
    userId: 'current-user-id',
    email: 'user@example.com',
    name: 'Current User',
    role,
    showInTimeline: false,
    sharePersonMetadata: true,
    joinedAt: '2026-01-01T00:00:00.000Z',
  };
}

function renderPage(
  challenges: GameChallengeListItemResponseDto[],
  role: SharedSpaceRole = SharedSpaceRole.Editor,
  daily: GameChallengeListItemResponseDto | null = null,
  boards: {
    standings?: { month: string; entries: Array<{ userId: string; name: string; total: number; daysPlayed: number }> };
    todayBoard?: { entries: Array<{ userId: string; name: string; total: number; answered: number }> } | null;
  } = {},
  space: Partial<typeof BASE_SPACE> = {},
) {
  const props = {
    data: {
      space: { ...BASE_SPACE, ...space },
      members: [makeMember(role)],
      challenges,
      daily,
      standings: boards.standings ?? { month: '2026-08', entries: [] },
      todayBoard: boards.todayBoard ?? null,
      meta: { title: 'Test Space - Challenges' },
    },
  };
  return render(TestWrapper as Component<{ component: typeof SpaceGamesPage; componentProps: typeof props }>, {
    component: SpaceGamesPage,
    componentProps: props,
  });
}

/**
Creating is now two steps: the header action reveals the panel, and the panel's own button
submits the chosen round count and type. A single "create" click no longer exists, which is the
point of the redesign - the player picks a game rather than being handed a default one.
*/
async function createViaPanel() {
  await userEvent.click(page.getByTestId('new-challenge-button').element());
  await userEvent.click(page.getByTestId('challenge-create-submit').element());
}

describe('Space games page', () => {
  beforeAll(async () => {
    register('en-US', () => import('#i18n/en.json'));
    await init({ fallbackLocale: 'en-US', initialLocale: 'en-US' });
    await waitLocale('en-US');
  });

  beforeEach(() => {
    vi.resetAllMocks();
    authManager.setUser(factory.user({ id: 'current-user-id' }));
    authManager.setPreferences(factory.preferences());
    // Deleting a challenge is destructive and now confirms first (mirrors library unlink /
    // space delete); default to "confirmed" so tests that aren't about the dialog itself don't
    // each have to stub it.
    modalManagerMock.showDialog.mockResolvedValue(true);
  });

  it('shows the empty state when there are no challenges', async () => {
    await renderPage([], SharedSpaceRole.Viewer);
    expect(page.getByTestId('empty-state-message').element().textContent).toContain('Create one to start guessing');
  });

  // The daily leads the page whether or not the space has custom challenges - it is the reason to
  // come back, so an empty custom list must not hide it.
  it('shows the daily challenge even when there are no custom challenges', async () => {
    await renderPage([], SharedSpaceRole.Viewer, makeChallenge({ id: 'daily-1', dailyOn: '2026-08-16', answered: 0 }));

    expect(page.getByTestId('daily-challenge').element()).toBeInTheDocument();
    expect(page.getByTestId('daily-challenge-play').element()).toBeInTheDocument();
  });

  it('reports the daily as unavailable when the space cannot produce one', async () => {
    await renderPage([makeChallenge({ id: 'c-1' })], SharedSpaceRole.Viewer, null);

    expect(page.getByTestId('daily-challenge-unavailable').element()).toBeInTheDocument();
  });

  // The daily is generated by the server and shared by the whole space, so it must never appear in
  // the player-created list - where it would carry a delete control that the server refuses.
  it('keeps the daily out of the custom challenge list', async () => {
    await renderPage([makeChallenge({ id: 'c-1' })], SharedSpaceRole.Editor, makeChallenge({ id: 'daily-1' }));

    const cards = page.getByTestId('challenge-card').elements();
    expect(cards).toHaveLength(1);
  });

  it('renders one challenge-card per challenge, linking to the challenge route', async () => {
    await renderPage([
      makeChallenge({ id: 'c-1', name: 'Summer Trip' }),
      makeChallenge({ id: 'c-2', name: 'Winter Trip' }),
    ]);

    const cards = page.getByTestId('challenge-card').elements();
    expect(cards).toHaveLength(2);
    expect(page.getByText('Summer Trip').element()).toBeInTheDocument();
    expect(page.getByText('Winter Trip').element()).toBeInTheDocument();

    const links = page.getByRole('link').elements();
    expect(links.map((link) => link.getAttribute('href'))).toEqual(
      expect.arrayContaining(['/spaces/space-1/games/c-1', '/spaces/space-1/games/c-2']),
    );
  });

  // ── Editor/viewer gating: assert both directions, not just the editor case ──

  it('editor sees the new-challenge action and gets a delete control on each card', async () => {
    await renderPage([makeChallenge({ id: 'c-1' })], SharedSpaceRole.Editor);
    expect(page.getByTestId('new-challenge-button').element()).toBeInTheDocument();
    expect(page.getByTestId('challenge-card-delete').element()).toBeInTheDocument();
  });

  it('owner sees the new-challenge action and gets a delete control on each card', async () => {
    await renderPage([makeChallenge({ id: 'c-1' })], SharedSpaceRole.Owner);
    expect(page.getByTestId('new-challenge-button').element()).toBeInTheDocument();
    expect(page.getByTestId('challenge-card-delete').element()).toBeInTheDocument();
  });

  it('viewer sees neither the new-challenge action nor a delete control', async () => {
    await renderPage([makeChallenge({ id: 'c-1' })], SharedSpaceRole.Viewer);
    expect(page.getByTestId('new-challenge-button').query()).not.toBeInTheDocument();
    expect(page.getByTestId('challenge-card-delete').query()).not.toBeInTheDocument();
  });

  it('editor with no challenges still sees the create action', async () => {
    await renderPage([], SharedSpaceRole.Editor);
    expect(page.getByTestId('new-challenge-button').element()).toBeInTheDocument();
  });

  it('viewer with no challenges sees no create action', async () => {
    await renderPage([], SharedSpaceRole.Viewer);
    expect(page.getByTestId('new-challenge-button').query()).not.toBeInTheDocument();
  });

  // The panel is what carries the round-count and type choice, so it must not be on screen before
  // the player asks to create - otherwise the page is a form again, which is what this replaced.
  it('reveals the create panel only once the create action is pressed', async () => {
    await renderPage([makeChallenge({ id: 'c-1' })], SharedSpaceRole.Editor);
    expect(page.getByTestId('challenge-create-panel').query()).not.toBeInTheDocument();

    await userEvent.click(page.getByTestId('new-challenge-button').element());

    expect(page.getByTestId('challenge-create-panel').element()).toBeInTheDocument();
  });

  describe('create', () => {
    it('creates a challenge with the chosen round count and type, and navigates to it', async () => {
      sdkMock.createChallenge.mockResolvedValue(makeChallenge({ id: 'new-1', roundCount: 5 }));
      await renderPage([makeChallenge({ id: 'c-1' })], SharedSpaceRole.Editor);

      await createViaPanel();

      await vi.waitFor(() =>
        expect(sdkMock.createChallenge).toHaveBeenCalledWith({
          spaceId: 'space-1',
          gameCreateDto: { roundCount: 5, type: 'mixed' },
        }),
      );
      expect(goto).toHaveBeenCalledWith('/spaces/space-1/games/new-1');
    });

    // The picker has to reach the request, or it is decoration: this is the whole reason the panel
    // exists rather than a single "new challenge" button.
    it('passes the picked round count and type through to the server', async () => {
      sdkMock.createChallenge.mockResolvedValue(makeChallenge({ id: 'new-1', roundCount: 10 }));
      await renderPage([makeChallenge({ id: 'c-1' })], SharedSpaceRole.Editor);

      await userEvent.click(page.getByTestId('new-challenge-button').element());
      await userEvent.click(page.getByTestId('challenge-create-rounds-10').element());
      await userEvent.click(page.getByTestId('challenge-create-type-location').element());
      await userEvent.click(page.getByTestId('challenge-create-submit').element());

      await vi.waitFor(() =>
        expect(sdkMock.createChallenge).toHaveBeenCalledWith({
          spaceId: 'space-1',
          gameCreateDto: { roundCount: 10, type: 'location' },
        }),
      );
    });

    it('creates from an empty space and navigates to the new challenge', async () => {
      sdkMock.createChallenge.mockResolvedValue(makeChallenge({ id: 'new-1', roundCount: 5 }));
      await renderPage([], SharedSpaceRole.Editor);

      await createViaPanel();

      await vi.waitFor(() => expect(goto).toHaveBeenCalledWith('/spaces/space-1/games/new-1'));
    });

    // A location game in a GPS-less space fails for a reason the generic message does not name, and
    // pointing the player at "capture dates" would send them after the wrong fix.
    it('surfaces the GPS-specific message when a location game cannot be built', async () => {
      sdkMock.isHttpError.mockImplementation((error) => !!(error as { __http?: boolean })?.__http);
      sdkMock.createChallenge.mockRejectedValue({
        __http: true,
        status: 400,
        data: { message: 'This space has no photos with GPS data' },
        message: 'raw',
      });
      await renderPage([makeChallenge({ id: 'c-1' })], SharedSpaceRole.Editor);

      await userEvent.click(page.getByTestId('new-challenge-button').element());
      await userEvent.click(page.getByTestId('challenge-create-type-location').element());
      await userEvent.click(page.getByTestId('challenge-create-submit').element());

      await vi.waitFor(() =>
        expect(toastManagerMock.danger).toHaveBeenCalledWith(
          "This space has no photos with GPS data - a places challenge isn't possible",
        ),
      );
    });

    it('a 400 (no usable photos) surfaces game_create_failed, not the truncated raw server message', async () => {
      // handleError prefers an HttpError's own message (truncated to 75 chars) over the localized
      // string it's given. The real 400 body is 99 chars, so a plain handleError call here would
      // surface it cut off mid-sentence instead of game_create_failed - a genuine HttpError-shaped
      // rejection (not a plain Error) is required to actually exercise that branch.
      sdkMock.isHttpError.mockImplementation((error) => !!(error as { __http?: boolean })?.__http);
      sdkMock.createChallenge.mockRejectedValue({
        __http: true,
        status: 400,
        data: {
          message:
            'This space has no photos usable for a challenge - add photos with GPS data or capture dates to play',
        },
        message: 'raw',
      });
      await renderPage([makeChallenge({ id: 'c-1' })], SharedSpaceRole.Editor);

      await createViaPanel();

      await vi.waitFor(() =>
        expect(toastManagerMock.danger).toHaveBeenCalledWith("Could not create a challenge from this space's photos"),
      );
      expect(goto).not.toHaveBeenCalled();
    });

    it('a non-400 create failure falls through to the raw server message', async () => {
      sdkMock.isHttpError.mockImplementation((error) => !!(error as { __http?: boolean })?.__http);
      sdkMock.createChallenge.mockRejectedValue({
        __http: true,
        status: 500,
        data: { message: 'boom' },
        message: 'raw',
      });
      await renderPage([makeChallenge({ id: 'c-1' })], SharedSpaceRole.Editor);

      await createViaPanel();

      await vi.waitFor(() => expect(toastManagerMock.danger).toHaveBeenCalledWith('boom\n(Immich Server Error)'));
      expect(goto).not.toHaveBeenCalled();
    });

    it('a roundCount lower than requested surfaces game_rounds_fewer_than_requested and still navigates', async () => {
      sdkMock.createChallenge.mockResolvedValue(makeChallenge({ id: 'new-1', roundCount: 3 }));
      await renderPage([makeChallenge({ id: 'c-1' })], SharedSpaceRole.Editor);

      await createViaPanel();

      await vi.waitFor(() =>
        expect(toastManagerMock.warning).toHaveBeenCalledWith("This space's photos filled 3 of 5 rounds"),
      );
      expect(goto).toHaveBeenCalledWith('/spaces/space-1/games/new-1');
    });

    it('viewer sees no create action to trigger', async () => {
      await renderPage([makeChallenge({ id: 'c-1' })], SharedSpaceRole.Viewer);
      expect(page.getByTestId('new-challenge-button').query()).not.toBeInTheDocument();
      expect(page.getByTestId('challenge-create-panel').query()).not.toBeInTheDocument();
    });
  });

  describe('delete', () => {
    it('confirms, naming the challenge, before calling deleteChallenge', async () => {
      sdkMock.deleteChallenge.mockResolvedValue(undefined as never);
      await renderPage([makeChallenge({ id: 'c-1', name: 'Summer Trip' })], SharedSpaceRole.Editor);

      await userEvent.click(page.getByTestId('challenge-card-delete').element());

      await vi.waitFor(() =>
        expect(modalManagerMock.showDialog).toHaveBeenCalledWith({
          prompt: 'Are you sure you want to delete "Summer Trip"? This cannot be undone.',
          title: 'Delete challenge',
        }),
      );
      expect(sdkMock.deleteChallenge).toHaveBeenCalledWith({ id: 'c-1' });
    });

    it('deletes the challenge and removes its card once confirmed', async () => {
      sdkMock.deleteChallenge.mockResolvedValue(undefined as never);
      await renderPage([makeChallenge({ id: 'c-1', name: 'Summer Trip' })], SharedSpaceRole.Editor);

      await userEvent.click(page.getByTestId('challenge-card-delete').element());

      await vi.waitFor(() => expect(sdkMock.deleteChallenge).toHaveBeenCalledWith({ id: 'c-1' }));
      await vi.waitFor(() => expect(page.getByTestId('challenge-card').query()).not.toBeInTheDocument());
    });

    it('dismissing the confirmation calls neither deleteChallenge nor removes the card', async () => {
      modalManagerMock.showDialog.mockResolvedValue(false);
      await renderPage([makeChallenge({ id: 'c-1', name: 'Summer Trip' })], SharedSpaceRole.Editor);

      await userEvent.click(page.getByTestId('challenge-card-delete').element());

      await vi.waitFor(() => expect(modalManagerMock.showDialog).toHaveBeenCalled());
      expect(sdkMock.deleteChallenge).not.toHaveBeenCalled();
      expect(page.getByTestId('challenge-card').element()).toBeInTheDocument();
    });

    it('a 403 (insufficient role) surfaces game_delete_failed, not the raw server message', async () => {
      // Same shape requirement as the create case above: a genuine HttpError-shaped rejection is
      // needed to actually exercise the status-branch rather than the "no HttpError match" fallback.
      sdkMock.isHttpError.mockImplementation((error) => !!(error as { __http?: boolean })?.__http);
      sdkMock.deleteChallenge.mockRejectedValue({
        __http: true,
        status: 403,
        data: { message: 'Insufficient role' },
        message: 'raw',
      });
      await renderPage([makeChallenge({ id: 'c-1', name: 'Summer Trip' })], SharedSpaceRole.Editor);

      await userEvent.click(page.getByTestId('challenge-card-delete').element());

      await vi.waitFor(() => expect(sdkMock.deleteChallenge).toHaveBeenCalledWith({ id: 'c-1' }));
      await vi.waitFor(() => expect(toastManagerMock.danger).toHaveBeenCalledWith('Could not delete the challenge'));
      expect(page.getByTestId('challenge-card').element()).toBeInTheDocument();
    });

    it('a non-403 delete failure falls through to the raw server message', async () => {
      sdkMock.isHttpError.mockImplementation((error) => !!(error as { __http?: boolean })?.__http);
      sdkMock.deleteChallenge.mockRejectedValue({
        __http: true,
        status: 500,
        data: { message: 'boom' },
        message: 'raw',
      });
      await renderPage([makeChallenge({ id: 'c-1', name: 'Summer Trip' })], SharedSpaceRole.Editor);

      await userEvent.click(page.getByTestId('challenge-card-delete').element());

      await vi.waitFor(() => expect(toastManagerMock.danger).toHaveBeenCalledWith('boom\n(Immich Server Error)'));
      expect(page.getByTestId('challenge-card').element()).toBeInTheDocument();
    });
  });

  describe('standings', () => {
    const entriesFor = (userId: string) => ({
      standings: { month: '2026-08', entries: [{ userId, name: 'Current User', total: 400, daysPlayed: 1 }] },
      todayBoard: { entries: [{ userId, name: 'Current User', total: 400, answered: 5 }] },
    });

    it('renders the standings below the daily hero and above the challenge list', async () => {
      await renderPage(
        [],
        SharedSpaceRole.Viewer,
        makeChallenge({ id: 'daily-1', dailyOn: '2026-08-16', answered: 5 }),
        entriesFor('current-user-id'),
      );

      const section = page.getByTestId('standings-section').element();
      const hero = page.getByTestId('daily-challenge').element();
      // Bitmask, not equality: compareDocumentPosition returns a set of flags.
      expect(section.compareDocumentPosition(hero) & Node.DOCUMENT_POSITION_PRECEDING).toBeTruthy();
      expect(page.getByTestId('leaderboard-row').elements()).toHaveLength(1);
      expect(page.getByTestId('leaderboard-row').element()).toHaveAttribute('data-me', 'true');
    });

    it('still renders the standings when the space has no daily today, without tabs', async () => {
      await renderPage([], SharedSpaceRole.Viewer, null, {
        standings: {
          month: '2026-08',
          entries: [{ userId: 'current-user-id', name: 'Current User', total: 0, daysPlayed: 0 }],
        },
        todayBoard: null,
      });

      expect(page.getByTestId('standings-section').element()).toBeInTheDocument();
      expect(page.getByTestId('standings-tab-today').query()).not.toBeInTheDocument();
      expect(page.getByTestId('leaderboard-row').element().textContent).toContain('Not played');
    });
  });

  describe('daily challenge opt-in', () => {
    it('prompts an editor when nobody has been asked yet', async () => {
      await renderPage([], SharedSpaceRole.Editor, null, {}, { dailyChallengeEnabled: null });

      expect(page.getByTestId('daily-prompt').element()).toBeInTheDocument();
      expect(page.getByTestId('daily-challenge').query()).not.toBeInTheDocument();
    });

    it('never prompts a viewer and gives them no toggle', async () => {
      await renderPage([], SharedSpaceRole.Viewer, null, {}, { dailyChallengeEnabled: null });

      expect(page.getByTestId('daily-prompt').query()).not.toBeInTheDocument();
      expect(page.getByTestId('daily-toggle').query()).not.toBeInTheDocument();
    });

    it('shows the daily card, not the prompt, once enabled', async () => {
      await renderPage(
        [],
        SharedSpaceRole.Editor,
        makeChallenge({ id: 'daily-1', dailyOn: '2026-08-16' }),
        {},
        { dailyChallengeEnabled: true },
      );

      expect(page.getByTestId('daily-challenge').element()).toBeInTheDocument();
      expect(page.getByTestId('daily-prompt').query()).not.toBeInTheDocument();
    });

    it("shows an enabled space's card to a viewer too, without a toggle", async () => {
      await renderPage(
        [],
        SharedSpaceRole.Viewer,
        makeChallenge({ id: 'daily-1', dailyOn: '2026-08-16' }),
        {},
        { dailyChallengeEnabled: true },
      );

      expect(page.getByTestId('daily-challenge').element()).toBeInTheDocument();
      expect(page.getByTestId('daily-toggle').query()).not.toBeInTheDocument();
    });

    it('shows neither prompt nor card after a decline, but keeps the way back', async () => {
      await renderPage([], SharedSpaceRole.Editor, null, {}, { dailyChallengeEnabled: false });

      expect(page.getByTestId('daily-prompt').query()).not.toBeInTheDocument();
      expect(page.getByTestId('daily-challenge').query()).not.toBeInTheDocument();
      // Without this the decline is a one-way door: no card means no card-mounted control could ever
      // bring it back.
      expect(page.getByTestId('daily-toggle').element()).toBeInTheDocument();
    });

    it('writes false when an editor declines', async () => {
      await renderPage([], SharedSpaceRole.Editor, null, {}, { dailyChallengeEnabled: null });

      await userEvent.click(page.getByTestId('daily-prompt-decline').element());

      // false, not undefined: a decline is a decision. undefined would leave the column null and
      // re-prompt on the next visit, which is the behaviour we deliberately did not build.
      expect(sdkMock.updateSpace).toHaveBeenCalledWith({
        id: BASE_SPACE.id,
        sharedSpaceUpdateDto: { dailyChallengeEnabled: false },
      });
    });

    it('writes true when an editor enables', async () => {
      await renderPage([], SharedSpaceRole.Editor, null, {}, { dailyChallengeEnabled: null });

      await userEvent.click(page.getByTestId('daily-prompt-enable').element());

      expect(sdkMock.updateSpace).toHaveBeenCalledWith({
        id: BASE_SPACE.id,
        sharedSpaceUpdateDto: { dailyChallengeEnabled: true },
      });
    });

    it('hides the standings while the prompt is showing, even with earlier scores', async () => {
      // The case a simplification of shouldShowStandings would break: history exists, but a populated
      // board must not sit under a prompt asking whether to switch the feature on.
      await renderPage(
        [],
        SharedSpaceRole.Editor,
        null,
        { standings: { month: '2026-08', entries: [{ userId: 'u1', name: 'Ana', total: 900, daysPlayed: 3 }] } },
        { dailyChallengeEnabled: null },
      );

      expect(page.getByTestId('standings-section').query()).not.toBeInTheDocument();
    });

    it('keeps the standings after a decline when members already earned scores', async () => {
      await renderPage(
        [],
        SharedSpaceRole.Editor,
        null,
        { standings: { month: '2026-08', entries: [{ userId: 'u1', name: 'Ana', total: 900, daysPlayed: 3 }] } },
        { dailyChallengeEnabled: false },
      );

      expect(page.getByTestId('standings-section').element()).toBeInTheDocument();
    });

    // The overflow menu is the ONLY way back from a decline (no prompt, no card once declined), so
    // both its label and the value it writes matter - a wrong label misdescribes the action, and a
    // wrong write (e.g. re-sending the current value instead of the flipped one) would make a
    // decline permanently unrecoverable.
    it('offers to turn the daily on from a declined space, and writes true when clicked', async () => {
      await renderPage([], SharedSpaceRole.Editor, null, {}, { dailyChallengeEnabled: false });

      // The option lives in the overflow menu, which a real browser only renders once it is opened.
      await userEvent.click(page.getByRole('button', { name: 'Turn on daily challenge' }));
      await userEvent.click(page.getByText('Turn on daily challenge', { exact: true }));

      expect(sdkMock.updateSpace).toHaveBeenCalledWith({
        id: BASE_SPACE.id,
        sharedSpaceUpdateDto: { dailyChallengeEnabled: true },
      });
    });

    it('offers to turn the daily off from an enabled space, and writes false when clicked', async () => {
      await renderPage(
        [],
        SharedSpaceRole.Editor,
        makeChallenge({ id: 'daily-1', dailyOn: '2026-08-16' }),
        {},
        { dailyChallengeEnabled: true },
      );

      // The option lives in the overflow menu, which a real browser only renders once it is opened.
      await userEvent.click(page.getByRole('button', { name: 'Turn off daily challenge' }));
      await userEvent.click(page.getByText('Turn off daily challenge', { exact: true }));

      expect(sdkMock.updateSpace).toHaveBeenCalledWith({
        id: BASE_SPACE.id,
        sharedSpaceUpdateDto: { dailyChallengeEnabled: false },
      });
    });

    // Turning the daily ON from the menu is the one slow path with no button to put a spinner in:
    // MenuOption cannot show pending state and the menu closes on click, so before this there was
    // NOTHING on screen for the ~10s of candidate queries and CLIP prompts that generation takes.
    // A user reported exactly that as a freeze.
    it('shows a generating placeholder while an enable from the menu is in flight', async () => {
      // Never resolves, so the page stays in its in-flight state for the assertions.
      sdkMock.updateSpace.mockReturnValue(new Promise(() => {}) as never);
      await renderPage([], SharedSpaceRole.Editor, null, {}, { dailyChallengeEnabled: false });

      expect(page.getByTestId('daily-generating').query()).not.toBeInTheDocument();

      await userEvent.click(page.getByRole('button', { name: 'Turn on daily challenge' }));
      await userEvent.click(page.getByText('Turn on daily challenge', { exact: true }));

      const placeholder = page.getByTestId('daily-generating').element();
      expect(placeholder).toBeInTheDocument();
      expect(placeholder.querySelector('[data-testid="loading-spinner"]')).not.toBeNull();
      expect(page.getByText("Generating today's challenge…").element()).toBeInTheDocument();
    });

    it('does not claim to be generating while a decline is in flight', async () => {
      // Declining generates nothing - it writes a column. Showing "Generating today's challenge"
      // there would be a plain lie, so the placeholder must be scoped to the enable direction.
      sdkMock.updateSpace.mockReturnValue(new Promise(() => {}) as never);
      await renderPage([], SharedSpaceRole.Editor, null, {}, { dailyChallengeEnabled: null });

      await userEvent.click(page.getByTestId('daily-prompt-decline').element());

      expect(page.getByTestId('daily-generating').query()).not.toBeInTheDocument();
    });
  });
});
