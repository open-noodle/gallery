import {
  SharedSpaceRole,
  type AlbumResponseDto,
  type SharedSpaceLinkedAlbumDto,
  type SharedSpaceMemberResponseDto,
  type SharedSpaceResponseDto,
} from '@immich/sdk';
import '@testing-library/jest-dom';
import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import type { Component } from 'svelte';
import { init, register, waitLocale } from 'svelte-i18n';
import { goto, invalidateAll } from '$app/navigation';
import { sdkMock } from '$lib/__mocks__/sdk.mock';
import TestWrapper from '$lib/components/TestWrapper.svelte';
import { authManager } from '$lib/managers/auth-manager.svelte';
import { eventManager } from '$lib/managers/event-manager.svelte';
import SpaceLinkAlbumModal from '$lib/modals/SpaceLinkAlbumModal.svelte';
import { spaceAlbumViewSettings } from '$lib/stores/space-album-view-settings.store';
import { preferencesFactory } from '@test-data/factories/preferences-factory';
import { userAdminFactory } from '@test-data/factories/user-factory';
import SpaceAlbumsPage from './+page.svelte';

vi.mock('$app/navigation', () => ({ goto: vi.fn(), invalidateAll: vi.fn() }));
vi.mock('$app/stores', () => ({
  page: {
    subscribe: (run: (v: unknown) => void) => {
      run({ url: new URL('http://localhost/spaces/space-1/albums'), route: { id: '' } });
      return () => {};
    },
  },
}));

const { modalManagerMock } = vi.hoisted(() => ({
  modalManagerMock: { show: vi.fn(), showDialog: vi.fn() },
}));

