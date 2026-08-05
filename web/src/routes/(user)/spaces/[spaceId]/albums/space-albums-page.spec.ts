import {
  SharedSpaceRole,
  type AlbumResponseDto,
  type SharedSpaceAlbumFolderDto,
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

// A mutable holder so individual tests can point `page.url` at a `?folder=` query string before
// rendering. `$app/state`'s `page` is a plain rune-backed object (not a store — read without a
// `$` prefix), and this is the established mocking pattern for it elsewhere in this codebase
// (space-tabs.spec.ts, recent-spaces.spec.ts, global-search.spec.ts). `$app/stores` is deprecated
// in SvelteKit 2 and removed in 3; the production code under test reads `$app/state` too.
const { pageMock } = vi.hoisted(() => ({
  pageMock: { url: new URL('http://localhost/spaces/space-1/albums') },
}));

vi.mock('$app/navigation', () => ({ goto: vi.fn(), invalidateAll: vi.fn() }));
vi.mock('$app/state', () => ({ page: pageMock }));

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
    folderId: null,
    showInTimeline: true,
    hiddenFromMyTimeline: false,
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

function makeFolder(id: string, name: string, parentId: string | null = null): SharedSpaceAlbumFolderDto {
  return {
    id,
    spaceId: 'space-1',
    parentId,
    name,
    createdById: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

function renderPage(
  albums: SharedSpaceLinkedAlbumDto[],
  role: SharedSpaceRole = SharedSpaceRole.Editor,
  options: {
    folders?: SharedSpaceAlbumFolderDto[];
    folderParam?: string;
    /** Simulates a failed folders fetch instead of resolving `options.folders`. */
    foldersRejects?: boolean;
    /** What the layout's initial (pre-mount-reload) linkedAlbums prop reports — defaults to
     * `albums`. Set this to something different from `albums` to prove that the mount reload
     * actually replaces it, rather than the assertion passing on the initial prop alone. */
    linkedAlbums?: SharedSpaceLinkedAlbumDto[];
  } = {},
) {
  const { folders = [], folderParam, foldersRejects = false, linkedAlbums = albums } = options;

  pageMock.url = new URL(`http://localhost/spaces/space-1/albums${folderParam ? `?folder=${folderParam}` : ''}`);

  // The page re-fetches linked albums and folders on mount (reload) to pick up edits made on the
  // detail page; return the same sets so the mount reload doesn't wipe the rendered cards.
  sdkMock.getSharedSpaceAlbums.mockResolvedValue(albums);
  if (foldersRejects) {
    sdkMock.getSharedSpaceAlbumFolders.mockRejectedValue(new Error('network error'));
  } else {
    sdkMock.getSharedSpaceAlbumFolders.mockResolvedValue(folders);
  }
  const props = {
    data: {
      space: BASE_SPACE,
      members: [makeMember(role)],
      linkedAlbums,
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
    sdkMock.getSharedSpaceAlbumFolders.mockResolvedValue([]);
    // pageMock is a plain object, not a vi.fn — vi.resetAllMocks() above doesn't touch it, and web
    // vitest has no clearMocks, so a `?folder=` set by one test would otherwise leak into the next.
    pageMock.url = new URL('http://localhost/spaces/space-1/albums');
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

  // Finding: without this, a brand-new space had no way to create a folder until an album
  // existed to put in one — SpaceAlbumsControls (with its New folder button) only renders in the
  // populated arm of the page.
  it('offers New folder on the empty state for editors', () => {
    renderPage([], SharedSpaceRole.Editor);
    expect(screen.getByTestId('empty-create-folder-button')).toBeInTheDocument();
  });

  it('viewer with empty albums list sees no New folder button either', () => {
    renderPage([], SharedSpaceRole.Viewer);
    expect(screen.queryByTestId('empty-create-folder-button')).not.toBeInTheDocument();
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
      modalManagerMock.show.mockResolvedValue({ confirmed: true, alsoHideFromMyTimeline: false });
      const album = makeAlbum({ id: 'album-1', albumName: 'Vacation', showInTimeline: true });
      renderPage([album], SharedSpaceRole.Editor);

      // Open the card's ⋯ context menu
      const menuContainer = screen.getByTestId('space-album-card-menu');
      const menuButton = menuContainer.querySelector('button');
      expect(menuButton).not.toBeNull();
      await fireEvent.click(menuButton!);

      // Click "Hide this album from the space's photos" (showInTimeline=true → shows hide option;
      // this is the editor-gated shared flag, distinct from the "my timeline" item above it).
      const toggleOption = await screen.findByText("Hide this album from the space's photos");
      await fireEvent.click(toggleOption);

      await waitFor(() =>
        expect(sdkMock.updateSharedSpaceAlbum).toHaveBeenCalledWith({
          id: 'space-1',
          albumId: 'album-1',
          sharedSpaceAlbumLinkUpdateDto: { showInTimeline: false },
        }),
      );

      // Optimistic flip: "hidden from the space's photos" label should now appear
      await waitFor(() => expect(screen.getByText(/Hidden from the space's photos/)).toBeInTheDocument());
      await waitFor(() => expect(invalidateAll).toHaveBeenCalled());
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
      modalManagerMock.show.mockResolvedValue({ confirmed: true, alsoHideFromMyTimeline: false });
      const album = makeAlbum({ id: 'album-1', albumName: 'Vacation', showInTimeline: true });
      renderPage([album], SharedSpaceRole.Owner);

      const menuContainer = screen.getByTestId('space-album-card-menu');
      const menuButton = menuContainer.querySelector('button');
      expect(menuButton).not.toBeNull();
      await fireEvent.click(menuButton!);

      const toggleOption = await screen.findByText("Hide this album from the space's photos");
      await fireEvent.click(toggleOption);

      await waitFor(() =>
        expect(sdkMock.updateSharedSpaceAlbum).toHaveBeenCalledWith({
          id: 'space-1',
          albumId: 'album-1',
          sharedSpaceAlbumLinkUpdateDto: { showInTimeline: false },
        }),
      );
    });

    // The editor dialog's checked-by-default "also hide from my own timeline" checkbox writes
    // ONLY the actor's own row, via the member-only endpoint — never a bulk/cross-member write.
    it('the editor dialog\'s "also hide from my timeline" checkbox additionally writes the actor\'s own row', async () => {
      sdkMock.updateSharedSpaceAlbum.mockResolvedValue(undefined as never);
      sdkMock.updateAlbumTimelineForMember.mockResolvedValue(undefined as never);
      modalManagerMock.show.mockResolvedValue({ confirmed: true, alsoHideFromMyTimeline: true });
      const album = makeAlbum({ id: 'album-1', albumName: 'Vacation', showInTimeline: true });
      renderPage([album], SharedSpaceRole.Owner);

      const menuButton = screen.getByTestId('space-album-card-menu').querySelector('button');
      await fireEvent.click(menuButton!);
      await fireEvent.click(await screen.findByText("Hide this album from the space's photos"));

      await waitFor(() =>
        expect(sdkMock.updateSharedSpaceAlbum).toHaveBeenCalledWith({
          id: 'space-1',
          albumId: 'album-1',
          sharedSpaceAlbumLinkUpdateDto: { showInTimeline: false },
        }),
      );
      await waitFor(() =>
        expect(sdkMock.updateAlbumTimelineForMember).toHaveBeenCalledWith({
          id: 'space-1',
          albumId: 'album-1',
          sharedSpaceAlbumMemberTimelineDto: { showInTimeline: false },
        }),
      );
    });

    // Partial failure: the shared flag write SUCCEEDED, so the server state has already changed.
    // If the follow-up own-row write throws, the page must still reconcile with the server —
    // otherwise the row keeps rendering "Hide from the space's photos" for a flag that is already
    // off, and only a manual reload fixes it.
    it('still reconciles with the server when the second (own-row) write fails', async () => {
      sdkMock.updateSharedSpaceAlbum.mockResolvedValue(undefined as never);
      sdkMock.updateAlbumTimelineForMember.mockRejectedValue(new Error('boom') as never);
      modalManagerMock.show.mockResolvedValue({ confirmed: true, alsoHideFromMyTimeline: true });
      const album = makeAlbum({ id: 'album-1', albumName: 'Vacation', showInTimeline: true });
      renderPage([album], SharedSpaceRole.Owner);

      const menuButton = screen.getByTestId('space-album-card-menu').querySelector('button');
      await fireEvent.click(menuButton!);
      await fireEvent.click(await screen.findByText("Hide this album from the space's photos"));

      await waitFor(() => expect(sdkMock.updateAlbumTimelineForMember).toHaveBeenCalled());
      await waitFor(() => expect(invalidateAll).toHaveBeenCalled());
    });

    it('leaving the "also hide from my timeline" checkbox unticked writes only the shared flag', async () => {
      sdkMock.updateSharedSpaceAlbum.mockResolvedValue(undefined as never);
      modalManagerMock.show.mockResolvedValue({ confirmed: true, alsoHideFromMyTimeline: false });
      const album = makeAlbum({ id: 'album-1', albumName: 'Vacation', showInTimeline: true });
      renderPage([album], SharedSpaceRole.Owner);

      const menuButton = screen.getByTestId('space-album-card-menu').querySelector('button');
      await fireEvent.click(menuButton!);
      await fireEvent.click(await screen.findByText("Hide this album from the space's photos"));

      await waitFor(() => expect(sdkMock.updateSharedSpaceAlbum).toHaveBeenCalled());
      expect(sdkMock.updateAlbumTimelineForMember).not.toHaveBeenCalled();
    });

    it('the editor dialog: does nothing when dismissed', async () => {
      modalManagerMock.show.mockResolvedValue(undefined);
      const album = makeAlbum({ id: 'album-1', albumName: 'Vacation', showInTimeline: true });
      renderPage([album], SharedSpaceRole.Owner);

      const menuButton = screen.getByTestId('space-album-card-menu').querySelector('button');
      await fireEvent.click(menuButton!);
      await fireEvent.click(await screen.findByText("Hide this album from the space's photos"));

      await waitFor(() => expect(modalManagerMock.show).toHaveBeenCalled());
      expect(sdkMock.updateSharedSpaceAlbum).not.toHaveBeenCalled();
      expect(sdkMock.updateAlbumTimelineForMember).not.toHaveBeenCalled();
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

    it('empty-state New folder opens the folder-name modal and creates the folder at the root', async () => {
      modalManagerMock.show.mockResolvedValue('Trips');
      sdkMock.createSharedSpaceAlbumFolder.mockResolvedValue(makeFolder('trips', 'Trips'));
      renderPage([], SharedSpaceRole.Editor);

      await fireEvent.click(screen.getByTestId('empty-create-folder-button'));

      await waitFor(() =>
        expect(sdkMock.createSharedSpaceAlbumFolder).toHaveBeenCalledWith({
          id: 'space-1',
          sharedSpaceAlbumFolderCreateDto: { name: 'Trips', parentId: null },
        }),
      );
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

  describe('folders', () => {
    // W-02
    it('W-02: opening a folder pushes ?folder= onto the URL', async () => {
      renderPage([], SharedSpaceRole.Editor, { folders: [makeFolder('trips', 'Trips')] });

      const openButton = await screen.findByTestId('space-album-folder-card-open');
      await fireEvent.click(openButton);

      expect(goto).toHaveBeenCalledWith(expect.stringContaining('folder=trips'));
    });

    // W-03
    it('W-03: a breadcrumb crumb navigates up one level', async () => {
      renderPage([], SharedSpaceRole.Editor, {
        folders: [makeFolder('trips', 'Trips'), makeFolder('y2026', '2026', 'trips')],
        folderParam: 'y2026',
      });

      const crumb = await screen.findByTestId('breadcrumb-trips');
      await fireEvent.click(crumb);

      expect(goto).toHaveBeenCalledWith(expect.stringContaining('folder=trips'));
    });

    // W-04: the drill-in is a real navigation, so browser back is free — this asserts we use
    // goto() with history rather than a replaceState navigation (which would collapse browser
    // back). Reads the mock call directly rather than toHaveBeenCalledWith, since that matcher
    // is arity-sensitive and navigateToFolder() calls goto() with a single argument. Asserting
    // goto was called at all first matters: `.mock.calls.at(-1) ?? []` silently destructures to
    // `options: undefined` if it never fired, and `expect(undefined).not.toEqual(objectContaining
    // (...))` passes — a click that does nothing would pass this test without that assertion.
    it('W-04: drill-in uses history navigation so browser back works', async () => {
      renderPage([], SharedSpaceRole.Editor, { folders: [makeFolder('trips', 'Trips')] });

      const openButton = await screen.findByTestId('space-album-folder-card-open');
      await fireEvent.click(openButton);

      expect(goto).toHaveBeenCalled();
      const [, options] = vi.mocked(goto).mock.calls.at(-1) ?? [];
      expect(options).not.toEqual(expect.objectContaining({ replaceState: true }));
    });

    // W-05: a space with no folders must be pixel-identical to today.
    it('W-05: renders no breadcrumb when the space has no folders', async () => {
      renderPage([makeAlbum({ id: 'a1', albumName: 'Rome' })], SharedSpaceRole.Editor, { folders: [] });

      await screen.findByText('Rome');
      expect(screen.queryByTestId('space-album-folder-breadcrumb')).not.toBeInTheDocument();
    });

    // W-06: another editor deleting the folder you have open must not break your page.
    it('W-06: falls back to the root and strips an unknown ?folder=', async () => {
      renderPage([makeAlbum({ id: 'a1', albumName: 'Rome' })], SharedSpaceRole.Editor, {
        folders: [makeFolder('trips', 'Trips')],
        folderParam: 'deleted',
      });

      await waitFor(() => expect(screen.getByText('Rome')).toBeInTheDocument());
      await waitFor(() =>
        expect(goto).toHaveBeenCalledWith(expect.not.stringContaining('folder='), { replaceState: true }),
      );
    });

    // Finding: `folders.length > 0` can't distinguish "haven't loaded yet" from "genuinely zero
    // folders" — a space whose last folder was just deleted left a dangling ?folder= forever.
    it('strips ?folder= when the space has been emptied down to zero folders', async () => {
      renderPage([makeAlbum({ id: 'a1', albumName: 'Rome' })], SharedSpaceRole.Editor, {
        folders: [],
        folderParam: 'trips',
      });

      await waitFor(() => expect(screen.getByText('Rome')).toBeInTheDocument());
      await waitFor(() =>
        expect(goto).toHaveBeenCalledWith(expect.not.stringContaining('folder='), { replaceState: true }),
      );
    });

    // W-10: search is not folder state — clearing it must restore where you were.
    it('W-10: clearing the search returns to the folder you were in', async () => {
      renderPage([makeAlbum({ id: 'a1', albumName: 'Rome', folderId: 'trips' })], SharedSpaceRole.Editor, {
        folders: [makeFolder('trips', 'Trips')],
        folderParam: 'trips',
      });

      await screen.findByTestId('space-album-folder-breadcrumb');
      const search = screen.getByTestId('space-albums-search');

      await fireEvent.input(search, { target: { value: 'zzz' } });
      expect(screen.queryByText('Rome')).not.toBeInTheDocument();

      await fireEvent.input(search, { target: { value: '' } });

      expect(screen.getByText('Rome')).toBeInTheDocument();
      expect(screen.getByTestId('space-album-folder-breadcrumb')).toBeInTheDocument();
    });

    // W-16: one request, not link-then-move.
    it('W-16: creating an album inside a folder links it straight into that folder', async () => {
      sdkMock.createAlbum.mockResolvedValue({ id: 'new-1', albumName: '' } as AlbumResponseDto);
      sdkMock.linkAlbum.mockResolvedValue(undefined as never);
      renderPage([], SharedSpaceRole.Editor, {
        folders: [makeFolder('trips', 'Trips')],
        folderParam: 'trips',
      });

      const createButton = await screen.findByTestId('create-album-button');
      await fireEvent.click(createButton);

      await waitFor(() =>
        expect(sdkMock.linkAlbum).toHaveBeenCalledWith(expect.objectContaining({ folderId: 'trips' })),
      );
    });

    // Finding: the breadcrumb was gated only on folders.length > 0, so it stayed visible during a
    // search — showing e.g. "Albums › Trips" while the results underneath are actually
    // space-wide, misrepresenting where they come from.
    it('W-09: hides the breadcrumb while searching', async () => {
      renderPage([makeAlbum({ id: 'a1', albumName: 'Rome', folderId: 'trips' })], SharedSpaceRole.Editor, {
        folders: [makeFolder('trips', 'Trips')],
        folderParam: 'trips',
      });

      await screen.findByTestId('space-album-folder-breadcrumb');
      const search = screen.getByTestId('space-albums-search');
      await fireEvent.input(search, { target: { value: 'rom' } });

      expect(screen.queryByTestId('space-album-folder-breadcrumb')).not.toBeInTheDocument();
    });

    // Finding: reload() used an atomic Promise.all, so a folders-fetch failure also prevented the
    // albums refresh from ever landing (the destructuring assignment never runs when either
    // promise rejects) — and, without foldersUnavailable threaded through, any album that lives
    // in a folder was invisible forever since root-level filtering only shows folderId === null.
    it('a folders-fetch failure still refreshes albums and degrades to a flat, unscoped list', async () => {
      // linkedAlbums: [] at mount — only the reload's resolved albums (below) contain Rome/
      // Venice, so a passing assertion proves the reload actually landed despite the rejection.
      renderPage(
        [makeAlbum({ id: 'a1', albumName: 'Rome' }), makeAlbum({ id: 'a2', albumName: 'Venice', folderId: 'trips' })],
        SharedSpaceRole.Editor,
        { foldersRejects: true, linkedAlbums: [] },
      );

      await screen.findByText('Rome');
      expect(screen.getByText('Venice')).toBeInTheDocument();
    });

    // Finding: `foldersUnavailable` was driven off "most recent fetch failed" alone. Once a
    // folders fetch has succeeded at least once, a LATER reload (e.g. from creating a folder)
    // deliberately keeps the stale-but-usable `folders` list on a failure — but the breadcrumb
    // and currentFolderId are derived from that same stale list, so if the flat-list fallback also
    // fires here, the breadcrumb keeps saying "you are in Trips" while the content underneath
    // flattens to every album in the space. Content must keep agreeing with the breadcrumb: still
    // scoped to Trips (Rome, which lives there) and NOT showing Venice (which lives at the root).
    it('a folder-fetch failure after a prior success keeps scoping by the stale tree instead of flattening', async () => {
      const folders = [makeFolder('trips', 'Trips')];
      const albums = [
        makeAlbum({ id: 'a1', albumName: 'Rome', folderId: 'trips' }),
        makeAlbum({ id: 'a2', albumName: 'Venice', folderId: null }),
      ];
      modalManagerMock.show.mockResolvedValue('Souvenirs');
      sdkMock.createSharedSpaceAlbumFolder.mockResolvedValue(makeFolder('souvenirs', 'Souvenirs', 'trips'));

      renderPage(albums, SharedSpaceRole.Editor, { folders, folderParam: 'trips' });

      await screen.findByTestId('space-album-folder-breadcrumb');
      expect(screen.getByText('Rome')).toBeInTheDocument();
      expect(screen.queryByText('Venice')).not.toBeInTheDocument();

      // The NEXT folders fetch (triggered by creating a folder, which reload()s afterward) fails;
      // the albums half of that same reload still succeeds.
      sdkMock.getSharedSpaceAlbumFolders.mockRejectedValueOnce(new Error('network error'));

      await fireEvent.click(screen.getByTestId('create-folder-button'));

      await waitFor(() => expect(sdkMock.createSharedSpaceAlbumFolder).toHaveBeenCalled());
      await waitFor(() => expect(sdkMock.getSharedSpaceAlbumFolders).toHaveBeenCalledTimes(2));

      // Still "inside Trips" per the breadcrumb, and the content underneath must still agree —
      // Rome (scoped to Trips) visible, Venice (root-level) still hidden, not flattened.
      expect(screen.getByTestId('space-album-folder-breadcrumb')).toHaveTextContent('Trips');
      expect(screen.getByText('Rome')).toBeInTheDocument();
      expect(screen.queryByText('Venice')).not.toBeInTheDocument();
    });
  });

  // ── Viewer gating: card menu and empty CTA ──────────────────────────────────

  // The card menu itself is no longer editor-gated — a viewer needs it too, to hide the album
  // from their OWN timeline (#1041 §2, a personal preference, not an editor action). Only the
  // editor-only items inside it (space-photos toggle, unlink) are gated.
  it('viewer with a linked album sees the card menu, with only the my-timeline item', async () => {
    renderPage([makeAlbum()], SharedSpaceRole.Viewer);
    expect(screen.getByTestId('space-album-card-menu')).toBeInTheDocument();

    const menuButton = screen.getByTestId('space-album-card-menu').querySelector('button');
    await fireEvent.click(menuButton!);

    expect(await screen.findByText('Hide this album from my timeline')).toBeInTheDocument();
    expect(screen.queryByText("Hide this album from the space's photos")).not.toBeInTheDocument();
    expect(screen.queryByText('Unlink album')).not.toBeInTheDocument();
  });

  it('viewer clicking "Hide this album from my timeline" surfaces the preview count and calls the member-only endpoint', async () => {
    sdkMock.getAlbumTimelineHidePreview.mockResolvedValue({ hiddenAssetCount: 4 });
    sdkMock.updateAlbumTimelineForMember.mockResolvedValue(undefined as never);
    modalManagerMock.show.mockResolvedValue(true);
    const album = makeAlbum({ id: 'album-1', albumName: 'Vacation', hiddenFromMyTimeline: false });
    renderPage([album], SharedSpaceRole.Viewer);

    const menuButton = screen.getByTestId('space-album-card-menu').querySelector('button');
    await fireEvent.click(menuButton!);
    await fireEvent.click(await screen.findByText('Hide this album from my timeline'));

    await waitFor(() =>
      expect(sdkMock.getAlbumTimelineHidePreview).toHaveBeenCalledWith({ id: 'space-1', albumId: 'album-1' }),
    );
    expect(modalManagerMock.show).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ albumName: 'Vacation', count: 4 }),
    );
    await waitFor(() =>
      expect(sdkMock.updateAlbumTimelineForMember).toHaveBeenCalledWith({
        id: 'space-1',
        albumId: 'album-1',
        sharedSpaceAlbumMemberTimelineDto: { showInTimeline: false },
      }),
    );
    // Never the editor-only endpoint — a viewer has no permission to call it.
    expect(sdkMock.updateSharedSpaceAlbum).not.toHaveBeenCalled();
    // The member-toggle handler was never audited for this before #1041 slice 12 — it must
    // invalidate the [spaceId] layout's cached linkedAlbums, same as the editor toggle does.
    await waitFor(() => expect(invalidateAll).toHaveBeenCalled());
  });

  it('cancelling the "my timeline" confirm dialog changes nothing', async () => {
    sdkMock.getAlbumTimelineHidePreview.mockResolvedValue({ hiddenAssetCount: 4 });
    modalManagerMock.show.mockResolvedValue(false);
    const album = makeAlbum({ id: 'album-1', albumName: 'Vacation', hiddenFromMyTimeline: false });
    renderPage([album], SharedSpaceRole.Viewer);

    const menuButton = screen.getByTestId('space-album-card-menu').querySelector('button');
    await fireEvent.click(menuButton!);
    await fireEvent.click(await screen.findByText('Hide this album from my timeline'));

    await waitFor(() => expect(modalManagerMock.show).toHaveBeenCalled());
    expect(sdkMock.updateAlbumTimelineForMember).not.toHaveBeenCalled();
  });

  it('viewer with empty albums list sees no empty-link-album-button', () => {
    renderPage([], SharedSpaceRole.Viewer);
    expect(screen.queryByTestId('empty-link-album-button')).not.toBeInTheDocument();
  });
});
