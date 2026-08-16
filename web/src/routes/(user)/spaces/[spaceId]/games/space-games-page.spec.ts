import {
  SharedSpaceRole,
  type GameChallengeListItemResponseDto,
  type SharedSpaceMemberResponseDto,
  type SharedSpaceResponseDto,
} from '@immich/sdk';
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
import SpaceGamesPage from './+page.svelte';

vi.mock('$app/navigation', () => ({ goto: vi.fn(), invalidateAll: vi.fn() }));

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
} as SharedSpaceResponseDto;

function makeChallenge(overrides: Partial<GameChallengeListItemResponseDto> = {}): GameChallengeListItemResponseDto {
  return {
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

function renderPage(challenges: GameChallengeListItemResponseDto[], role: SharedSpaceRole = SharedSpaceRole.Editor) {
  const props = {
    data: {
      space: BASE_SPACE,
      members: [makeMember(role)],
      challenges,
      meta: { title: 'Test Space - Games' },
    },
  };
  return render(TestWrapper as Component<{ component: typeof SpaceGamesPage; componentProps: typeof props }>, {
    component: SpaceGamesPage,
    componentProps: props,
  });
}

describe('Space games page', () => {
  beforeAll(async () => {
    register('en-US', () => import('$i18n/en.json'));
    await init({ fallbackLocale: 'en-US', initialLocale: 'en-US' });
    await waitLocale('en-US');
  });

  beforeEach(() => {
    vi.resetAllMocks();
    authManager.setUser(userAdminFactory.build({ id: 'current-user-id' }));
    authManager.setPreferences(preferencesFactory.build());
    // Deleting a challenge is destructive and now confirms first (mirrors library unlink /
    // space delete); default to "confirmed" so tests that aren't about the dialog itself don't
    // each have to stub it.
    modalManagerMock.showDialog.mockResolvedValue(true);
  });

  it('shows the empty state when there are no challenges', () => {
    renderPage([], SharedSpaceRole.Viewer);
    expect(screen.getByTestId('empty-state-message')).toHaveTextContent('No challenges yet');
  });

  it('renders one challenge-card per challenge, linking to the challenge route', () => {
    renderPage([makeChallenge({ id: 'c-1', name: 'Summer Trip' }), makeChallenge({ id: 'c-2', name: 'Winter Trip' })]);

    const cards = screen.getAllByTestId('challenge-card');
    expect(cards).toHaveLength(2);
    expect(screen.getByText('Summer Trip')).toBeInTheDocument();
    expect(screen.getByText('Winter Trip')).toBeInTheDocument();

    const links = screen.getAllByRole('link');
    expect(links.map((link) => link.getAttribute('href'))).toEqual(
      expect.arrayContaining(['./games/c-1', './games/c-2']),
    );
  });

  // ── Editor/viewer gating: assert both directions, not just the editor case ──

  it('editor sees the new-challenge action and gets a delete control on each card', () => {
    renderPage([makeChallenge({ id: 'c-1' })], SharedSpaceRole.Editor);
    expect(screen.getByTestId('new-challenge-button')).toBeInTheDocument();
    expect(screen.getByTestId('challenge-card-delete')).toBeInTheDocument();
  });

  it('owner sees the new-challenge action and gets a delete control on each card', () => {
    renderPage([makeChallenge({ id: 'c-1' })], SharedSpaceRole.Owner);
    expect(screen.getByTestId('new-challenge-button')).toBeInTheDocument();
    expect(screen.getByTestId('challenge-card-delete')).toBeInTheDocument();
  });

  it('viewer sees neither the new-challenge action nor a delete control', () => {
    renderPage([makeChallenge({ id: 'c-1' })], SharedSpaceRole.Viewer);
    expect(screen.queryByTestId('new-challenge-button')).not.toBeInTheDocument();
    expect(screen.queryByTestId('challenge-card-delete')).not.toBeInTheDocument();
  });

  it('editor with no challenges sees the empty-state create action', () => {
    renderPage([], SharedSpaceRole.Editor);
    expect(screen.getByTestId('empty-new-challenge-button')).toBeInTheDocument();
  });

  it('viewer with no challenges sees no empty-state create action', () => {
    renderPage([], SharedSpaceRole.Viewer);
    expect(screen.queryByTestId('empty-new-challenge-button')).not.toBeInTheDocument();
  });

  describe('create', () => {
    it('creates a challenge with the requested round count and navigates to it', async () => {
      sdkMock.createChallenge.mockResolvedValue(makeChallenge({ id: 'new-1', roundCount: 5 }));
      renderPage([makeChallenge({ id: 'c-1' })], SharedSpaceRole.Editor);

      await fireEvent.click(screen.getByTestId('new-challenge-button'));

      await waitFor(() =>
        expect(sdkMock.createChallenge).toHaveBeenCalledWith({
          spaceId: 'space-1',
          gameCreateDto: { roundCount: 5 },
        }),
      );
      expect(goto).toHaveBeenCalledWith('./games/new-1');
    });

    it('empty-state create: creates a challenge and navigates to it', async () => {
      sdkMock.createChallenge.mockResolvedValue(makeChallenge({ id: 'new-1', roundCount: 5 }));
      renderPage([], SharedSpaceRole.Editor);

      await fireEvent.click(screen.getByTestId('empty-new-challenge-button'));

      await waitFor(() => expect(goto).toHaveBeenCalledWith('./games/new-1'));
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
          message: 'This space has no photos usable for a challenge - add photos with GPS data or capture dates to play',
        },
        message: 'raw',
      });
      renderPage([makeChallenge({ id: 'c-1' })], SharedSpaceRole.Editor);

      await fireEvent.click(screen.getByTestId('new-challenge-button'));

      await waitFor(() =>
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
      renderPage([makeChallenge({ id: 'c-1' })], SharedSpaceRole.Editor);

      await fireEvent.click(screen.getByTestId('new-challenge-button'));

      await waitFor(() => expect(toastManagerMock.danger).toHaveBeenCalledWith('boom\n(Immich Server Error)'));
      expect(goto).not.toHaveBeenCalled();
    });

    it('a roundCount lower than requested surfaces game_rounds_fewer_than_requested and still navigates', async () => {
      sdkMock.createChallenge.mockResolvedValue(makeChallenge({ id: 'new-1', roundCount: 3 }));
      renderPage([makeChallenge({ id: 'c-1' })], SharedSpaceRole.Editor);

      await fireEvent.click(screen.getByTestId('new-challenge-button'));

      await waitFor(() =>
        expect(toastManagerMock.warning).toHaveBeenCalledWith("This space's photos filled 3 of 5 rounds"),
      );
      expect(goto).toHaveBeenCalledWith('./games/new-1');
    });

    it('viewer sees no create action to trigger', () => {
      renderPage([makeChallenge({ id: 'c-1' })], SharedSpaceRole.Viewer);
      expect(screen.queryByTestId('new-challenge-button')).not.toBeInTheDocument();
      expect(screen.queryByTestId('empty-new-challenge-button')).not.toBeInTheDocument();
    });
  });

  describe('delete', () => {
    it('confirms, naming the challenge, before calling deleteChallenge', async () => {
      sdkMock.deleteChallenge.mockResolvedValue(undefined as never);
      renderPage([makeChallenge({ id: 'c-1', name: 'Summer Trip' })], SharedSpaceRole.Editor);

      await fireEvent.click(screen.getByTestId('challenge-card-delete'));

      await waitFor(() =>
        expect(modalManagerMock.showDialog).toHaveBeenCalledWith({
          prompt: 'Are you sure you want to delete "Summer Trip"? This cannot be undone.',
          title: 'Delete challenge',
        }),
      );
      expect(sdkMock.deleteChallenge).toHaveBeenCalledWith({ id: 'c-1' });
    });

    it('deletes the challenge and removes its card once confirmed', async () => {
      sdkMock.deleteChallenge.mockResolvedValue(undefined as never);
      renderPage([makeChallenge({ id: 'c-1', name: 'Summer Trip' })], SharedSpaceRole.Editor);

      await fireEvent.click(screen.getByTestId('challenge-card-delete'));

      await waitFor(() => expect(sdkMock.deleteChallenge).toHaveBeenCalledWith({ id: 'c-1' }));
      await waitFor(() => expect(screen.queryByTestId('challenge-card')).not.toBeInTheDocument());
    });

    it('dismissing the confirmation calls neither deleteChallenge nor removes the card', async () => {
      modalManagerMock.showDialog.mockResolvedValue(false);
      renderPage([makeChallenge({ id: 'c-1', name: 'Summer Trip' })], SharedSpaceRole.Editor);

      await fireEvent.click(screen.getByTestId('challenge-card-delete'));

      await waitFor(() => expect(modalManagerMock.showDialog).toHaveBeenCalled());
      expect(sdkMock.deleteChallenge).not.toHaveBeenCalled();
      expect(screen.getByTestId('challenge-card')).toBeInTheDocument();
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
      renderPage([makeChallenge({ id: 'c-1', name: 'Summer Trip' })], SharedSpaceRole.Editor);

      await fireEvent.click(screen.getByTestId('challenge-card-delete'));

      await waitFor(() => expect(sdkMock.deleteChallenge).toHaveBeenCalledWith({ id: 'c-1' }));
      await waitFor(() => expect(toastManagerMock.danger).toHaveBeenCalledWith('Could not delete the challenge'));
      expect(screen.getByTestId('challenge-card')).toBeInTheDocument();
    });

    it('a non-403 delete failure falls through to the raw server message', async () => {
      sdkMock.isHttpError.mockImplementation((error) => !!(error as { __http?: boolean })?.__http);
      sdkMock.deleteChallenge.mockRejectedValue({
        __http: true,
        status: 500,
        data: { message: 'boom' },
        message: 'raw',
      });
      renderPage([makeChallenge({ id: 'c-1', name: 'Summer Trip' })], SharedSpaceRole.Editor);

      await fireEvent.click(screen.getByTestId('challenge-card-delete'));

      await waitFor(() => expect(toastManagerMock.danger).toHaveBeenCalledWith('boom\n(Immich Server Error)'));
      expect(screen.getByTestId('challenge-card')).toBeInTheDocument();
    });
  });
});