vi.mock('@immich/ui', async (importOriginal) => {
  const original = await importOriginal<typeof import('@immich/ui')>();
  return {
    ...original,
    modalManager: modalManagerMock,
    toastManager: { primary: vi.fn(), success: vi.fn(), warning: vi.fn() },
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

function makeAlbum(overrides: Partial<SharedSpaceLinkedAlbumDto> = {}): SharedSpaceLinkedAlbumDto {
  return {
    id: 'album-1',
    ownerId: 'owner-1',
    albumName: 'Vacation',
    assetCount: 5,
    albumThumbnailAssetId: null,
    showInTimeline: true,
    addedById: null,
    linkedAt: '2026-01-01T00:00:00.000Z',
    description: '',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    shared: false,
    hasSharedLink: false,
    isActivityEnabled: false,
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

function renderPage(albums: SharedSpaceLinkedAlbumDto[], role: SharedSpaceRole = SharedSpaceRole.Editor) {
  // The page re-fetches linked albums on mount (reload) to pick up edits made on the detail page;
  // return the same set so the mount reload doesn't wipe the rendered cards.
  sdkMock.getSharedSpaceAlbums.mockResolvedValue(albums);
  const props = {
    data: {
      space: BASE_SPACE,
      members: [makeMember(role)],
      linkedAlbums: albums,
      meta: { title: 'Test Space - Albums' },
    },
  };

  // The page no longer renders UserPageLayout (which provided the Tooltip context); the shell layout
  // does. TestWrapper supplies the TooltipProvider the album cards' menus rely on.
  return render(TestWrapper as Component<{ component: typeof SpaceAlbumsPage; componentProps: typeof props }>, {
    component: SpaceAlbumsPage,
    componentProps: props,
  });
}

describe('Space albums page', () => {
  beforeAll(async () => {
    register('en-US', () => import('$i18n/en.json'));
    await init({ fallbackLocale: 'en-US', initialLocale: 'en-US' });
    await waitLocale('en-US');
  });

  beforeEach(() => {
    vi.resetAllMocks();
    localStorage.clear();
    spaceAlbumViewSettings.reset();
    authManager.setUser(userAdminFactory.build({ id: 'current-user-id' }));
    authManager.setPreferences(preferencesFactory.build());
    sdkMock.getSharedSpaceAlbums.mockResolvedValue([]);
  });

  it('renders one card per album', () => {
    renderPage([makeAlbum({ id: 'a-1', albumName: 'Trip' }), makeAlbum({ id: 'a-2', albumName: 'Home' })]);
    expect(screen.getAllByTestId('space-album-card')).toHaveLength(2);
  });

  it('renders the view toggle control', () => {
    renderPage([makeAlbum({ id: 'a-1', albumName: 'Trip' })]);
    expect(screen.getByTestId('space-albums-view-toggle')).toBeInTheDocument();
  });

  it('renders the search input when albums are present', () => {
    renderPage([makeAlbum({ id: 'a-1', albumName: 'Trip' })]);
    expect(screen.getByTestId('space-albums-search')).toBeInTheDocument();
  });

  it('editor sees the "Link album" button', () => {
    renderPage([makeAlbum()], SharedSpaceRole.Editor);
    expect(screen.getByTestId('link-album-button')).toBeInTheDocument();
  });

  it('owner sees the "Link album" button', () => {
    renderPage([makeAlbum()], SharedSpaceRole.Owner);
    expect(screen.getByTestId('link-album-button')).toBeInTheDocument();
  });

  it('viewer does NOT see the "Link album" button', () => {
    renderPage([makeAlbum()], SharedSpaceRole.Viewer);
    expect(screen.queryByTestId('link-album-button')).not.toBeInTheDocument();
  });

  it('shows empty-state text when albums list is empty', () => {
    renderPage([], SharedSpaceRole.Viewer);
    expect(screen.getByTestId('empty-state-message')).toBeInTheDocument();
  });

  it('shows editor CTA when albums list is empty and user is editor', () => {
    renderPage([], SharedSpaceRole.Editor);
    expect(screen.getByTestId('empty-link-album-button')).toBeInTheDocument();
  });

  it('offers Create album alongside Link album on the empty state — a space with no albums yet is exactly where creating one is most useful', () => {
    renderPage([], SharedSpaceRole.Editor);
    expect(screen.getByTestId('empty-create-album-button')).toBeInTheDocument();
    expect(screen.getByTestId('empty-link-album-button')).toBeInTheDocument();
  });

  it('viewer with empty albums list sees no Create album button either', () => {
    renderPage([], SharedSpaceRole.Viewer);
    expect(screen.queryByTestId('empty-create-album-button')).not.toBeInTheDocument();
  });

  describe('interactions', () => {
    it('clicking "Link album" opens the SpaceLinkAlbumModal with the linked album ids', async () => {
      modalManagerMock.show.mockResolvedValue(undefined);
      renderPage([makeAlbum({ id: 'album-1' })], SharedSpaceRole.Editor);

      await fireEvent.click(screen.getByTestId('link-album-button'));

      await waitFor(() =>
        expect(modalManagerMock.show).toHaveBeenCalledWith(SpaceLinkAlbumModal, {
          spaceId: 'space-1',
          linkedAlbumIds: ['album-1'],
        }),
      );
    });

    it('reloads and invalidates layout data when the modal reports linked albums', async () => {
      modalManagerMock.show.mockResolvedValue(2);
      sdkMock.getSharedSpaceAlbums.mockResolvedValue([makeAlbum({ id: 'av-1', albumName: 'Road Trip' })]);
      renderPage([], SharedSpaceRole.Editor);

      await fireEvent.click(screen.getByTestId('empty-link-album-button'));

      await waitFor(() => expect(sdkMock.getSharedSpaceAlbums).toHaveBeenCalledWith({ id: 'space-1' }));
      await waitFor(() => expect(invalidateAll).toHaveBeenCalled());
    });

    it('does not reload or invalidate when the modal links nothing', async () => {
      modalManagerMock.show.mockResolvedValue(0);
      renderPage([], SharedSpaceRole.Editor);

      await fireEvent.click(screen.getByTestId('empty-link-album-button'));

      await waitFor(() => expect(modalManagerMock.show).toHaveBeenCalled());
      // getSharedSpaceAlbums is called once on mount (reload); the no-op link must not trigger another.
      expect(sdkMock.getSharedSpaceAlbums).toHaveBeenCalledTimes(1);
      expect(invalidateAll).not.toHaveBeenCalled();
    });

    it('unlink: after confirm resolves true, calls unlinkAlbum', async () => {
      modalManagerMock.showDialog.mockResolvedValue(true);
      sdkMock.unlinkAlbum.mockResolvedValue(undefined as never);
      sdkMock.getSharedSpaceAlbums.mockResolvedValue([]);
      const album = makeAlbum({ id: 'album-1', albumName: 'Vacation' });
      renderPage([album], SharedSpaceRole.Editor);

      // Find the card's ⋯ menu button and open it
      const menuContainer = screen.getByTestId('space-album-card-menu');
      const menuButton = menuContainer.querySelector('button');
      expect(menuButton).not.toBeNull();
      await fireEvent.click(menuButton!);

      // Wait for menu items to appear, then click "Unlink album"
      const unlinkOption = await screen.findByText('Unlink album');
      await fireEvent.click(unlinkOption);

      await waitFor(() => expect(sdkMock.unlinkAlbum).toHaveBeenCalledWith({ id: 'space-1', albumId: 'album-1' }));
    });

    // Regression: after unlink/link the [spaceId] layout's cached linkedAlbums must be invalidated,
    // otherwise navigating away (People tab) and back (Albums tab) re-mounts the grid from the stale
    // layout data and the list is wrong until a full page refresh.
    it('unlink invalidates layout data so tab navigation reflects the change', async () => {
      modalManagerMock.showDialog.mockResolvedValue(true);
      sdkMock.unlinkAlbum.mockResolvedValue(undefined as never);
      sdkMock.getSharedSpaceAlbums.mockResolvedValue([]);
      renderPage([makeAlbum({ id: 'album-1', albumName: 'Vacation' })], SharedSpaceRole.Editor);

      const menuButton = screen.getByTestId('space-album-card-menu').querySelector('button');
      await fireEvent.click(menuButton!);
      await fireEvent.click(await screen.findByText('Unlink album'));

      await waitFor(() => expect(sdkMock.unlinkAlbum).toHaveBeenCalled());
      await waitFor(() => expect(invalidateAll).toHaveBeenCalled());
    });

    it('toggle show-in-timeline calls updateSharedSpaceAlbum and flips optimistic state', async () => {
      sdkMock.updateSharedSpaceAlbum.mockResolvedValue(undefined as never);
      const album = makeAlbum({ id: 'album-1', albumName: 'Vacation', showInTimeline: true });
      renderPage([album], SharedSpaceRole.Editor);

      // Open the card's ⋯ context menu
      const menuContainer = screen.getByTestId('space-album-card-menu');
      const menuButton = menuContainer.querySelector('button');
      expect(menuButton).not.toBeNull();
      await fireEvent.click(menuButton!);

      // Click "Hide from timeline" (showInTimeline=true → shows hide option)
      const toggleOption = await screen.findByText('Hide from timeline');
      await fireEvent.click(toggleOption);

      await waitFor(() =>
        expect(sdkMock.updateSharedSpaceAlbum).toHaveBeenCalledWith({
          id: 'space-1',
          albumId: 'album-1',
          sharedSpaceAlbumLinkUpdateDto: { showInTimeline: false },
        }),
      );

      // Optimistic flip: "hidden from timeline" label should now appear
      await waitFor(() => expect(screen.getByText(/hidden from timeline/i)).toBeInTheDocument());
    });

    // ── Owner equivalents for unlink and toggle ──────────────────────────────

    it('owner can unlink: after confirm resolves true, calls unlinkAlbum', async () => {
      modalManagerMock.showDialog.mockResolvedValue(true);
      sdkMock.unlinkAlbum.mockResolvedValue(undefined as never);
      sdkMock.getSharedSpaceAlbums.mockResolvedValue([]);
      const album = makeAlbum({ id: 'album-1', albumName: 'Vacation' });
      renderPage([album], SharedSpaceRole.Owner);

      const menuContainer = screen.getByTestId('space-album-card-menu');
      const menuButton = menuContainer.querySelector('button');
      expect(menuButton).not.toBeNull();
      await fireEvent.click(menuButton!);

      const unlinkOption = await screen.findByText('Unlink album');
      await fireEvent.click(unlinkOption);

      await waitFor(() => expect(sdkMock.unlinkAlbum).toHaveBeenCalledWith({ id: 'space-1', albumId: 'album-1' }));
    });

    it('owner can toggle show-in-timeline: calls updateSharedSpaceAlbum', async () => {
      sdkMock.updateSharedSpaceAlbum.mockResolvedValue(undefined as never);
      const album = makeAlbum({ id: 'album-1', albumName: 'Vacation', showInTimeline: true });
      renderPage([album], SharedSpaceRole.Owner);

      const menuContainer = screen.getByTestId('space-album-card-menu');
      const menuButton = menuContainer.querySelector('button');
      expect(menuButton).not.toBeNull();
      await fireEvent.click(menuButton!);

      const toggleOption = await screen.findByText('Hide from timeline');
      await fireEvent.click(toggleOption);

      await waitFor(() =>
        expect(sdkMock.updateSharedSpaceAlbum).toHaveBeenCalledWith({
          id: 'space-1',
          albumId: 'album-1',
          sharedSpaceAlbumLinkUpdateDto: { showInTimeline: false },
        }),
      );
    });

    it('create: creates an album, links it, and navigates to the space album route', async () => {
      sdkMock.createAlbum.mockResolvedValue({ id: 'new-1', albumName: '' } as AlbumResponseDto);
      sdkMock.linkAlbum.mockResolvedValue(undefined as never);
      renderPage([makeAlbum({ id: 'a' })], SharedSpaceRole.Owner);
      await fireEvent.click(screen.getByTestId('create-album-button'));
      await waitFor(() => expect(sdkMock.linkAlbum).toHaveBeenCalledWith({ id: BASE_SPACE.id, albumId: 'new-1' }));
      expect(goto).toHaveBeenCalledWith(`/spaces/${BASE_SPACE.id}/albums/new-1`);
    });

    it('empty-state create: creates an album, links it, and navigates to the space album route', async () => {
      sdkMock.createAlbum.mockResolvedValue({ id: 'new-1', albumName: '' } as AlbumResponseDto);
      sdkMock.linkAlbum.mockResolvedValue(undefined as never);
      renderPage([], SharedSpaceRole.Editor);

      await fireEvent.click(screen.getByTestId('empty-create-album-button'));

      await waitFor(() => expect(sdkMock.linkAlbum).toHaveBeenCalledWith({ id: BASE_SPACE.id, albumId: 'new-1' }));
      expect(goto).toHaveBeenCalledWith(`/spaces/${BASE_SPACE.id}/albums/new-1`);
    });

    it('create succeeds but link fails → toast, no navigation, reload', async () => {
      sdkMock.createAlbum.mockResolvedValue({ id: 'new-1', albumName: '' } as AlbumResponseDto);
      sdkMock.linkAlbum.mockRejectedValue(new Error('nope'));
      renderPage([makeAlbum({ id: 'a' })], SharedSpaceRole.Owner);
      await fireEvent.click(screen.getByTestId('create-album-button'));
      await waitFor(() => expect(sdkMock.linkAlbum).toHaveBeenCalled());
      expect(goto).not.toHaveBeenCalled();
      expect(sdkMock.getSharedSpaceAlbums).toHaveBeenCalled(); // reload
    });

    it('viewer sees no Create/Link buttons', () => {
      renderPage([makeAlbum({ id: 'a' })], SharedSpaceRole.Viewer);
      expect(screen.queryByTestId('create-album-button')).not.toBeInTheDocument();
      expect(screen.queryByTestId('link-album-button')).not.toBeInTheDocument();
    });
  });

  describe('album link/unlink events', () => {
    it('emits SpaceUnlinkAlbum after a confirmed unlink', async () => {
      const emitSpy = vi.spyOn(eventManager, 'emit');
      modalManagerMock.showDialog.mockResolvedValue(true);
      sdkMock.unlinkAlbum.mockResolvedValue(undefined as never);
      sdkMock.getSharedSpaceAlbums.mockResolvedValue([]);
      const album = makeAlbum({ id: 'album-1', albumName: 'Vacation' });
      renderPage([album], SharedSpaceRole.Editor);

      const menuContainer = screen.getByTestId('space-album-card-menu');
      const menuButton = menuContainer.querySelector('button');
      expect(menuButton).not.toBeNull();
      await fireEvent.click(menuButton!);

      const unlinkOption = await screen.findByText('Unlink album');
      await fireEvent.click(unlinkOption);

      await waitFor(() => expect(emitSpy).toHaveBeenCalledWith('SpaceUnlinkAlbum', { spaceId: 'space-1' }));
      emitSpy.mockRestore();
    });

    it('emits SpaceLinkAlbum after creating and linking a new album', async () => {
      const emitSpy = vi.spyOn(eventManager, 'emit');
      sdkMock.createAlbum.mockResolvedValue({ id: 'new-1', albumName: '' } as AlbumResponseDto);
      sdkMock.linkAlbum.mockResolvedValue(undefined as never);
      renderPage([makeAlbum({ id: 'a' })], SharedSpaceRole.Owner);

      await fireEvent.click(screen.getByTestId('create-album-button'));

      await waitFor(() => expect(emitSpy).toHaveBeenCalledWith('SpaceLinkAlbum', { spaceId: BASE_SPACE.id }));
      emitSpy.mockRestore();
    });
  });

  // ── Viewer gating: card menu and empty CTA ──────────────────────────────────

  it('viewer with a linked album sees no space-album-card-menu', () => {
    renderPage([makeAlbum()], SharedSpaceRole.Viewer);
    expect(screen.queryByTestId('space-album-card-menu')).not.toBeInTheDocument();
  });

  it('viewer with empty albums list sees no empty-link-album-button', () => {
    renderPage([], SharedSpaceRole.Viewer);
    expect(screen.queryByTestId('empty-link-album-button')).not.toBeInTheDocument();
  });
});
